import { describe, expect, it } from 'vitest';
import { IdempotencyCoordinator } from '@frontdesk-q/idempotency';
import { PriceResolutionService } from '@frontdesk-q/pricing';
import { QuotePreparationService } from '@frontdesk-q/quotes';
import { buildM1Fixture, canonicalM1Request } from './fixtures.js';

describe('M1 — deterministic quote without voice', () => {
  it('Ahmad + Ipoh + 3 x 2HP supply/install becomes one pending-approval quote', async () => {
    const fx = await buildM1Fixture();

    const product = await fx.search.search({
      tenantId: 'tenant-hvac',
      query: '2HP aircond',
      types: ['product'],
    });
    const service = await fx.search.search({
      tenantId: 'tenant-hvac',
      query: 'install 2HP aircond',
      types: ['service'],
    });

    expect(product.ambiguous).toBe(false);
    expect(product.items[0]?.offering_ref).toBe('off-ac20');
    expect(service.items[0]?.offering_ref).toBe('off-install20');

    const result = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-happy',
      request: canonicalM1Request(fx.intake.id),
    });

    expect(result.state).toBe('pending_approval');
    expect(result.grand_total).toBe(7800);
    expect(result.validation.blocking_reasons).toEqual([]);
    expect(fx.provider.createProjectCount).toBe(1);
    expect(fx.provider.createWorksheetCount).toBe(1);
    expect(fx.provider.createLineCount).toBe(2);
    expect(fx.quotes.items).toHaveLength(2);

    const stored = await fx.quotes.getQuote('tenant-hvac', result.quote_id);
    expect(stored?.bidwrightRevisionId).toBe('rev-1');
    expect(stored?.bidwrightRateScheduleSnapshotId).toBe('rs-snapshot');
    expect(stored?.status).toBe('pending_approval');
  });

  it('same idempotency key returns exactly one quotation and one provider project', async () => {
    const fx = await buildM1Fixture();
    const request = canonicalM1Request(fx.intake.id);

    const first = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-duplicate',
      request,
    });
    const second = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-duplicate',
      request,
    });

    expect(second).toEqual(first);
    expect(fx.provider.createProjectCount).toBe(1);
    expect(fx.provider.createLineCount).toBe(2);
    expect(fx.quotes.quotes).toHaveLength(1);
  });

  it('reconciles a provider project after create committed but response timed out', async () => {
    const fx = await buildM1Fixture({ providerBehavior: 'create_then_timeout' });
    const request = canonicalM1Request(fx.intake.id);

    await expect(
      fx.prepare.prepare({
        tenantId: 'tenant-hvac',
        idempotencyKey: 'm1-timeout',
        request,
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_STATE_UNKNOWN' });

    // Simulate a new Bridge process/service object using the same durable stores.
    const restartedCoordinator = new IdempotencyCoordinator(fx.operations, 30_000);
    const restartedPrices = new PriceResolutionService(fx.priceBooks, fx.factory);
    const restarted = new QuotePreparationService(
      fx.quotes,
      fx.priceBooks,
      restartedPrices,
      fx.factory,
      fx.factory,
      restartedCoordinator,
    );

    const result = await restarted.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-timeout',
      request,
    });

    expect(result.state).toBe('pending_approval');
    expect(result.grand_total).toBe(7800);
    expect(fx.provider.createProjectCount).toBe(1);
  });

  it('stops safely at NEEDS_REVIEW when a service sell rate is missing', async () => {
    const fx = await buildM1Fixture({ masterRateMissing: true });
    const result = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-missing-price',
      request: canonicalM1Request(fx.intake.id),
    });

    expect(result.state).toBe('needs_review');
    expect(result.validation.blocking_reasons).toContain('PRICE_NOT_FOUND');
    expect(fx.provider.createProjectCount).toBe(0);
  });

  it('blocks an expired price book before any provider financial mutation', async () => {
    const fx = await buildM1Fixture({ expired: true });
    const result = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-expired',
      request: canonicalM1Request(fx.intake.id),
    });

    expect(result.state).toBe('needs_review');
    expect(result.validation.blocking_reasons).toContain('PRICE_BOOK_NOT_FOUND');
    expect(fx.provider.createProjectCount).toBe(0);
  });

  it('flags two equally plausible 2HP products instead of auto-selecting one', async () => {
    const fx = await buildM1Fixture({ duplicate2HpProduct: true });
    const result = await fx.search.search({
      tenantId: 'tenant-hvac',
      query: '2HP aircond',
      types: ['product'],
    });

    expect(result.ambiguous).toBe(true);
    expect(result.requires_confirmation).toBe(true);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(fx.provider.createProjectCount).toBe(0);
  });

  it('recovers an executing operation after a simulated Bridge process restart', async () => {
    const fx = await buildM1Fixture({ leaseMs: 1 });
    const request = canonicalM1Request(fx.intake.id);

    // Simulate process 1 reserving the mutation and persisting the Bridge quote shell.
    const begin = await fx.coordinator.begin({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-restart',
      operationType: 'quote.prepare',
      requestBody: request,
    });
    if (begin.kind !== 'execute') throw new Error('expected execute');

    const quote = await fx.quotes.createQuoteShell({
      tenantId: 'tenant-hvac',
      intakeId: fx.intake.id,
      title: request.title,
      scope: request.scope,
      providerCorrelation: `FDQ-${begin.operation.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`,
    });
    await fx.coordinator.checkpoint(begin.operation.id, begin.executionId, 'quote_shell', {
      bridgeResourceId: quote.id,
    });

    // Process dies. Lease expires. A fresh coordinator resumes from persisted state.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const coordinator2 = new IdempotencyCoordinator(fx.operations, 30_000);
    const prepare2 = new QuotePreparationService(
      fx.quotes,
      fx.priceBooks,
      new PriceResolutionService(fx.priceBooks, fx.factory),
      fx.factory,
      fx.factory,
      coordinator2,
    );

    const result = await prepare2.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-restart',
      request,
    });

    expect(result.state).toBe('pending_approval');
    expect(result.grand_total).toBe(7800);
    expect(fx.quotes.quotes).toHaveLength(1);
    expect(fx.provider.createProjectCount).toBe(1);
  });

  it('blocks a UOM mismatch before project creation', async () => {
    const fx = await buildM1Fixture();
    const request = canonicalM1Request(fx.intake.id);
    request.line_proposals[0]!.uom = 'M';

    const result = await fx.prepare.prepare({
      tenantId: 'tenant-hvac',
      idempotencyKey: 'm1-uom',
      request,
    });

    expect(result.state).toBe('needs_review');
    expect(result.validation.blocking_reasons).toContain('UNIT_MISMATCH');
    expect(fx.provider.createProjectCount).toBe(0);
  });
});
