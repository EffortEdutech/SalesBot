import { describe, expect, it } from 'vitest';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { buildApp } from '../src/app.js';
describe('health', () => {
  it('lives without auth', async () => {
    const a = buildApp({
      tenantRepository: new InMemoryTenantRepository(),
      bridgeTokenPepper: 'x'.repeat(32),
      readinessCheck: async () => true,
      logger: false,
    });
    const r = await a.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-request-id']).toBeTruthy();
    await a.close();
  });
  it('readiness fails 503', async () => {
    const a = buildApp({
      tenantRepository: new InMemoryTenantRepository(),
      bridgeTokenPepper: 'x'.repeat(32),
      readinessCheck: async () => false,
      logger: false,
    });
    expect((await a.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
    await a.close();
  });
});
it('allows local dev browser preflight before auth', async () => {
  const a = buildApp({
    tenantRepository: new InMemoryTenantRepository(),
    bridgeTokenPepper: 'x'.repeat(32),
    readinessCheck: async () => true,
    logger: false,
  });
  const r = await a.inject({
    method: 'OPTIONS',
    url: '/v1/operator/system',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,x-tenant-id,x-request-id',
    },
  });
  expect(r.statusCode).toBe(204);
  expect(r.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4173');
  expect(String(r.headers['access-control-allow-headers'])).toContain('authorization');
  await a.close();
});
