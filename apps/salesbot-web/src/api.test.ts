import { describe, expect, it, vi } from 'vitest';
import { BridgeClient } from './api';

describe('BridgeClient financial safety', () => {
  it('resolvePrice sends only offering_ref, quantity and uom', async () => {
    const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body).toEqual({ offering_ref: 'off_1', quantity: 3, uom: 'EA' });
      expect(body.price).toBeUndefined();
      expect(body.cost).toBeUndefined();
      expect(body.markup).toBeUndefined();
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new BridgeClient(
      { baseUrl: 'http://bridge.test', tenantId: 'tenant_a', token: 'brg_test' },
      fake as typeof fetch,
    );
    await client.resolvePrice({ offering_ref: 'off_1', quantity: 3, uom: 'EA' });
    expect(fake).toHaveBeenCalledOnce();
  });
});

describe('BridgeClient system diagnostics', () => {
  it('uses the authenticated Bridge operator route and never sends server secrets', async () => {
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://bridge.test/v1/operator/system');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer brg_test');
      expect(headers.get('x-tenant-id')).toBe('tenant_a');
      expect(headers.has('database_url')).toBe(false);
      expect(headers.has('bridge_token_pepper')).toBe(false);
      return new Response(
        JSON.stringify({
          bridge: { status: 'connected', app_env: 'development', port: 4170 },
          database: { status: 'connected' },
          migrations: {
            status: 'ready',
            expected_tables: 17,
            present_tables: 17,
            missing_tables: [],
            missing_columns: [],
          },
          tenant: {
            status: 'active',
            id: 'tenant_a',
            name: 'Tenant A',
            industry: 'hvac',
            currency: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
          },
          operator: {
            status: 'authenticated',
            token_id: 'tok_1',
            name: 'Dev Owner',
            role: 'tenant_owner',
          },
          bidwright: {
            status: 'not_configured',
            configured: false,
            reachable: null,
            base_url: null,
          },
          price_book: { status: 'missing' },
          dograh: { status: 'not_configured', last_verified_at: null },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    const client = new BridgeClient(
      { baseUrl: 'http://bridge.test', tenantId: 'tenant_a', token: 'brg_test' },
      fake as typeof fetch,
    );
    const result = await client.system();
    expect(result.migrations.status).toBe('ready');
    expect(result.operator.name).toBe('Dev Owner');
  });
});
it('retries direct local Bridge when the Vite proxy path is unreachable', async () => {
  const fake = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          bridge: { status: 'connected', app_env: 'development', port: 4170 },
          database: { status: 'connected' },
          migrations: {
            status: 'ready',
            expected_tables: 17,
            present_tables: 17,
            missing_tables: [],
            missing_columns: [],
          },
          tenant: {
            status: 'active',
            id: 'tenant_a',
            name: 'Tenant A',
            industry: 'hvac',
            currency: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
          },
          operator: {
            status: 'authenticated',
            token_id: 'tok_1',
            name: 'Dev Owner',
            role: 'tenant_owner',
          },
          bidwright: {
            status: 'not_configured',
            configured: false,
            reachable: null,
            base_url: null,
          },
          price_book: { status: 'missing' },
          dograh: { status: 'not_configured', last_verified_at: null },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

  const client = new BridgeClient(
    { baseUrl: '/bridge', tenantId: 'tenant_a', token: 'brg_test' },
    fake as typeof fetch,
  );

  await expect(client.system()).resolves.toMatchObject({
    bridge: { status: 'connected' },
  });
  expect(String(fake.mock.calls[0][0])).toBe('/bridge/v1/operator/system');
  expect(String(fake.mock.calls[1][0])).toBe('http://127.0.0.1:4170/v1/operator/system');
});
