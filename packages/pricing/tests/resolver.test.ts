import { describe, expect, it } from 'vitest';
import { InMemoryPriceBookRepository } from '../src/repository.js';
import { PriceResolutionService } from '../src/resolver.js';

async function setup(disclosure: 'allowed' | 'quote_only') {
  const repo = new InMemoryPriceBookRepository();
  await repo.savePriceBook({
    id: 'pb',
    tenantId: 'tenant',
    templateId: 'hvac_my_v1',
    name: 'HVAC',
    currency: 'MYR',
    status: 'active',
    effectiveDate: '2026-01-01',
    expiryDate: '2027-01-01',
    bidwrightCatalogId: 'catalog',
    bidwrightGlobalRateScheduleId: 'rs',
    productCategoryId: 'cp',
    serviceCategoryId: 'cs',
  });
  await repo.saveOffering({
    publicRef: 'off_product',
    tenantId: 'tenant',
    priceBookId: 'pb',
    canonicalCode: 'P1',
    offeringType: 'product',
    name: 'Product',
    aliases: [],
    uom: 'EA',
    bidwrightCatalogItemId: 'ci',
    bidwrightMasterRateScheduleItemId: null,
    categoryBindingKey: 'hvac_product',
    priceDisclosure: disclosure,
    active: true,
  });
  const factory = {
    forTenant: async () => ({
      listCatalogItems: async () => [
        { id: 'ci', code: 'P1', name: 'Product', unit: 'EA', unitCost: 100, unitPrice: 150 },
      ],
      getRateSchedule: async () => {
        throw new Error('unused');
      },
    }),
  } as any;
  return new PriceResolutionService(repo, factory);
}

describe('runtime price disclosure', () => {
  it('returns numeric provider price when disclosure is allowed', async () => {
    const service = await setup('allowed');
    const result = await service.resolveForRuntime({
      tenantId: 'tenant',
      offeringRef: 'off_product',
      quantity: 3,
      requestedUom: 'EA',
      at: new Date('2026-08-19T00:00:00Z'),
    });
    expect(result.unit_price).toBe(150);
    expect(result.extended_price).toBe(450);
  });

  it('resolves internally but redacts numeric price from quote_only runtime response', async () => {
    const service = await setup('quote_only');
    const result = await service.resolveForRuntime({
      tenantId: 'tenant',
      offeringRef: 'off_product',
      quantity: 3,
      requestedUom: 'EA',
      at: new Date('2026-08-19T00:00:00Z'),
    });
    expect(result.disclosure).toBe('quote_only');
    expect(result.unit_price).toBeUndefined();
    expect(result.extended_price).toBeUndefined();
  });
});
