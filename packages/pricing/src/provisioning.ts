import type { PricingProviderClientFactory } from './provider.js';
import type { PriceBookRepository } from './repository.js';
import type {
  CatalogItem,
  EntityCategory,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
} from '@frontdesk-q/bidwright';
import type { PriceBookInputRow, PriceBookProvisioningInput, PriceBookRecord } from './types.js';
import { isActiveWindow } from './date-window.js';
import { normalizeUom } from './uom.js';

const PRODUCT_CATEGORY = {
  name: 'HVAC Product',
  entityType: 'HVACProduct',
  shortform: 'HP',
  defaultUom: 'EA',
  validUoms: ['EA'],
  calculationType: 'quantity_markup',
  itemSource: 'catalog',
  enabled: true,
};

const SERVICE_CATEGORY = {
  name: 'HVAC Service',
  entityType: 'HVACService',
  shortform: 'HS',
  defaultUom: 'EA',
  validUoms: ['EA', 'M', 'HR', 'LS'],
  calculationType: 'quantity_markup',
  itemSource: 'rate_schedule',
  enabled: true,
};

async function ensureCategory(client: any, definition: Record<string, unknown> & { name: string }) {
  const existing = (await client.listEntityCategories()).find(
    (c: EntityCategory) => c.name.trim().toLowerCase() === definition.name.toLowerCase(),
  );
  return existing ?? client.createEntityCategory(definition);
}

async function ensureCatalog(client: any, name: string) {
  const existing = (await client.listCatalogs()).find(
    (c: any) => c.name.trim().toLowerCase() === name.toLowerCase(),
  );
  return (
    existing ??
    client.createCatalog({
      name,
      kind: 'HVAC',
      description: 'Frontdesk-Q managed HVAC backing catalog.',
    })
  );
}

async function upsertCatalogItem(
  client: any,
  catalogId: string,
  existing: CatalogItem[],
  row: PriceBookInputRow,
): Promise<CatalogItem> {
  const found = existing.find((x) => x.code === row.code);
  const payload = {
    code: row.code,
    name: row.name,
    unit: normalizeUom(row.uom),
    unitCost: row.cost,
    unitPrice: row.type === 'product' ? row.sellPrice : 0,
    category: row.category,
    metadata: {
      canonical_code: row.code,
      row_type: row.type,
      aliases: row.aliases,
      price_disclosure: row.priceDisclosure,
      effective_date: row.effectiveDate,
      expiry_date: row.expiryDate,
      frontdesk_q_managed: true,
    },
  };
  if (found) return client.updateCatalogItem(catalogId, found.id, payload);
  const created = await client.createCatalogItem(catalogId, payload);
  existing.push(created);
  return created;
}

async function ensureSchedule(
  client: any,
  spec: PriceBookProvisioningInput,
): Promise<RateSchedule> {
  const name = `${spec.name} - Service Rates`;
  const existing = (await client.listRateSchedules('global')).find(
    (s: RateSchedule) => s.name.trim().toLowerCase() === name.toLowerCase(),
  );
  const payload = {
    description: 'Frontdesk-Q managed HVAC service selling rates.',
    category: 'HVACService',
    defaultMarkup: 0,
    autoCalculate: false,
    effectiveDate: spec.effectiveDate,
    expiryDate: spec.expiryDate,
    metadata: {
      tenant_id: spec.tenantId,
      template_id: spec.templateId,
      currency: spec.currency,
      frontdesk_q_managed: true,
    },
  };
  if (existing) return client.updateRateSchedule(existing.id, payload);
  return client.createRateSchedule({ name, ...payload });
}

async function ensureTiers(
  client: any,
  scheduleId: string,
  serviceRows: PriceBookInputRow[],
): Promise<Record<string, RateScheduleTier>> {
  const detailed: RateSchedule = await client.getRateSchedule(scheduleId);
  const existing: RateScheduleTier[] = detailed.tiers ?? [];
  const result: Record<string, RateScheduleTier> = {};
  const uoms = [...new Set(serviceRows.map((x) => normalizeUom(x.uom)))];

  for (const [index, uom] of uoms.entries()) {
    const existingTier = existing.find((x: RateScheduleTier) => normalizeUom(x.uom ?? '') === uom);
    const tier: RateScheduleTier =
      existingTier ??
      (await client.createRateScheduleTier(scheduleId, {
        name: `Standard ${uom}`,
        multiplier: 1,
        sortOrder: index,
        uom,
      }));
    result[uom] = tier;
  }
  return result;
}

async function upsertRateItem(
  client: any,
  schedule: RateSchedule,
  row: PriceBookInputRow,
  catalogItem: CatalogItem,
  tier: RateScheduleTier,
  sortOrder: number,
): Promise<RateScheduleItem> {
  const found = (schedule.items ?? []).find(
    (x: RateScheduleItem) =>
      x.catalogItemId === catalogItem.id ||
      x.code === row.code ||
      x.metadata?.canonical_code === row.code,
  );
  const payload = {
    catalogItemId: catalogItem.id,
    rates: { [tier.id]: row.sellPrice },
    costRates: {},
    metadata: {
      canonical_code: row.code,
      aliases: row.aliases,
      price_disclosure: row.priceDisclosure,
      currency: 'MYR',
      frontdesk_q_managed: true,
    },
    sortOrder,
  };
  if (found) return client.updateRateScheduleItem(schedule.id, found.id, payload);
  return client.createRateScheduleItem(schedule.id, payload);
}

export async function provisionTenantPriceBook(input: {
  clientFactory: PricingProviderClientFactory;
  repository: PriceBookRepository;
  spec: PriceBookProvisioningInput;
  at?: Date;
}): Promise<PriceBookRecord> {
  const { spec } = input;
  const at = input.at ?? new Date();

  if (spec.currency !== 'MYR') throw new Error('PILOT_REQUIRES_MYR');
  const rows = spec.rows.filter(
    (row) => row.enabled && isActiveWindow(row.effectiveDate, row.expiryDate, at),
  );
  if (!rows.length) throw new Error('NO_ACTIVE_PRICE_ROWS');

  const client = await input.clientFactory.forTenant(spec.tenantId);
  const productCategory = await ensureCategory(client, PRODUCT_CATEGORY);
  const serviceCategory = await ensureCategory(client, SERVICE_CATEGORY);
  const catalog = await ensureCatalog(client, `${spec.name} - Catalog`);
  const catalogItems = await client.listCatalogItems(catalog.id);
  const byCode = new Map<string, CatalogItem>();

  for (const row of rows) {
    byCode.set(row.code, await upsertCatalogItem(client, catalog.id, catalogItems, row));
  }

  const schedule = await ensureSchedule(client, spec);
  const serviceRows = rows.filter((x) => x.type === 'service');
  const tiers = await ensureTiers(client, schedule.id, serviceRows);
  const detailed: RateSchedule = await client.getRateSchedule(schedule.id);
  const rateItems = new Map<string, RateScheduleItem>();

  for (const [index, row] of serviceRows.entries()) {
    const item = byCode.get(row.code);
    const tier = tiers[normalizeUom(row.uom)];
    if (!item || !tier) throw new Error(`PROVISIONING_MAPPING_FAILED:${row.code}`);
    rateItems.set(row.code, await upsertRateItem(client, detailed, row, item, tier, index));
  }

  const priceBook = await input.repository.savePriceBook({
    tenantId: spec.tenantId,
    templateId: spec.templateId,
    name: spec.name,
    currency: spec.currency,
    status: 'active',
    effectiveDate: spec.effectiveDate,
    expiryDate: spec.expiryDate,
    bidwrightCatalogId: catalog.id,
    bidwrightGlobalRateScheduleId: schedule.id,
    productCategoryId: productCategory.id,
    serviceCategoryId: serviceCategory.id,
    sourceSha256: spec.sourceSha256 ?? null,
  });

  await input.repository.saveTemplateBinding({
    tenantId: spec.tenantId,
    templateId: spec.templateId,
    bindingKey: 'hvac_product',
    binding: {
      bidwright_category_id: productCategory.id,
      bidwright_catalog_id: catalog.id,
      item_source: 'catalog',
      calculation_type: 'quantity_markup',
      default_uom: 'EA',
    },
  });
  await input.repository.saveTemplateBinding({
    tenantId: spec.tenantId,
    templateId: spec.templateId,
    bindingKey: 'hvac_service',
    binding: {
      bidwright_category_id: serviceCategory.id,
      bidwright_global_rate_schedule_id: schedule.id,
      item_source: 'rate_schedule',
      calculation_type: 'quantity_markup',
      valid_uoms: ['EA', 'M', 'HR', 'LS'],
    },
  });

  for (const row of rows) {
    const catalogItem = byCode.get(row.code);
    if (!catalogItem) throw new Error(`CATALOG_ITEM_NOT_FOUND:${row.code}`);
    await input.repository.saveOffering({
      tenantId: spec.tenantId,
      priceBookId: priceBook.id,
      canonicalCode: row.code,
      offeringType: row.type,
      name: row.name,
      aliases: row.aliases,
      uom: normalizeUom(row.uom),
      bidwrightCatalogItemId: catalogItem.id,
      bidwrightMasterRateScheduleItemId:
        row.type === 'service' ? (rateItems.get(row.code)?.id ?? null) : null,
      categoryBindingKey: row.type === 'product' ? 'hvac_product' : 'hvac_service',
      priceDisclosure: row.priceDisclosure,
      active: true,
      metadata: {
        source_price_book: spec.name,
        notes: row.notes ?? null,
      },
    });
  }

  return priceBook;
}
