import { describe, expect, it } from 'vitest';
import { hashBridgeToken } from '@frontdesk-q/auth';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { buildApp } from '../src/app.js';
const pepper = 'p'.repeat(32),
  tokenA = 'brg_a',
  tokenB = 'brg_b';
const repo = () =>
  new InMemoryTenantRepository([
    {
      tokenId: 'ta',
      tokenHash: hashBridgeToken(tokenA, pepper),
      tenantId: 'tenant_a',
      tenantName: 'A',
      tenantStatus: 'active',
      role: 'ai_runtime',
      scopes: [],
      expiresAt: null,
      revokedAt: null,
    },
    {
      tokenId: 'tb',
      tokenHash: hashBridgeToken(tokenB, pepper),
      tenantId: 'tenant_b',
      tenantName: 'B',
      tenantStatus: 'active',
      role: 'ai_runtime',
      scopes: [],
      expiresAt: null,
      revokedAt: null,
    },
  ]);
describe('tenant isolation', () => {
  it('derives tenant from token', async () => {
    const a = buildApp({
      tenantRepository: repo(),
      bridgeTokenPepper: pepper,
      readinessCheck: async () => true,
      logger: false,
    });
    a.get('/v1/test', async (r) => ({ tenant_id: r.bridgePrincipal?.tenantId }));
    const r = await a.inject({
      method: 'GET',
      url: '/v1/test',
      headers: { authorization: `Bearer ${tokenA}`, 'x-tenant-id': 'tenant_a' },
    });
    expect(r.json()).toEqual({ tenant_id: 'tenant_a' });
    await a.close();
  });
  it('blocks A token claiming B', async () => {
    const a = buildApp({
      tenantRepository: repo(),
      bridgeTokenPepper: pepper,
      readinessCheck: async () => true,
      logger: false,
    });
    a.get('/v1/test', async () => ({ ok: true }));
    const r = await a.inject({
      method: 'GET',
      url: '/v1/test',
      headers: { authorization: `Bearer ${tokenA}`, 'x-tenant-id': 'tenant_b' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('TENANT_MISMATCH');
    await a.close();
  });
});
