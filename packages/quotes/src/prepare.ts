import { AppError } from '@frontdesk-q/contracts';
import { IdempotencyCoordinator, type BridgeOperation } from '@frontdesk-q/idempotency';
import {
  PriceResolutionService,
  deriveMarkup,
  snapshotServiceRateBook,
  type InternalResolvedPrice,
  type PriceBookRepository,
  type PricingProviderClientFactory,
} from '@frontdesk-q/pricing';
import type { QuoteRepository } from './repository.js';
import type { PrepareQuoteInput, PrepareQuoteResult, QuoteRecord } from './types.js';
import {
  extractProjectRefs,
  projectsFromSearch,
  type QuoteProviderClient,
  type QuoteProviderClientFactory,
} from './provider.js';
import { blockingWarnings, extractAuthoritativeTotals } from './calculation.js';

function locationString(location: Record<string, unknown>): string {
  const values = [location.address, location.city, location.state, location.country]
    .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
    .map((x) => x.trim());
  return [...new Set(values)].join(', ') || 'Not specified';
}

function missingRequirements(intake: {
  customerName: string;
  customerPhone: string | null;
  requirements: Record<string, unknown>;
  location: Record<string, unknown>;
}): string[] {
  const missing: string[] = [];
  if (!intake.customerName?.trim()) missing.push('customer.name');
  if (!intake.customerPhone?.trim()) missing.push('customer.phone');
  if (typeof intake.location.city !== 'string' || !intake.location.city.trim()) {
    missing.push('location.city');
  }
  if (
    !Number.isFinite(Number(intake.requirements.quantity)) ||
    Number(intake.requirements.quantity) <= 0
  ) {
    missing.push('requirements.quantity');
  }
  if (typeof intake.requirements.capacity !== 'string' || !intake.requirements.capacity.trim()) {
    missing.push('requirements.capacity');
  }
  if (
    typeof intake.requirements.building_type !== 'string' ||
    !intake.requirements.building_type.trim()
  ) {
    missing.push('requirements.building_type');
  }
  return missing;
}

function aggregateProposals(input: PrepareQuoteInput['line_proposals']) {
  const map = new Map<string, { offering_ref: string; quantity: number; uom: string }>();
  for (const proposal of input) {
    const key = `${proposal.offering_ref}:${proposal.uom.trim().toUpperCase()}`;
    const existing = map.get(key);
    if (existing) existing.quantity += proposal.quantity;
    else map.set(key, { ...proposal });
  }
  return [...map.values()];
}

function lineId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const object = payload as Record<string, any>;
  return String(object.id ?? object.item?.id ?? object.worksheetItem?.id ?? '') || null;
}

function worksheetId(payload: unknown, expectedName?: string): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const object = payload as Record<string, any>;
  const direct = String(object.id ?? object.worksheet?.id ?? '') || null;
  if (direct) return direct;
  if (!expectedName) return null;
  const matches = workspaceWorksheets(payload).filter(
    (worksheet) => worksheet.name === expectedName,
  );
  return matches.length === 1 ? String(matches[0]!.id ?? '') || null : null;
}

function workspaceWorksheets(payload: unknown): Array<Record<string, any>> {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, any>;
  const direct = root.worksheets;
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(root.workspace?.worksheets)) return root.workspace.worksheets;
  if (Array.isArray(root.workspaceState?.worksheets)) return root.workspaceState.worksheets;
  return [];
}

function lineFromPayload(payload: unknown, sourceNotes: string): Record<string, any> | null {
  const directId = lineId(payload);
  if (directId && payload && typeof payload === 'object') return payload as Record<string, any>;
  const matches = workspaceWorksheets(payload)
    .flatMap((worksheet) => (Array.isArray(worksheet.items) ? worksheet.items : []))
    .filter((item) => item.sourceNotes === sourceNotes);
  return matches.length === 1 ? matches[0]! : null;
}

function asAppError(error: unknown): AppError | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Partial<AppError>;
  return typeof candidate.code === 'string' && typeof candidate.retryable === 'boolean'
    ? (error as AppError)
    : null;
}

function safeWorkflowCode(error: unknown): AppError['code'] | null {
  const appError = asAppError(error);
  if (!appError) return null;
  return [
    'OFFERING_NOT_FOUND',
    'PRICE_NOT_FOUND',
    'PRICE_BOOK_NOT_FOUND',
    'PRICE_BOOK_NOT_ACTIVE',
    'PRICE_BOOK_EXPIRED',
    'UNIT_MISMATCH',
    'RATE_SNAPSHOT_FAILED',
    'RATE_ITEM_NOT_FOUND',
  ].includes(appError.code)
    ? appError.code
    : null;
}

export class QuotePreparationService {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly priceBooks: PriceBookRepository,
    private readonly prices: PriceResolutionService,
    private readonly quoteClients: QuoteProviderClientFactory,
    private readonly pricingClients: PricingProviderClientFactory,
    private readonly idempotency: IdempotencyCoordinator,
  ) {}

  private async needsReview(input: {
    operation: BridgeOperation;
    executionId: string;
    quote: QuoteRecord;
    reasons: string[];
    requirementsComplete: boolean;
    pricingComplete: boolean;
    calculationValid: boolean;
    warnings?: string[];
  }): Promise<PrepareQuoteResult> {
    const validation = {
      requirements_complete: input.requirementsComplete,
      pricing_complete: input.pricingComplete,
      calculation_valid: input.calculationValid,
      blocking_reasons: [...new Set(input.reasons)],
      warnings: [...new Set(input.warnings ?? [])],
    };
    await this.quotes.updateQuote(input.quote.tenantId, input.quote.id, {
      status: 'needs_review',
      validation,
    });
    const result: PrepareQuoteResult = {
      ok: true,
      quote_id: input.quote.id,
      ...(input.quote.quoteNumber ? { quote_number: input.quote.quoteNumber } : {}),
      state: 'needs_review',
      validation,
      user_safe_message:
        'I have captured your request, but our team needs to review part of the scope before pricing it.',
    };
    await this.idempotency.succeed(input.operation.id, input.executionId, result);
    return result;
  }

  private async markUpstreamUnknown(input: {
    operation: BridgeOperation;
    executionId: string;
    quote: QuoteRecord;
    code?: string;
    message: string;
    userSafeMessage: string;
  }): Promise<never> {
    await this.quotes.updateQuote(input.quote.tenantId, input.quote.id, {
      status: 'upstream_unknown',
    });
    await this.idempotency.upstreamUnknown(
      input.operation.id,
      input.executionId,
      input.code ?? 'UPSTREAM_STATE_UNKNOWN',
    );
    throw new AppError(
      'UPSTREAM_STATE_UNKNOWN',
      input.message,
      409,
      true,
      input.userSafeMessage,
    );
  }

  private async reconcileProject(
    client: QuoteProviderClient,
    quote: QuoteRecord,
  ): Promise<ReturnType<typeof extractProjectRefs>> {
    const marker = quote.providerCorrelation;
    if (!marker) return null;

    const search = await client.searchProjects(marker, 50);
    const candidates = projectsFromSearch(search).filter((project) =>
      String(project.name ?? '').includes(marker),
    );
    if (candidates.length !== 1) return null;

    let refs = extractProjectRefs(candidates[0]);
    if (!refs) refs = extractProjectRefs(await client.getProject(String(candidates[0]!.id)));
    return refs;
  }

  private async reconcileWorksheet(
    client: QuoteProviderClient,
    quote: QuoteRecord,
  ): Promise<string | null> {
    if (!quote.bidwrightProjectId) return null;
    const workspace = await client.getWorkspace(quote.bidwrightProjectId);
    const matches = workspaceWorksheets(workspace).filter((x) => x.name === 'FDQ Quotation');
    if (matches.length !== 1) return null;
    return String(matches[0]!.id ?? '') || null;
  }

  private async reconcileLine(
    client: QuoteProviderClient,
    quote: QuoteRecord,
    sourceNotes: string,
  ): Promise<Record<string, any> | null> {
    if (!quote.bidwrightProjectId) return null;
    const workspace = await client.getWorkspace(quote.bidwrightProjectId);
    const matches = workspaceWorksheets(workspace)
      .flatMap((worksheet) => (Array.isArray(worksheet.items) ? worksheet.items : []))
      .filter((item) => item.sourceNotes === sourceNotes);
    return matches.length === 1 ? matches[0]! : null;
  }

  async prepare(input: {
    tenantId: string;
    idempotencyKey: string;
    request: PrepareQuoteInput;
  }): Promise<PrepareQuoteResult> {
    const begin = await this.idempotency.begin({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: 'quote.prepare',
      requestBody: input.request,
    });

    if (begin.kind === 'replay') return begin.response as PrepareQuoteResult;
    if (begin.kind === 'in_progress') {
      throw new AppError(
        'OPERATION_IN_PROGRESS',
        'Quote preparation is already in progress',
        409,
        true,
        'The quotation is still being prepared.',
      );
    }
    if (begin.kind === 'failed') {
      throw new AppError(
        'INTERNAL_ERROR',
        `Previous operation failed terminally: ${begin.operation.lastErrorCode ?? 'unknown'}`,
        409,
        false,
        'This quotation request requires staff review.',
      );
    }

    const operation = begin.operation;
    const executionId = begin.executionId;
    const intake = await this.quotes.getIntake(input.tenantId, input.request.intake_id);
    if (!intake) {
      await this.idempotency.failTerminal(operation.id, executionId, 'INTAKE_NOT_FOUND');
      throw new AppError(
        'VALIDATION_ERROR',
        'Intake was not found for this tenant',
        404,
        false,
        'The customer request could not be found.',
      );
    }

    let quote: QuoteRecord | null = operation.bridgeResourceId
      ? await this.quotes.getQuote(input.tenantId, operation.bridgeResourceId)
      : null;

    if (!quote) {
      const marker = `FDQ-${operation.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`;
      quote = await this.quotes.createQuoteShell({
        tenantId: input.tenantId,
        intakeId: intake.id,
        title: input.request.title,
        scope: input.request.scope,
        providerCorrelation: marker,
      });
      await this.idempotency.checkpoint(operation.id, executionId, 'quote_shell', {
        bridgeResourceId: quote.id,
      });
    }

    const missing = missingRequirements(intake);
    if (!input.request.line_proposals.length) missing.push('line_proposals');
    if (missing.length) {
      return this.needsReview({
        operation,
        executionId,
        quote,
        reasons: ['MISSING_REQUIRED_FIELD', ...missing.map((x) => `MISSING:${x}`)],
        requirementsComplete: false,
        pricingComplete: false,
        calculationValid: false,
      });
    }

    const proposals = aggregateProposals(input.request.line_proposals);
    const resolved: InternalResolvedPrice[] = [];
    try {
      for (const proposal of proposals) {
        resolved.push(
          await this.prices.resolveInternal({
            tenantId: input.tenantId,
            offeringRef: proposal.offering_ref,
            quantity: proposal.quantity,
            requestedUom: proposal.uom,
          }),
        );
      }
    } catch (error) {
      const safeCode = safeWorkflowCode(error);
      if (safeCode) {
        return this.needsReview({
          operation,
          executionId,
          quote,
          reasons: [safeCode],
          requirementsComplete: true,
          pricingComplete: false,
          calculationValid: false,
        });
      }
      const appError = asAppError(error);
      if (appError?.retryable) {
        return this.markUpstreamUnknown({
          operation,
          executionId,
          quote,
          code: appError.code,
          message: `Bidwright pricing resolution is unavailable: ${appError.code}`,
          userSafeMessage: 'The quotation is being reconciled.',
        });
      }
      throw error;
    }

    const priceBookIds = [...new Set(resolved.map((x) => x.priceBook.id))];
    if (priceBookIds.length !== 1) {
      return this.needsReview({
        operation,
        executionId,
        quote,
        reasons: ['PRICE_BOOK_NOT_ACTIVE'],
        requirementsComplete: true,
        pricingComplete: false,
        calculationValid: false,
      });
    }
    const priceBook = resolved[0]!.priceBook;
    let provider: QuoteProviderClient;
    try {
      provider = await this.quoteClients.forTenant(input.tenantId);
    } catch (error) {
      const appError = asAppError(error);
      if (appError?.retryable) {
        return this.markUpstreamUnknown({
          operation,
          executionId,
          quote,
          code: appError.code,
          message: `Bidwright quote client is unavailable: ${appError.code}`,
          userSafeMessage: 'The quotation is being reconciled.',
        });
      }
      throw error;
    }

    if (begin.kind === 'reconcile' && operation.currentStep === 'create_project_uncertain') {
      const refs = await this.reconcileProject(provider, quote);
      if (!refs) {
        await this.idempotency.upstreamUnknown(operation.id, executionId);
        throw new AppError(
          'UPSTREAM_STATE_UNKNOWN',
          'Could not uniquely reconcile the Bidwright project after an uncertain create',
          409,
          true,
          'The quotation is being reconciled and requires another status check.',
        );
      }
      await this.quotes.updateQuote(input.tenantId, quote.id, {
        ...(refs.quoteNumber ? { quoteNumber: refs.quoteNumber } : {}),
        bidwrightProjectId: refs.projectId,
        bidwrightQuoteId: refs.quoteId,
        bidwrightRevisionId: refs.revisionId,
        status: 'estimating',
      });
      await this.idempotency.checkpoint(operation.id, executionId, 'project_reconciled', {
        bidwrightProjectId: refs.projectId,
        bidwrightQuoteId: refs.quoteId,
        bidwrightRevisionId: refs.revisionId,
      });
      quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;
    }

    if (!quote.bidwrightProjectId || !quote.bidwrightQuoteId || !quote.bidwrightRevisionId) {
      await this.idempotency.markProviderCreateUncertain(
        operation.id,
        executionId,
        'create_project_uncertain',
      );
      try {
        const created = await provider.createProject({
          name: `[${quote.providerCorrelation}] ${input.request.title}`,
          clientName: intake.customerName,
          location: locationString(intake.location),
          scope: input.request.scope,
          creationMode: 'intake',
          isStandalone: true,
          summary: `Frontdesk-Q correlation ${quote.providerCorrelation}`,
        });
        const refs = extractProjectRefs(created);
        if (!refs) throw new Error('BIDWRIGHT_PROJECT_CREATE_RESPONSE_INVALID');

        await this.quotes.updateQuote(input.tenantId, quote.id, {
          ...(refs.quoteNumber ? { quoteNumber: refs.quoteNumber } : {}),
          bidwrightProjectId: refs.projectId,
          bidwrightQuoteId: refs.quoteId,
          bidwrightRevisionId: refs.revisionId,
          status: 'estimating',
        });
        await this.idempotency.checkpoint(operation.id, executionId, 'project_created', {
          bidwrightProjectId: refs.projectId,
          bidwrightQuoteId: refs.quoteId,
          bidwrightRevisionId: refs.revisionId,
        });
        quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;
      } catch (error) {
        const appError = asAppError(error);
        if (appError?.retryable) {
          await this.quotes.updateQuote(input.tenantId, quote.id, { status: 'upstream_unknown' });
          await this.idempotency.upstreamUnknown(operation.id, executionId);
          throw new AppError(
            'UPSTREAM_STATE_UNKNOWN',
            `Bidwright project creation outcome is uncertain: ${appError.code}`,
            409,
            true,
            'The quotation is being reconciled.',
          );
        }
        await this.idempotency.failTerminal(
          operation.id,
          executionId,
          'BIDWRIGHT_PROJECT_CREATE_FAILED',
        );
        throw error;
      }
    }

    const serviceCodes = [
      ...new Set(
        resolved
          .filter((x) => x.offering.offeringType === 'service')
          .map((x) => x.offering.canonicalCode),
      ),
    ];

    let serviceSnapshot: Record<string, string> = {};
    let serviceTierSnapshot: Record<string, string> = {};
    if (serviceCodes.length) {
      try {
        const snapshotWasAlreadyBound = Boolean(quote.bidwrightRateScheduleSnapshotId);
        if (!snapshotWasAlreadyBound) {
          await this.idempotency.markProviderCreateUncertain(
            operation.id,
            executionId,
            'snapshot_uncertain',
          );
        }
        const snapshot = await snapshotServiceRateBook({
          tenantId: input.tenantId,
          bridgeQuoteId: quote.id,
          projectId: quote.bidwrightProjectId!,
          revisionId: quote.bidwrightRevisionId!,
          priceBookId: priceBook.id,
          requiredServiceCodes: serviceCodes,
          repository: this.priceBooks,
          clients: this.pricingClients,
        });
        serviceSnapshot = snapshot.serviceRateItemIdsByCode;
        serviceTierSnapshot = snapshot.serviceTierIdsByCode;
        await this.quotes.updateQuote(input.tenantId, quote.id, {
          bidwrightRateScheduleSnapshotId: snapshot.snapshotScheduleId,
          status: 'estimating',
        });
        if (!snapshotWasAlreadyBound) {
          await this.idempotency.checkpoint(operation.id, executionId, 'rate_snapshot_ready');
        }
        quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;
      } catch (error) {
        const safeCode = safeWorkflowCode(error);
        if (safeCode) {
          return this.needsReview({
            operation,
            executionId,
            quote,
            reasons: [safeCode],
            requirementsComplete: true,
            pricingComplete: false,
            calculationValid: false,
          });
        }
        const appError = asAppError(error);
        if (appError?.retryable) {
          await this.idempotency.upstreamUnknown(operation.id, executionId);
          throw new AppError(
            'UPSTREAM_STATE_UNKNOWN',
            'Rate snapshot outcome is uncertain',
            409,
            true,
            'The quotation rate book is being reconciled.',
          );
        }
        throw error;
      }
    }

    if (begin.kind === 'reconcile' && operation.currentStep === 'create_worksheet_uncertain') {
      const reconciledId = await this.reconcileWorksheet(provider, quote);
      if (!reconciledId) {
        await this.idempotency.upstreamUnknown(operation.id, executionId);
        throw new AppError(
          'UPSTREAM_STATE_UNKNOWN',
          'Could not reconcile worksheet creation',
          409,
          true,
          'The quotation worksheet is being reconciled.',
        );
      }
      await this.quotes.updateQuote(input.tenantId, quote.id, {
        bidwrightWorksheetId: reconciledId,
      });
      await this.idempotency.checkpoint(operation.id, executionId, 'worksheet_reconciled');
      quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;
    }

    if (!quote.bidwrightWorksheetId) {
      await this.idempotency.markProviderCreateUncertain(
        operation.id,
        executionId,
        'create_worksheet_uncertain',
      );
      try {
        const created = await provider.createWorksheet(quote.bidwrightProjectId!, {
          name: 'FDQ Quotation',
          order: 0,
        });
        const id = worksheetId(created, 'FDQ Quotation');
        if (!id) throw new Error('BIDWRIGHT_WORKSHEET_CREATE_RESPONSE_INVALID');
        await this.quotes.updateQuote(input.tenantId, quote.id, { bidwrightWorksheetId: id });
        await this.idempotency.checkpoint(operation.id, executionId, 'worksheet_created');
        quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;
      } catch (error) {
        const appError = asAppError(error);
        if (appError?.retryable) {
          await this.idempotency.upstreamUnknown(operation.id, executionId);
          throw new AppError(
            'UPSTREAM_STATE_UNKNOWN',
            'Worksheet creation outcome is uncertain',
            409,
            true,
            'The quotation worksheet is being reconciled.',
          );
        }
        throw error;
      }
    }

    for (const item of resolved) {
      if (
        await this.quotes.hasQuoteItem(input.tenantId, quote.id, item.offering.publicRef, item.uom)
      ) {
        continue;
      }

      const sourceNotes = `FDQ:${quote.id}:${item.offering.publicRef}`;
      let providerLine: Record<string, any> | null = null;

      if (
        begin.kind === 'reconcile' &&
        operation.currentStep === `create_item_uncertain:${item.offering.publicRef}`
      ) {
        providerLine = await this.reconcileLine(provider, quote, sourceNotes);
        if (!providerLine) {
          await this.idempotency.upstreamUnknown(operation.id, executionId);
          throw new AppError(
            'UPSTREAM_STATE_UNKNOWN',
            `Could not reconcile line item ${item.offering.publicRef}`,
            409,
            true,
            'A quotation line is being reconciled.',
          );
        }
      } else {
        await this.idempotency.markProviderCreateUncertain(
          operation.id,
          executionId,
          `create_item_uncertain:${item.offering.publicRef}`,
        );

        const base = {
          categoryId:
            item.offering.offeringType === 'product'
              ? priceBook.productCategoryId
              : priceBook.serviceCategoryId,
          category: item.offering.offeringType === 'product' ? 'HVAC Product' : 'HVAC Service',
          entityType: item.offering.offeringType === 'product' ? 'HVACProduct' : 'HVACService',
          entityName: item.offering.name,
          description: item.offering.name,
          quantity: item.quantity,
          uom: item.uom,
          itemId: item.offering.bidwrightCatalogItemId,
          sourceNotes,
        };

        try {
          providerLine =
            item.offering.offeringType === 'product'
              ? await provider.createWorksheetItem(
                  quote.bidwrightProjectId!,
                  quote.bidwrightWorksheetId!,
                  {
                    ...base,
                    cost: item.unitCost,
                    markup: deriveMarkup(item.unitCost, item.unitPrice),
                  },
                )
              : await provider.createWorksheetItem(
                  quote.bidwrightProjectId!,
                  quote.bidwrightWorksheetId!,
                  {
                    ...base,
                    rateScheduleItemId: serviceSnapshot[item.offering.canonicalCode],
                    ...(serviceTierSnapshot[item.offering.canonicalCode]
                      ? {
                          tierUnits: {
                            [serviceTierSnapshot[item.offering.canonicalCode]!]: item.quantity,
                          },
                        }
                      : {}),
                  },
                );
          providerLine = lineFromPayload(providerLine, sourceNotes) ?? providerLine;
        } catch (error) {
          const appError = asAppError(error);
          if (appError?.retryable) {
            await this.idempotency.upstreamUnknown(operation.id, executionId);
            throw new AppError(
              'UPSTREAM_STATE_UNKNOWN',
              `Line creation outcome is uncertain for ${item.offering.publicRef}`,
              409,
              true,
              'A quotation line is being reconciled.',
            );
          }
          throw error;
        }
      }

      await this.quotes.addQuoteItem({
        tenantId: input.tenantId,
        quoteId: quote.id,
        offeringRef: item.offering.publicRef,
        itemType: item.offering.offeringType,
        bidwrightItemId: lineId(providerLine),
        bidwrightRateScheduleItemId:
          item.offering.offeringType === 'service'
            ? (serviceSnapshot[item.offering.canonicalCode] ?? null)
            : null,
        description: item.offering.name,
        quantity: item.quantity,
        uom: item.uom,
        unitPrice: item.unitPrice,
        extendedPrice: item.extendedPrice,
      });
      await this.idempotency.checkpoint(
        operation.id,
        executionId,
        `item_created:${item.offering.publicRef}`,
      );
    }

    let recalculated: Record<string, any>;
    try {
      await this.idempotency.checkpoint(operation.id, executionId, 'recalculate');
      recalculated = await provider.recalculateProject(quote.bidwrightProjectId!);
    } catch (error) {
      const appError = asAppError(error);
      if (appError?.retryable) throw appError;
      return this.needsReview({
        operation,
        executionId,
        quote,
        reasons: ['CALCULATION_FAILED'],
        requirementsComplete: true,
        pricingComplete: true,
        calculationValid: false,
      });
    }

    const totals = extractAuthoritativeTotals(recalculated, quote.bidwrightRevisionId!);
    if (!totals) {
      return this.needsReview({
        operation,
        executionId,
        quote,
        reasons: ['CALCULATION_FAILED'],
        requirementsComplete: true,
        pricingComplete: true,
        calculationValid: false,
      });
    }

    const warningBlocks = blockingWarnings(totals.warnings);
    if (warningBlocks.length) {
      return this.needsReview({
        operation,
        executionId,
        quote,
        reasons: ['CALCULATION_WARNING_BLOCKING'],
        requirementsComplete: true,
        pricingComplete: true,
        calculationValid: false,
        warnings: totals.warnings,
      });
    }

    const validation = {
      requirements_complete: true,
      pricing_complete: true,
      calculation_valid: true,
      blocking_reasons: [],
      warnings: totals.warnings,
    };
    await this.quotes.updateQuote(input.tenantId, quote.id, {
      status: 'pending_approval',
      currency: priceBook.currency,
      ...(totals.subtotal !== null ? { subtotal: totals.subtotal } : {}),
      grandTotal: totals.grandTotal,
      calculationHash: totals.calculationHash,
      validation,
    });
    quote = (await this.quotes.getQuote(input.tenantId, quote.id))!;

    const result: PrepareQuoteResult = {
      ok: true,
      quote_id: quote.id,
      ...(quote.quoteNumber ? { quote_number: quote.quoteNumber } : {}),
      state: 'pending_approval',
      currency: quote.currency,
      ...(quote.subtotal !== null ? { subtotal: quote.subtotal } : {}),
      grand_total: totals.grandTotal,
      validation,
      user_safe_message: 'Your quotation has been prepared and is awaiting review.',
    };
    await this.idempotency.succeed(operation.id, executionId, result);
    return result;
  }
}
