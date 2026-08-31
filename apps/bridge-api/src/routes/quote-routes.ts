import { createHash } from 'node:crypto';
import { AppError } from '@frontdesk-q/contracts';
import { IdempotencyCoordinator } from '@frontdesk-q/idempotency';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QuotePreparationService, QuoteRepository } from '@frontdesk-q/quotes';
import { requirePermission } from '../permissions.js';

const intakeSchema = z
  .object({
    customer: z
      .object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().min(3).max(100).optional(),
        email: z.string().email().max(320).optional(),
      })
      .strict(),
    service_intent: z.string().trim().min(1).max(200).optional(),
    service: z
      .object({ name: z.string().trim().min(1).max(200) })
      .strict()
      .optional(),
    location: z.record(z.unknown()).default({}),
    requirements: z.record(z.unknown()).default({}),
    notes: z.string().max(4_000).optional(),
    source: z
      .object({
        channel: z.string().trim().min(1).max(50).default('phone'),
        dograh_workflow_id: z.union([z.string(), z.number()]).optional(),
        dograh_workflow_run_id: z.union([z.string(), z.number()]).optional(),
      })
      .strict()
      .default({ channel: 'phone' }),
  })
  .strict();

const prepareSchema = z
  .object({
    intake_id: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    scope: z.string().trim().min(1).max(8_000),
    line_proposals: z
      .array(
        z
          .object({
            offering_ref: z.string().trim().min(8).max(200),
            quantity: z.number().finite().positive().max(1_000_000),
            uom: z.string().trim().min(1).max(20),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const approvalNoteSchema = z.object({ note: z.string().trim().max(2_000).optional() }).strict();
const rejectionSchema = z.object({ reason: z.string().trim().min(1).max(2_000) }).strict();
const changeRequestSchema = z.object({ change_request: z.string().trim().min(1).max(4_000) }).strict();
const deliverySchema = z
  .object({
    channel: z.enum(['manual', 'download']),
    recipient: z.string().trim().min(1).max(320),
    pdf_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .strict();

type PdfProvider = {
  getMainPdf?: (projectId: string) => Promise<Buffer>;
  forTenant?: (tenantId: string) => Promise<{ getMainPdf(projectId: string): Promise<Buffer> }>;
};

async function resolvePdfProvider(provider: PdfProvider | undefined, tenantId: string) {
  if (!provider) return null;
  if (provider.getMainPdf) return provider as { getMainPdf(projectId: string): Promise<Buffer> };
  if (provider.forTenant) return provider.forTenant(tenantId);
  return null;
}
function parse<TSchema extends z.ZodTypeAny>(schema: TSchema, body: unknown): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      result.error.message,
      422,
      false,
      'Some request fields are invalid.',
    );
  }
  return result.data;
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string {
  const value = request.headers['x-idempotency-key'];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'X-Idempotency-Key is required',
      400,
      false,
      'The request could not be safely processed.',
    );
  }
  return value.trim();
}

export function registerQuoteRoutes(
  app: FastifyInstance,
  deps: {
    repository: QuoteRepository;
    prepare: QuotePreparationService;
    idempotency: IdempotencyCoordinator;
    provider?: PdfProvider;
  },
): void {
  app.post('/v1/intakes', async (request) => {
    requirePermission(request, 'intake.write');
    const body = parse(intakeSchema, request.body);
    const key = idempotencyKey(request as any);
    const tenantId = request.bridgePrincipal!.tenantId;

    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: key,
      operationType: 'intake.capture',
      requestBody: body,
    });

    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError(
        'OPERATION_IN_PROGRESS',
        'Intake capture is already in progress',
        409,
        true,
        'The customer request is still being saved.',
      );
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError(
        'UPSTREAM_STATE_UNKNOWN',
        'Intake operation requires reconciliation',
        409,
        true,
        'The customer request is being reconciled.',
      );
    }

    const intake = await deps.repository.createIntake({
      tenantId,
      customer: {
        name: body.customer.name,
        phone: body.customer.phone ?? null,
        email: body.customer.email ?? null,
      },
      sourceChannel: body.source.channel,
      dograhWorkflowId:
        body.source.dograh_workflow_id === undefined
          ? null
          : String(body.source.dograh_workflow_id),
      dograhWorkflowRunId:
        body.source.dograh_workflow_run_id === undefined
          ? null
          : String(body.source.dograh_workflow_run_id),
      serviceIntent: body.service_intent ?? body.service?.name ?? null,
      requirements: body.requirements,
      location: body.location,
      notes: body.notes ?? null,
    });

    const result = {
      ok: true,
      intake_id: intake.id,
      customer_id: intake.customerId,
      status: 'captured',
      missing_fields: [],
    };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });

  app.post('/v1/quotes/prepare', async (request) => {
    requirePermission(request, 'quote.prepare');
    const body = parse(prepareSchema, request.body);
    return deps.prepare.prepare({
      tenantId: request.bridgePrincipal!.tenantId,
      idempotencyKey: idempotencyKey(request as any),
      request: body,
    });
  });

  app.post('/v1/quotes/:quoteId/approve', async (request) => {
    requirePermission(request, 'quote.approve');
    const { quoteId } = request.params as { quoteId: string };
    const body = parse(approvalNoteSchema, request.body ?? {});
    const tenantId = request.bridgePrincipal!.tenantId;
    const actorId = request.bridgePrincipal!.tokenId;
    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: idempotencyKey(request as any),
      operationType: 'quote.approve',
      requestBody: { quote_id: quoteId, ...body },
    });
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError('OPERATION_IN_PROGRESS', 'Quote approval is already in progress', 409, true, 'The approval decision is still being saved.');
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError('UPSTREAM_STATE_UNKNOWN', 'Quote approval requires reconciliation', 409, true, 'The approval decision is being reconciled.');
    }
    const decision = await deps.repository.approveQuote({ tenantId, quoteId, actorId, note: body.note ?? null });
    const result = { ok: true, quote_id: quoteId, approval_id: decision.id, state: 'approved', approval_status: 'approved', bidwright_revision_id: decision.bidwrightRevisionId, calculation_hash: decision.calculationHash };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });

  app.post('/v1/quotes/:quoteId/reject', async (request) => {
    requirePermission(request, 'quote.reject');
    const { quoteId } = request.params as { quoteId: string };
    const body = parse(rejectionSchema, request.body);
    const tenantId = request.bridgePrincipal!.tenantId;
    const actorId = request.bridgePrincipal!.tokenId;
    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: idempotencyKey(request as any),
      operationType: 'quote.reject',
      requestBody: { quote_id: quoteId, ...body },
    });
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError('OPERATION_IN_PROGRESS', 'Quote rejection is already in progress', 409, true, 'The rejection decision is still being saved.');
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError('UPSTREAM_STATE_UNKNOWN', 'Quote rejection requires reconciliation', 409, true, 'The rejection decision is being reconciled.');
    }
    const decision = await deps.repository.rejectQuote({ tenantId, quoteId, actorId, reason: body.reason });
    const result = { ok: true, quote_id: quoteId, approval_id: decision.id, state: 'rejected', approval_status: 'rejected', bidwright_revision_id: decision.bidwrightRevisionId, calculation_hash: decision.calculationHash };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });

  app.post('/v1/quotes/:quoteId/request-changes', async (request) => {
    requirePermission(request, 'quote.reject');
    const { quoteId } = request.params as { quoteId: string };
    const body = parse(changeRequestSchema, request.body);
    const tenantId = request.bridgePrincipal!.tenantId;
    const actorId = request.bridgePrincipal!.tokenId;
    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: idempotencyKey(request as any),
      operationType: 'quote.request_changes',
      requestBody: { quote_id: quoteId, ...body },
    });
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError('OPERATION_IN_PROGRESS', 'Quote change request is already in progress', 409, true, 'The change request is still being saved.');
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError('UPSTREAM_STATE_UNKNOWN', 'Quote change request requires reconciliation', 409, true, 'The change request is being reconciled.');
    }
    const decision = await deps.repository.requestQuoteChanges({ tenantId, quoteId, actorId, changeRequest: body.change_request });
    const result = { ok: true, quote_id: quoteId, approval_id: decision.id, state: 'changes_requested', approval_status: 'changes_requested', bidwright_revision_id: decision.bidwrightRevisionId, calculation_hash: decision.calculationHash };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });

  app.get('/v1/quotes/:quoteId/pdf', async (request, reply) => {
    requirePermission(request, 'quote.deliver');
    const { quoteId } = request.params as { quoteId: string };
    const tenantId = request.bridgePrincipal!.tenantId;
    const quote = await deps.repository.getQuote(tenantId, quoteId);
    if (!quote) {
      throw new AppError('QUOTE_NOT_FOUND', 'Quote was not found for this tenant', 404, false, 'The quotation could not be found.');
    }
    if (!['approved', 'sent'].includes(quote.status)) {
      throw new AppError('QUOTE_APPROVAL_REQUIRED', `Quote is ${quote.status}, not approved`, 409, false, 'Only approved quotations can be exported as customer PDFs.');
    }
    const provider = await resolvePdfProvider(deps.provider, tenantId);
    if (!quote.bidwrightProjectId || !provider) {
      throw new AppError('PDF_GENERATION_FAILED', 'Bidwright PDF provider is not configured for this quote', 502, false, 'The approved quotation PDF could not be generated.');
    }
    try {
      const pdf = await provider.getMainPdf(quote.bidwrightProjectId);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${quote.quoteNumber ?? quote.id}.pdf"`)
        .send(pdf);
    } catch (error) {
      throw new AppError('PDF_GENERATION_FAILED', error instanceof Error ? error.message : 'PDF generation failed', 502, false, 'The approved quotation PDF could not be generated.');
    }
  });

  app.post('/v1/quotes/:quoteId/deliver', async (request) => {
    requirePermission(request, 'quote.deliver');
    const { quoteId } = request.params as { quoteId: string };
    const body = parse(deliverySchema, request.body);
    const tenantId = request.bridgePrincipal!.tenantId;
    const actorId = request.bridgePrincipal!.tokenId;
    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: idempotencyKey(request as any),
      operationType: 'quote.deliver',
      requestBody: { quote_id: quoteId, ...body },
    });
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError('OPERATION_IN_PROGRESS', 'Quote delivery is already in progress', 409, true, 'The delivery record is still being saved.');
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError('UPSTREAM_STATE_UNKNOWN', 'Quote delivery requires reconciliation', 409, true, 'The delivery record is being reconciled.');
    }
    const quote = await deps.repository.getQuote(tenantId, quoteId);
    if (!quote) {
      throw new AppError('QUOTE_NOT_FOUND', 'Quote was not found for this tenant', 404, false, 'The quotation could not be found.');
    }
    if (quote.status !== 'approved') {
      throw new AppError('QUOTE_APPROVAL_REQUIRED', `Quote is ${quote.status}, not approved`, 409, false, 'Only approved quotations can be delivered.');
    }
    if (!quote.bidwrightProjectId) {
      throw new AppError('PDF_GENERATION_FAILED', 'Bidwright project reference is not configured for this quote', 502, false, 'The approved quotation PDF could not be generated.');
    }
    let pdfSha256 = body.pdf_sha256?.toLowerCase();
    if (!pdfSha256) {
      const provider = await resolvePdfProvider(deps.provider, tenantId);
      if (!provider) {
        throw new AppError('PDF_GENERATION_FAILED', 'Bidwright PDF provider is not configured for this quote', 502, false, 'The approved quotation PDF could not be generated.');
      }
      let pdf: Buffer;
      try {
        pdf = await provider.getMainPdf(quote.bidwrightProjectId);
      } catch (error) {
        throw new AppError('PDF_GENERATION_FAILED', error instanceof Error ? error.message : 'PDF generation failed', 502, false, 'The approved quotation PDF could not be generated.');
      }
      pdfSha256 = createHash('sha256').update(pdf).digest('hex');
    }
    const delivery = await deps.repository.recordDelivery({ tenantId, quoteId, actorId, channel: body.channel, recipient: body.recipient, pdfSha256 });
    const result = { ok: true, quote_id: quoteId, delivery_id: delivery.id, state: 'sent', delivery_status: delivery.status, channel: delivery.channel, recipient: delivery.recipient, pdf_sha256: delivery.pdfSha256 };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });
  app.get('/v1/quotes/:quoteId/status', async (request) => {
    requirePermission(request, 'quote.read');
    const { quoteId } = request.params as { quoteId: string };
    const quote = await deps.repository.getQuote(request.bridgePrincipal!.tenantId, quoteId);
    if (!quote) {
      throw new AppError(
        'QUOTE_NOT_FOUND',
        'Quote was not found for this tenant',
        404,
        false,
        'The quotation could not be found.',
      );
    }
    return {
      ok: true,
      quote_id: quote.id,
      quote_number: quote.quoteNumber,
      state: quote.status,
      approval_status: quote.status === 'pending_approval' ? 'pending' : ['approved', 'sent'].includes(quote.status) ? 'approved' : quote.status === 'rejected' ? 'rejected' : quote.status === 'changes_requested' ? 'changes_requested' : null,
      currency: quote.currency,
      grand_total: quote.grandTotal,
    };
  });
}
