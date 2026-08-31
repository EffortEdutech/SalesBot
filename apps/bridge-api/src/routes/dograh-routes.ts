import { AppError } from '@frontdesk-q/contracts';
import { IdempotencyCoordinator } from '@frontdesk-q/idempotency';
import type { OfferingSearchService } from '@frontdesk-q/offerings';
import type { PriceResolutionService } from '@frontdesk-q/pricing';
import type { QuotePreparationService, QuoteRepository } from '@frontdesk-q/quotes';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

const DOGRAH_PINNED_VERSION = 's5-bridge-http-tools-v1';

const hvacIntakeSchema = z
  .object({
    workflow_id: z.union([z.string(), z.number()]).optional(),
    workflow_run_id: z.union([z.string(), z.number()]),
    customer: z
      .object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().min(3).max(100).optional(),
        email: z.string().email().max(320).optional(),
      })
      .strict(),
    service_intent: z.string().trim().min(1).max(200).default('hvac_quotation'),
    location: z
      .object({
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().min(1).max(100).optional(),
        address: z.string().trim().max(500).optional(),
        building_type: z.string().trim().min(1).max(100),
      })
      .strict(),
    requirements: z
      .object({
        equipment_type: z.string().trim().min(1).max(100).default('air_conditioner'),
        capacity: z.string().trim().min(1).max(50),
        quantity: z.number().int().positive().max(100),
        install_required: z.boolean().default(true),
      })
      .strict(),
    notes: z.string().trim().max(4_000).optional(),
  })
  .strict();

const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    types: z.array(z.enum(['product', 'service'])).max(2).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

const prepareSchema = z
  .object({
    workflow_run_id: z.union([z.string(), z.number()]).optional(),
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
      .min(1)
      .max(20),
  })
  .strict();

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

function dograhMutationIdempotencyKey(
  request: { headers: Record<string, unknown> },
  workflowRunId: string | number | undefined,
  action: 'capture_intake' | 'prepare_quote',
): string {
  const value = request.headers['x-idempotency-key'];
  if (typeof value === 'string' && value.trim() && !value.includes('{{')) {
    return value.trim();
  }
  if (workflowRunId !== undefined && String(workflowRunId).trim()) {
    return `dograh:${String(workflowRunId).trim()}:${action}:1`;
  }
  return idempotencyKey(request);
}
function requireDograhRuntime(request: FastifyRequest): void {
  const principal = request.bridgePrincipal;
  if (!principal) {
    throw new AppError('AUTH_REQUIRED', 'Dograh runtime authentication is required', 401, false, 'Authentication is required.');
  }
  if (principal.role !== 'ai_runtime') {
    throw new AppError(
      'FORBIDDEN',
      `Role ${principal.role} cannot use Dograh voice tools`,
      403,
      false,
      'This credential is not allowed to use voice runtime tools.',
    );
  }
}

function missingHvacFields(body: z.output<typeof hvacIntakeSchema>): string[] {
  const missing: string[] = [];
  if (!body.customer.name.trim()) missing.push('customer.name');
  if (!body.location.city.trim()) missing.push('location.city');
  if (!body.location.building_type.trim()) missing.push('location.building_type');
  if (!body.requirements.capacity.trim()) missing.push('requirements.capacity');
  if (!body.requirements.quantity) missing.push('requirements.quantity');
  return missing;
}

export function registerDograhRoutes(
  app: FastifyInstance,
  deps: {
    repository: QuoteRepository;
    prepare: QuotePreparationService;
    offerings: OfferingSearchService;
    prices: PriceResolutionService;
    idempotency: IdempotencyCoordinator;
  },
): void {
  app.get('/v1/dograh/session', async (request) => {
    requireDograhRuntime(request);
    return {
      ok: true,
      provider: 'dograh',
      status: 'configured',
      pinned_version: DOGRAH_PINNED_VERSION,
      tenant_id: request.bridgePrincipal!.tenantId,
      runtime_role: request.bridgePrincipal!.role,
      authority: {
        can_capture_intake: true,
        can_search_offerings: true,
        can_prepare_quote: true,
        can_approve_quote: false,
        can_deliver_quote: false,
      },
    };
  });

  app.get('/v1/dograh/tools', async (request) => {
    requireDograhRuntime(request);
    return {
      ok: true,
      pinned_version: DOGRAH_PINNED_VERSION,
      tools: [
        {
          name: 'capture_hvac_intake',
          method: 'POST',
          path: '/v1/dograh/tools/capture-hvac-intake',
          idempotency_required: true,
          description: 'Capture a tenant-scoped HVAC voice intake. Does not disclose or approve prices.',
        },
        {
          name: 'search_offerings',
          method: 'POST',
          path: '/v1/dograh/tools/search-offerings',
          idempotency_required: false,
          description: 'Search active tenant offerings through Bridge only.',
        },
        {
          name: 'prepare_quote',
          method: 'POST',
          path: '/v1/dograh/tools/prepare-quote',
          idempotency_required: true,
          description: 'Prepare a deterministic quote that must stop at pending human approval.',
        },
      ],
      forbidden_tools: ['approve_quote', 'reject_quote', 'deliver_quote', 'export_pdf'],
    };
  });

  app.post('/v1/dograh/tools/search-offerings', async (request) => {
    requireDograhRuntime(request);
    const body = parse(searchSchema, request.body);
    const result = await deps.offerings.search({
      tenantId: request.bridgePrincipal!.tenantId,
      query: body.query,
      ...(body.types ? { types: body.types } : {}),
      limit: body.limit ?? 5,
    });
    return {
      ...result,
      voice_safe: true,
      price_disclosure_policy: 'Dograh may identify offerings but must not quote undisclosed prices.',
    };
  });

  app.post('/v1/dograh/tools/capture-hvac-intake', async (request) => {
    requireDograhRuntime(request);
    const body = parse(hvacIntakeSchema, request.body);
    const missing = missingHvacFields(body);
    if (missing.length) {
      return {
        ok: false,
        status: 'needs_more_information',
        missing_fields: missing,
        user_safe_message: 'I need a few more details before preparing a quotation.',
      };
    }
    const tenantId = request.bridgePrincipal!.tenantId;
    const key = dograhMutationIdempotencyKey(request as any, body.workflow_run_id, 'capture_intake');
    const begin = await deps.idempotency.begin({
      tenantId,
      idempotencyKey: key,
      operationType: 'dograh.intake.capture',
      requestBody: body,
    });
    if (begin.kind === 'replay') return begin.response;
    if (begin.kind === 'in_progress') {
      throw new AppError('OPERATION_IN_PROGRESS', 'Dograh intake capture is already in progress', 409, true, 'The customer request is still being saved.');
    }
    if (begin.kind === 'failed' || begin.kind === 'reconcile') {
      throw new AppError('UPSTREAM_STATE_UNKNOWN', 'Dograh intake capture requires reconciliation', 409, true, 'The customer request is being reconciled.');
    }

    const intake = await deps.repository.createIntake({
      tenantId,
      customer: {
        name: body.customer.name,
        phone: body.customer.phone ?? null,
        email: body.customer.email ?? null,
      },
      sourceChannel: 'dograh_voice',
      dograhWorkflowId: body.workflow_id === undefined ? null : String(body.workflow_id),
      dograhWorkflowRunId: String(body.workflow_run_id),
      serviceIntent: body.service_intent,
      requirements: { ...body.requirements, building_type: body.location.building_type },
      location: body.location,
      notes: body.notes ?? null,
    });
    const result = {
      ok: true,
      intake_id: intake.id,
      customer_id: intake.customerId,
      status: 'captured',
      source_channel: 'dograh_voice',
      missing_fields: [],
      next_allowed_actions: ['search_offerings', 'prepare_quote'],
    };
    await deps.idempotency.succeed(begin.operation.id, begin.executionId, result);
    return result;
  });

  app.post('/v1/dograh/tools/prepare-quote', async (request) => {
    requireDograhRuntime(request);
    const body = parse(prepareSchema, request.body);
    const result = await deps.prepare.prepare({
      tenantId: request.bridgePrincipal!.tenantId,
      idempotencyKey: dograhMutationIdempotencyKey(request as any, body.workflow_run_id, 'prepare_quote'),
      request: body,
    });
    return {
      ...result,
      approval_required: true,
      voice_safe_message: 'Quotation prepared for human review. I cannot approve or send it for you.',
    };
  });
}

