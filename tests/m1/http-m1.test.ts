import { describe, expect, it } from 'vitest';
import { hashBridgeToken } from '@frontdesk-q/auth';
import { InMemoryTenantRepository } from '@frontdesk-q/tenant';
import { buildApp } from '../../apps/bridge-api/src/app.js';
import { registerPricingRoutes } from '../../apps/bridge-api/src/routes/pricing-routes.js';
import { registerQuoteRoutes } from '../../apps/bridge-api/src/routes/quote-routes.js';
import { buildM1Fixture } from './fixtures.js';

describe('M1 HTTP contract', () => {
  it('runs intake → search → price policy → prepare through the Bridge routes', async () => {
    const fx = await buildM1Fixture();
    const pepper = 'm'.repeat(32);
    const rawToken = 'brg_m1_http_secret';
    const tenants = new InMemoryTenantRepository([
      {
        tokenId: 'token-m1',
        tokenHash: hashBridgeToken(rawToken, pepper),
        tenantId: 'tenant-hvac',
        tenantName: 'M1 HVAC',
        tenantStatus: 'active',
        role: 'ai_runtime',
        scopes: [],
        expiresAt: null,
        revokedAt: null,
      },
    ]);

    const app = buildApp({
      tenantRepository: tenants,
      bridgeTokenPepper: pepper,
      readinessCheck: async () => true,
      logger: false,
    });
    registerPricingRoutes(app, { offerings: fx.search, prices: fx.prices });
    registerQuoteRoutes(app, {
      repository: fx.quotes,
      prepare: fx.prepare,
      idempotency: fx.coordinator,
    });

    const headers = {
      authorization: `Bearer ${rawToken}`,
      'x-tenant-id': 'tenant-hvac',
    };

    const intakeResponse = await app.inject({
      method: 'POST',
      url: '/v1/intakes',
      headers: { ...headers, 'x-idempotency-key': 'http-intake-1' },
      payload: {
        customer: { name: 'Ahmad', phone: '+60123456789' },
        service_intent: 'air_conditioner_installation',
        location: { city: 'Ipoh', state: 'Perak', country: 'MY' },
        requirements: { quantity: 3, capacity: '2HP', building_type: 'office' },
        source: { channel: 'phone', dograh_workflow_run_id: 'm1-http-run-1' },
      },
    });
    expect(intakeResponse.statusCode).toBe(200);
    const intake = intakeResponse.json();

    const productSearch = await app.inject({
      method: 'POST',
      url: '/v1/offerings/search',
      headers,
      payload: { query: '2HP aircond', types: ['product'], limit: 5 },
    });
    expect(productSearch.statusCode).toBe(200);
    const product = productSearch.json().items[0];

    const serviceSearch = await app.inject({
      method: 'POST',
      url: '/v1/offerings/search',
      headers,
      payload: { query: 'install 2HP aircond', types: ['service'], limit: 5 },
    });
    expect(serviceSearch.statusCode).toBe(200);
    const service = serviceSearch.json().items[0];

    const disclosure = await app.inject({
      method: 'POST',
      url: '/v1/prices/resolve',
      headers,
      payload: { offering_ref: product.offering_ref, quantity: 3, requested_uom: 'EA' },
    });
    expect(disclosure.statusCode).toBe(200);
    expect(disclosure.json().disclosure).toBe('quote_only');
    expect(disclosure.json().unit_price).toBeUndefined();

    const priceInjection = await app.inject({
      method: 'POST',
      url: '/v1/prices/resolve',
      headers,
      payload: {
        offering_ref: product.offering_ref,
        quantity: 3,
        requested_uom: 'EA',
        price: 1,
      },
    });
    expect(priceInjection.statusCode).toBe(422);

    const prepared = await app.inject({
      method: 'POST',
      url: '/v1/quotes/prepare',
      headers: { ...headers, 'x-idempotency-key': 'http-quote-1' },
      payload: {
        intake_id: intake.intake_id,
        title: 'Supply and installation of 3 x 2HP AC units',
        scope: 'Supply and install 3 x 2HP inverter air conditioners at an office in Ipoh.',
        line_proposals: [
          { offering_ref: product.offering_ref, quantity: 3, uom: 'EA' },
          { offering_ref: service.offering_ref, quantity: 3, uom: 'EA' },
        ],
      },
    });

    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().state).toBe('pending_approval');
    expect(prepared.json().grand_total).toBe(7800);

    await app.close();
  });
});
