import { describe, expect, it } from 'vitest';
import { hashBridgeToken } from '@frontdesk-q/auth';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { InMemoryQuoteRepository } from '@frontdesk-q/quotes';
import { buildApp } from '../src/app.js';
import { registerDograhRoutes } from '../src/routes/dograh-routes.js';

const pepper = 'd'.repeat(32);

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

function idempotency() {
  const calls: any[] = [];
  return {
    calls,
    begin: async (input: any) => {
      calls.push(input);
      return {
        kind: 'execute' as const,
        operation: { id: 'op_dograh' },
        executionId: 'exec_dograh',
      };
    },
    succeed: async () => undefined,
  };
}

function appFor(role: 'tenant_owner' | 'ai_runtime' = 'ai_runtime') {
  const repository = new InMemoryQuoteRepository();
  const app = buildApp({
    tenantRepository: tenantRepo(role),
    bridgeTokenPepper: pepper,
    readinessCheck: async () => true,
    logger: false,
  });
  const prepareCalls: any[] = [];
  const idem = idempotency();
  const deps = {
    repository,
    idempotency: idem as any,
    offerings: {
      search: async (input: any) => ({
        ok: true,
        query: input.query,
        ambiguous: false,
        requires_confirmation: false,
        items: [
          {
            offering_ref: 'off_demo_2hp',
            type: 'product',
            name: 'DemoAir 2HP inverter air conditioner',
            code: 'HVAC-AC-20',
            uom: 'EA',
            match_confidence: 0.98,
            price_disclosure: 'quote_only',
          },
        ],
      }),
    },
    prices: {} as any,
    prepare: {
      prepare: async (input: any) => {
        prepareCalls.push(input);
        return {
          ok: true,
          quote_id: 'quote_dograh_1',
          quote_number: 'BW-DOGRAH-1',
          state: 'pending_approval',
          currency: 'MYR',
          grand_total: 10499.85,
          validation: {
            requirements_complete: true,
            pricing_complete: true,
            calculation_valid: true,
            blocking_reasons: [],
            warnings: [],
          },
        };
      },
    },
  };
  registerDograhRoutes(app, deps as any);
  return { app, repository, prepareCalls, idempotencyCalls: idem.calls };
}

const aiHeaders = {
  authorization: 'Bearer brg_ai_runtime',
  'x-tenant-id': 'tenant_a',
  'x-idempotency-key': 'dograh-idem-1',
};

const dograhLiteralHeader = 'dograh:{{workflow_run_id}}:capture_intake:1';

describe('Dograh voice runtime routes', () => {
  it('rejects human/operator credentials from voice runtime tools', async () => {
    const { app } = appFor('tenant_owner');
    const r = await app.inject({
      method: 'GET',
      url: '/v1/dograh/tools',
      headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('advertises only capture, search and prepare tools; approval stays forbidden', async () => {
    const { app } = appFor();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/dograh/tools',
      headers: { authorization: 'Bearer brg_ai_runtime', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.tools.map((tool: any) => tool.name)).toEqual([
      'capture_hvac_intake',
      'search_offerings',
      'prepare_quote',
    ]);
    expect(body.forbidden_tools).toContain('approve_quote');
    expect(body.forbidden_tools).toContain('deliver_quote');
    await app.close();
  });

  it('rejects malformed HVAC voice intake before persistence', async () => {
    const { app, repository } = appFor();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/dograh/tools/capture-hvac-intake',
      headers: aiHeaders,
      payload: {
        workflow_run_id: 'run_bad',
        customer: { name: 'Ahmad' },
        location: { city: 'Ipoh', building_type: 'office' },
        requirements: { quantity: 3 },
      },
    });
    expect(r.statusCode).toBe(422);
    expect(repository.intakes).toHaveLength(0);
    await app.close();
  });

  it('captures a Dograh HVAC intake as tenant-scoped voice data', async () => {
    const { app, repository, idempotencyCalls } = appFor();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/dograh/tools/capture-hvac-intake',
      headers: { ...aiHeaders, 'x-idempotency-key': dograhLiteralHeader },
      payload: {
        workflow_id: 'wf_hvac',
        workflow_run_id: 'run_hvac_1',
        customer: { name: 'Ahmad', phone: '+60123456789' },
        location: { city: 'Ipoh', state: 'Perak', building_type: 'office' },
        requirements: {
          equipment_type: 'air_conditioner',
          capacity: '2HP',
          quantity: 3,
          install_required: true,
        },
        notes: 'Voice caller requested supply and installation.',
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, status: 'captured', source_channel: 'dograh_voice' });
    expect(repository.intakes[0]?.tenantId).toBe('tenant_a');
    expect(repository.intakes[0]?.serviceIntent).toBe('hvac_quotation');
    expect(repository.intakes[0]?.requirements).toMatchObject({ capacity: '2HP', quantity: 3, building_type: 'office' });
    expect(idempotencyCalls[0].idempotencyKey).toBe('dograh:run_hvac_1:capture_intake:1');
    await app.close();
  });

  it('prepares an M1-equivalent voice quote but stops at pending human approval', async () => {
    const { app, prepareCalls } = appFor();
    const r = await app.inject({
      method: 'POST',
      url: '/v1/dograh/tools/prepare-quote',
      headers: { ...aiHeaders, 'x-idempotency-key': 'dograh:{{workflow_run_id}}:prepare_quote:1' },
      payload: {
        workflow_run_id: 'run_prepare_1',
        intake_id: '11111111-1111-4111-8111-111111111111',
        title: 'Dograh S5 HVAC quote',
        scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
        line_proposals: [
          { offering_ref: 'off_demo_2hp', quantity: 3, uom: 'EA' },
          { offering_ref: 'off_demo_install', quantity: 3, uom: 'EA' },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true,
      state: 'pending_approval',
      approval_required: true,
      voice_safe_message: 'Quotation prepared for human review. I cannot approve or send it for you.',
    });
    expect(prepareCalls[0].tenantId).toBe('tenant_a');
    expect(prepareCalls[0].idempotencyKey).toBe('dograh:run_prepare_1:prepare_quote:1');
    await app.close();
  });
});