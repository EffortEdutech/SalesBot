import { describe, expect, it } from 'vitest';
import { hashBridgeToken } from '@frontdesk-q/auth';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { InMemoryQuoteRepository, type QuoteRecord } from '@frontdesk-q/quotes';
import { buildApp } from '../src/app.js';
import { registerQuoteRoutes } from '../src/routes/quote-routes.js';

const pepper = 's'.repeat(32);

function tenantRepo(role: 'tenant_owner' | 'ai_runtime') {
  return new InMemoryTenantRepository([
    {
      tokenId: `tok_${role}`,
      tokenHash: hashBridgeToken(`brg_${role}`, pepper),
      tenantId: 'tenant_a',
      tenantName: 'Tenant A',
      tenantStatus: 'active',
      role,
      scopes: [],
      expiresAt: null,
      revokedAt: null,
    },
  ]);
}

function pendingQuote(id = '11111111-1111-4111-8111-111111111111'): QuoteRecord {
  return {
    id,
    tenantId: 'tenant_a',
    intakeId: null,
    quoteNumber: 'BW-S4-1',
    title: 'S4 test quote',
    scope: 'Approved human-control test scope',
    providerCorrelation: 's4-test',
    bidwrightProjectId: 'project_s4',
    bidwrightQuoteId: 'quote_s4',
    bidwrightRevisionId: 'revision_s4',
    bidwrightWorksheetId: 'worksheet_s4',
    bidwrightRateScheduleSnapshotId: 'rs_s4',
    status: 'pending_approval',
    currency: 'MYR',
    subtotal: 100,
    markup: null,
    tax: null,
    grandTotal: 100,
    calculationHash: 'calc_s4',
    validation: { requirements_complete: true, pricing_complete: true, calculation_valid: true },
  };
}

function idempotency() {
  return {
    begin: async () => ({
      kind: 'execute' as const,
      operation: { id: 'op_s4' },
      executionId: 'exec_s4',
    }),
    succeed: async () => undefined,
  };
}

function appFor(
  role: 'tenant_owner' | 'ai_runtime',
  quotes = new InMemoryQuoteRepository(),
  provider: { getMainPdf(projectId: string): Promise<Buffer> } = { getMainPdf: async () => Buffer.from('%PDF-S4') },
) {
  const app = buildApp({
    tenantRepository: tenantRepo(role),
    bridgeTokenPepper: pepper,
    readinessCheck: async () => true,
    logger: false,
  });
  registerQuoteRoutes(app, {
    repository: quotes,
    prepare: {} as any,
    idempotency: idempotency() as any,
    provider,
  });
  return { app, quotes };
}

const humanHeaders = {
  authorization: 'Bearer brg_tenant_owner',
  'x-tenant-id': 'tenant_a',
  'x-idempotency-key': 'idem-s4',
};

describe('S4 quote approval and delivery routes', () => {
  it('rejects AI runtime approval authority', async () => {
    const { app, quotes } = appFor('ai_runtime');
    quotes.quotes.push(pendingQuote());
    const r = await app.inject({
      method: 'POST',
      url: '/v1/quotes/11111111-1111-4111-8111-111111111111/approve',
      headers: {
        authorization: 'Bearer brg_ai_runtime',
        'x-tenant-id': 'tenant_a',
        'x-idempotency-key': 'idem-ai',
      },
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('lets a human approve exactly a pending quotation revision', async () => {
    const { app, quotes } = appFor('tenant_owner');
    quotes.quotes.push(pendingQuote());
    const r = await app.inject({
      method: 'POST',
      url: '/v1/quotes/11111111-1111-4111-8111-111111111111/approve',
      headers: humanHeaders,
      payload: { note: 'Approved by owner after review.' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, state: 'approved', bidwright_revision_id: 'revision_s4' });
    expect(quotes.quotes[0]?.status).toBe('approved');
    await app.close();
  });

  it('blocks PDF export until approval exists', async () => {
    const { app, quotes } = appFor('tenant_owner');
    quotes.quotes.push(pendingQuote());
    const r = await app.inject({
      method: 'GET',
      url: '/v1/quotes/11111111-1111-4111-8111-111111111111/pdf',
      headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('QUOTE_APPROVAL_REQUIRED');
    await app.close();
  });

  it('allows PDF download after a delivered quote remains approved', async () => {
    const { app, quotes } = appFor('tenant_owner');
    quotes.quotes.push({ ...pendingQuote(), status: 'sent' });
    const r = await app.inject({
      method: 'GET',
      url: '/v1/quotes/11111111-1111-4111-8111-111111111111/pdf',
      headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.body).toContain('%PDF-S4');
    await app.close();
  });

  it('records manual delivery only after human approval and stores the exact exported PDF hash', async () => {
    let generated = false;
    const suppliedHash = 'a'.repeat(64);
    const { app, quotes } = appFor('tenant_owner', new InMemoryQuoteRepository(), {
      getMainPdf: async () => {
        generated = true;
        return Buffer.from('%PDF-S4');
      },
    });
    quotes.quotes.push({ ...pendingQuote(), status: 'approved' });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/quotes/11111111-1111-4111-8111-111111111111/deliver',
      headers: humanHeaders,
      payload: { channel: 'manual', recipient: 'owner@example.test', pdf_sha256: suppliedHash },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, state: 'sent', delivery_status: 'sent', channel: 'manual' });
    expect(r.json().pdf_sha256).toBe(suppliedHash);
    expect(generated).toBe(false);
    expect(quotes.quotes[0]?.status).toBe('sent');
    await app.close();
  });
});