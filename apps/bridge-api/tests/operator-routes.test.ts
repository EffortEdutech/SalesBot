import { describe, expect, it } from 'vitest';
import { hashBridgeToken } from '@frontdesk-q/auth';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { buildApp } from '../src/app.js';
import { registerOperatorRoutes } from '../src/routes/operator-routes.js';

const pepper = 'o'.repeat(32);
function repo(role: 'tenant_owner' | 'ai_runtime') {
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
describe('operator routes', () => {
  it('rejects ai_runtime', async () => {
    const app = buildApp({
      tenantRepository: repo('ai_runtime'),
      bridgeTokenPepper: pepper,
      readinessCheck: async () => true,
      logger: false,
    });
    registerOperatorRoutes(app, { query: async () => ({ rows: [] }) } as any);
    const r = await app.inject({
      method: 'GET',
      url: '/v1/operator/overview',
      headers: { authorization: 'Bearer brg_ai_runtime', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });
  it('scopes human query to authenticated tenant', async () => {
    let values: unknown[] = [];
    const app = buildApp({
      tenantRepository: repo('tenant_owner'),
      bridgeTokenPepper: pepper,
      readinessCheck: async () => true,
      logger: false,
    });
    registerOperatorRoutes(app, {
      query: async (_sql: string, v: unknown[]) => {
        values = v;
        return {
          rows: [
            {
              new_intakes_24h: 1,
              pending_approval: 1,
              needs_review: 0,
              sent_24h: 0,
              pending_approval_value: 7800,
              upstream_unknown: 0,
            },
          ],
        };
      },
    } as any);
    const r = await app.inject({
      method: 'GET',
      url: '/v1/operator/overview',
      headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
    });
    expect(r.statusCode).toBe(200);
    expect(values[0]).toBe('tenant_a');
    await app.close();
  });
});

it('returns unified system diagnostics without exposing server secrets', async () => {
  const app = buildApp({
    tenantRepository: repo('tenant_owner'),
    bridgeTokenPepper: pepper,
    readinessCheck: async () => true,
    logger: false,
  });

  const query = async (sql: string, values?: unknown[]) => {
    if (sql.includes('from bridge_organizations o'))
      return {
        rows: [
          {
            tenant_id: 'tenant_a',
            tenant_name: 'Tenant A',
            industry: 'hvac',
            currency: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            tenant_status: 'active',
            token_id: 'tok_tenant_owner',
            operator_name: 'Dev Owner',
            role: 'tenant_owner',
          },
        ],
      };
    if (sql.includes('from tenant_price_books')) return { rows: [] };
    if (sql.includes("provider='dograh'")) return { rows: [] };
    if (sql.includes('information_schema.tables'))
      return {
        rows: [
          'bridge_api_tokens',
          'bridge_approvals',
          'bridge_audit_log',
          'bridge_connections',
          'bridge_customers',
          'bridge_deliveries',
          'bridge_events',
          'bridge_intakes',
          'bridge_offerings',
          'bridge_operations',
          'bridge_organizations',
          'bridge_quote_items',
          'bridge_quotes',
          'price_book_imports',
          'price_book_snapshots',
          'tenant_price_books',
          'tenant_template_bindings',
        ].map((table_name) => ({ table_name })),
      };
    if (sql.includes('information_schema.columns'))
      return {
        rows: [
          ['bridge_operations', 'lease_owner'],
          ['bridge_operations', 'lease_expires_at'],
          ['bridge_quotes', 'quote_number'],
          ['bridge_quotes', 'provider_correlation'],
          ['bridge_quotes', 'validation_json'],
        ].map(([table_name, column_name]) => ({ table_name, column_name })),
      };
    throw new Error(`Unexpected query: ${sql} ${JSON.stringify(values)}`);
  };

  registerOperatorRoutes(app, { query } as any, {
    appEnv: 'development',
    bridgePort: 4170,
    bidwrightBaseUrl: 'http://bidwright.test',
    fetchImpl: async () => new Response('', { status: 404 }),
  });

  const r = await app.inject({
    method: 'GET',
    url: '/v1/operator/system',
    headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
  });
  expect(r.statusCode).toBe(200);
  const body = r.json();
  expect(body.bridge.port).toBe(4170);
  expect(body.database.status).toBe('connected');
  expect(body.migrations.status).toBe('ready');
  expect(body.tenant.id).toBe('tenant_a');
  expect(body.operator.name).toBe('Dev Owner');
  expect(body.bidwright.status).toBe('reachable');
  expect(body.price_book.status).toBe('missing');
  expect(JSON.stringify(body)).not.toContain('BRIDGE_TOKEN_PEPPER');
  expect(JSON.stringify(body)).not.toContain('DATABASE_URL');
  await app.close();
});

it('returns quote review detail with commercial evidence scoped to the tenant', async () => {
  const app = buildApp({
    tenantRepository: repo('tenant_owner'),
    bridgeTokenPepper: pepper,
    readinessCheck: async () => true,
    logger: false,
  });

  const seenValues: unknown[][] = [];
  const query = async (sql: string, values?: unknown[]) => {
    seenValues.push(values ?? []);
    if (sql.includes('from bridge_quotes q') && sql.includes('where q.tenant_id=$1 and q.id=$2')) {
      return {
        rows: [
          {
            id: 'quote_1',
            quote_number: 'BW-S4-DETAIL',
            customer_name: 'Ahmad',
            customer_phone: '+60123456789',
            customer_email: null,
            title: 'S4 quote',
            scope: 'Supply and install 3 x 2HP AC units.',
            status: 'approved',
            approval_status: 'approved',
            revision_number: 0,
            currency: 'MYR',
            subtotal: '10499.85',
            markup: null,
            tax: null,
            grand_total: '10499.85',
            bidwright_project_id: 'project_1',
            bidwright_quote_id: 'quote_bw_1',
            bidwright_revision_id: 'revision_1',
            bidwright_worksheet_id: 'worksheet_1',
            bidwright_rate_schedule_snapshot_id: 'snapshot_1',
            calculation_hash: 'hash_1',
            validation_json: { warnings: [], blocking_reasons: [] },
            service_intent: 'air_conditioner_installation',
            requirements_json: { quantity: 3, capacity: '2HP' },
            location_json: { city: 'Ipoh' },
            intake_notes: 'Review detail test.',
            created_at: '2026-08-23T00:00:00.000Z',
            updated_at: '2026-08-23T00:00:00.000Z',
          },
        ],
      };
    }
    if (sql.includes('from bridge_quote_items')) {
      return { rows: [{ id: 'item_1', description: 'DemoAir 2HP', quantity: 3, uom: 'EA', extended_price: 6450 }] };
    }
    if (sql.includes('from bridge_approvals')) {
      return { rows: [{ id: 'approval_1', status: 'approved', bidwright_revision_id: 'revision_1', calculation_hash: 'hash_1' }] };
    }
    if (sql.includes('from bridge_deliveries')) {
      return { rows: [{ id: 'delivery_1', status: 'sent', pdf_sha256: 'a'.repeat(64) }] };
    }
    if (sql.includes('from bridge_audit_log')) {
      return { rows: [{ actor_type: 'human', action: 'quote.approved', resource_id: 'quote_1' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  registerOperatorRoutes(app, { query } as any);
  const r = await app.inject({
    method: 'GET',
    url: '/v1/operator/quotes/quote_1',
    headers: { authorization: 'Bearer brg_tenant_owner', 'x-tenant-id': 'tenant_a' },
  });

  expect(r.statusCode).toBe(200);
  expect(r.json().quote.customer_name).toBe('Ahmad');
  expect(r.json().quote.grand_total).toBe(10499.85);
  expect(r.json().items).toHaveLength(1);
  expect(r.json().approvals[0].status).toBe('approved');
  expect(r.json().deliveries[0].pdf_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(r.json().audit[0].actor_type).toBe('human');
  expect(seenValues.every((values) => values[0] === 'tenant_a')).toBe(true);
  await app.close();
});
