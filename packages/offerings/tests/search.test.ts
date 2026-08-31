import { describe, expect, it } from 'vitest';
import { InMemoryPriceBookRepository } from '@frontdesk-q/pricing';
import { OfferingSearchService } from '../src/search.js';

async function fixture() {
  const repo = new InMemoryPriceBookRepository();
  const book = await repo.savePriceBook({
    id: 'pb1',
    tenantId: 'tenant_a',
    templateId: 'hvac_my_v1',
    name: 'HVAC',
    currency: 'MYR',
    status: 'active',
    effectiveDate: '2026-01-01',
    expiryDate: '2027-12-31',
    bidwrightCatalogId: 'catalog',
    bidwrightGlobalRateScheduleId: 'rs',
    productCategoryId: 'cp',
    serviceCategoryId: 'cs',
  });
  await repo.saveOffering({
    publicRef: 'off_20',
    tenantId: 'tenant_a',
    priceBookId: book.id,
    canonicalCode: 'HVAC-AC-20',
    offeringType: 'product',
    name: 'DemoAir Inverter Split AC 2.0HP',
    aliases: ['2HP aircond', '2 horsepower air conditioner'],
    uom: 'EA',
    bidwrightCatalogItemId: 'ci20',
    bidwrightMasterRateScheduleItemId: null,
    categoryBindingKey: 'hvac_product',
    priceDisclosure: 'quote_only',
    active: true,
  });
  await repo.saveOffering({
    publicRef: 'off_15',
    tenantId: 'tenant_a',
    priceBookId: book.id,
    canonicalCode: 'HVAC-AC-15',
    offeringType: 'product',
    name: 'DemoAir Inverter Split AC 1.5HP',
    aliases: ['1.5HP aircond'],
    uom: 'EA',
    bidwrightCatalogItemId: 'ci15',
    bidwrightMasterRateScheduleItemId: null,
    categoryBindingKey: 'hvac_product',
    priceDisclosure: 'quote_only',
    active: true,
  });
  return repo;
}

describe('offering search', () => {
  it('resolves colloquial 2HP aircond to stable opaque ref', async () => {
    const search = new OfferingSearchService(await fixture());
    const result = await search.search({
      tenantId: 'tenant_a',
      query: 'two? 2HP aircond',
      types: ['product'],
    });
    expect(result.items[0]?.offering_ref).toBe('off_20');
    expect(result.items[0]?.code).toBe('HVAC-AC-20');
  });

  it('does not leak another tenant offerings', async () => {
    const search = new OfferingSearchService(await fixture());
    const result = await search.search({
      tenantId: 'tenant_b',
      query: '2HP aircond',
      types: ['product'],
    });
    expect(result.items).toEqual([]);
  });

  it('flags close matches as ambiguous', async () => {
    const repo = await fixture();
    await repo.saveOffering({
      publicRef: 'off_20b',
      tenantId: 'tenant_a',
      priceBookId: 'pb1',
      canonicalCode: 'HVAC-AC-20-B',
      offeringType: 'product',
      name: 'OtherBrand Inverter Split AC 2.0HP',
      aliases: ['2HP aircond'],
      uom: 'EA',
      bidwrightCatalogItemId: 'ci20b',
      bidwrightMasterRateScheduleItemId: null,
      categoryBindingKey: 'hvac_product',
      priceDisclosure: 'quote_only',
      active: true,
    });
    const result = await new OfferingSearchService(repo).search({
      tenantId: 'tenant_a',
      query: '2HP aircond',
      types: ['product'],
    });
    expect(result.ambiguous).toBe(true);
    expect(result.requires_confirmation).toBe(true);
  });
});
