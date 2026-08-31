import { randomBytes, randomUUID } from 'node:crypto';
import type { DbPool } from '@frontdesk-q/db';
import type {
  OfferingRecord,
  PriceBookRecord,
  PriceBookStatus,
  PriceDisclosure,
  OfferingType,
} from './types.js';

export interface SavePriceBookInput {
  id?: string;
  tenantId: string;
  templateId: string;
  name: string;
  currency: string;
  status: PriceBookStatus;
  effectiveDate: string;
  expiryDate: string | null;
  bidwrightCatalogId: string;
  bidwrightGlobalRateScheduleId: string;
  productCategoryId: string;
  serviceCategoryId: string;
  sourceSha256?: string | null;
}

export interface SaveOfferingInput {
  id?: string;
  publicRef?: string;
  tenantId: string;
  priceBookId: string;
  canonicalCode: string;
  offeringType: OfferingType;
  name: string;
  aliases: string[];
  uom: string;
  bidwrightCatalogItemId: string;
  bidwrightMasterRateScheduleItemId: string | null;
  categoryBindingKey: string;
  priceDisclosure: PriceDisclosure;
  active: boolean;
  metadata?: Record<string, unknown>;
}

export interface SaveSnapshotInput {
  tenantId: string;
  priceBookId: string;
  bridgeQuoteId: string;
  bidwrightProjectId: string;
  bidwrightRevisionId: string;
  bidwrightSnapshotScheduleId: string;
  snapshotMapping: Record<string, string>;
}

export interface PriceBookRepository {
  findActivePriceBook(tenantId: string, at?: Date): Promise<PriceBookRecord | null>;
  findPriceBookById(tenantId: string, priceBookId: string): Promise<PriceBookRecord | null>;
  savePriceBook(input: SavePriceBookInput): Promise<PriceBookRecord>;
  listOfferings(tenantId: string, types?: OfferingType[]): Promise<OfferingRecord[]>;
  findOfferingByRef(tenantId: string, publicRef: string): Promise<OfferingRecord | null>;
  saveOffering(input: SaveOfferingInput): Promise<OfferingRecord>;
  saveTemplateBinding(input: {
    tenantId: string;
    templateId: string;
    bindingKey: string;
    binding: Record<string, unknown>;
  }): Promise<void>;
  saveSnapshot(input: SaveSnapshotInput): Promise<void>;
}

function publicRef(): string {
  return `off_${randomBytes(18).toString('base64url')}`;
}

function mapPriceBook(row: any): PriceBookRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    templateId: row.template_id,
    name: row.name,
    currency: row.currency,
    status: row.status,
    effectiveDate: String(row.effective_date).slice(0, 10),
    expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    bidwrightCatalogId: row.bidwright_catalog_id,
    bidwrightGlobalRateScheduleId: row.bidwright_global_rate_schedule_id,
    productCategoryId: row.product_category_id,
    serviceCategoryId: row.service_category_id,
    ...(row.created_at ? { createdAt: new Date(row.created_at) } : {}),
    ...(row.updated_at ? { updatedAt: new Date(row.updated_at) } : {}),
  };
}

function mapOffering(row: any): OfferingRecord {
  return {
    id: row.id,
    publicRef: row.public_ref,
    tenantId: row.tenant_id,
    priceBookId: row.price_book_id,
    canonicalCode: row.canonical_code,
    offeringType: row.offering_type,
    name: row.name,
    aliases: Array.isArray(row.aliases_json) ? row.aliases_json : [],
    uom: row.uom,
    bidwrightCatalogItemId: row.bidwright_catalog_item_id,
    bidwrightMasterRateScheduleItemId: row.bidwright_master_rate_schedule_item_id,
    categoryBindingKey: row.category_binding_key,
    priceDisclosure: row.price_disclosure,
    active: row.active,
    metadata: row.metadata_json ?? {},
  };
}

export class PostgresPriceBookRepository implements PriceBookRepository {
  constructor(private readonly pool: DbPool) {}

  async findActivePriceBook(tenantId: string, at = new Date()): Promise<PriceBookRecord | null> {
    const date = at.toISOString().slice(0, 10);
    const result = await this.pool.query(
      `select *
       from tenant_price_books
       where tenant_id = $1
         and status = 'active'
         and effective_date <= $2::date
         and (expiry_date is null or expiry_date >= $2::date)
       order by effective_date desc, created_at desc
       limit 1`,
      [tenantId, date],
    );
    return result.rows[0] ? mapPriceBook(result.rows[0]) : null;
  }

  async findPriceBookById(tenantId: string, priceBookId: string): Promise<PriceBookRecord | null> {
    const result = await this.pool.query(
      'select * from tenant_price_books where tenant_id = $1 and id = $2 limit 1',
      [tenantId, priceBookId],
    );
    return result.rows[0] ? mapPriceBook(result.rows[0]) : null;
  }

  async savePriceBook(input: SavePriceBookInput): Promise<PriceBookRecord> {
    const id = input.id ?? randomUUID();
    const result = await this.pool.query(
      `insert into tenant_price_books
        (id, tenant_id, template_id, name, currency, status, effective_date, expiry_date,
         bidwright_catalog_id, bidwright_global_rate_schedule_id, product_category_id,
         service_category_id, source_sha256)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (tenant_id, name) do update set
         template_id = excluded.template_id,
         currency = excluded.currency,
         status = excluded.status,
         effective_date = excluded.effective_date,
         expiry_date = excluded.expiry_date,
         bidwright_catalog_id = excluded.bidwright_catalog_id,
         bidwright_global_rate_schedule_id = excluded.bidwright_global_rate_schedule_id,
         product_category_id = excluded.product_category_id,
         service_category_id = excluded.service_category_id,
         source_sha256 = excluded.source_sha256,
         updated_at = now()
       returning *`,
      [
        id,
        input.tenantId,
        input.templateId,
        input.name,
        input.currency,
        input.status,
        input.effectiveDate,
        input.expiryDate,
        input.bidwrightCatalogId,
        input.bidwrightGlobalRateScheduleId,
        input.productCategoryId,
        input.serviceCategoryId,
        input.sourceSha256 ?? null,
      ],
    );
    return mapPriceBook(result.rows[0]);
  }

  async listOfferings(tenantId: string, types?: OfferingType[]): Promise<OfferingRecord[]> {
    const values: unknown[] = [tenantId];
    let filter = '';
    if (types?.length) {
      values.push(types);
      filter = 'and offering_type = any($2::text[])';
    }
    const result = await this.pool.query(
      `select * from bridge_offerings
       where tenant_id = $1 and active = true ${filter}
       order by canonical_code asc`,
      values,
    );
    return result.rows.map(mapOffering);
  }

  async findOfferingByRef(tenantId: string, ref: string): Promise<OfferingRecord | null> {
    const result = await this.pool.query(
      `select * from bridge_offerings
       where tenant_id = $1 and public_ref = $2 and active = true
       limit 1`,
      [tenantId, ref],
    );
    return result.rows[0] ? mapOffering(result.rows[0]) : null;
  }

  async saveOffering(input: SaveOfferingInput): Promise<OfferingRecord> {
    const id = input.id ?? randomUUID();
    const ref = input.publicRef ?? publicRef();
    const result = await this.pool.query(
      `insert into bridge_offerings
        (id, public_ref, tenant_id, price_book_id, canonical_code, offering_type, name,
         aliases_json, uom, bidwright_catalog_item_id, bidwright_master_rate_schedule_item_id,
         category_binding_key, price_disclosure, active, metadata_json)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb)
       on conflict (tenant_id, price_book_id, canonical_code) do update set
         offering_type = excluded.offering_type,
         name = excluded.name,
         aliases_json = excluded.aliases_json,
         uom = excluded.uom,
         bidwright_catalog_item_id = excluded.bidwright_catalog_item_id,
         bidwright_master_rate_schedule_item_id = excluded.bidwright_master_rate_schedule_item_id,
         category_binding_key = excluded.category_binding_key,
         price_disclosure = excluded.price_disclosure,
         active = excluded.active,
         metadata_json = excluded.metadata_json,
         updated_at = now()
       returning *`,
      [
        id,
        ref,
        input.tenantId,
        input.priceBookId,
        input.canonicalCode,
        input.offeringType,
        input.name,
        JSON.stringify(input.aliases),
        input.uom,
        input.bidwrightCatalogItemId,
        input.bidwrightMasterRateScheduleItemId,
        input.categoryBindingKey,
        input.priceDisclosure,
        input.active,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapOffering(result.rows[0]);
  }

  async saveTemplateBinding(input: {
    tenantId: string;
    templateId: string;
    bindingKey: string;
    binding: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `insert into tenant_template_bindings
        (tenant_id,template_id,binding_key,binding_json)
       values($1,$2,$3,$4::jsonb)
       on conflict(tenant_id,template_id,binding_key) do update set
         binding_json=excluded.binding_json,
         updated_at=now()`,
      [input.tenantId, input.templateId, input.bindingKey, JSON.stringify(input.binding)],
    );
  }

  async saveSnapshot(input: SaveSnapshotInput): Promise<void> {
    await this.pool.query(
      `insert into price_book_snapshots
        (tenant_id, price_book_id, bridge_quote_id, bidwright_project_id,
         bidwright_revision_id, bidwright_snapshot_schedule_id, snapshot_mapping_json)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)
       on conflict (tenant_id, bridge_quote_id, bidwright_revision_id, price_book_id)
       do update set
         bidwright_snapshot_schedule_id = excluded.bidwright_snapshot_schedule_id,
         snapshot_mapping_json = excluded.snapshot_mapping_json`,
      [
        input.tenantId,
        input.priceBookId,
        input.bridgeQuoteId,
        input.bidwrightProjectId,
        input.bidwrightRevisionId,
        input.bidwrightSnapshotScheduleId,
        JSON.stringify(input.snapshotMapping),
      ],
    );
  }
}

export class InMemoryPriceBookRepository implements PriceBookRepository {
  readonly priceBooks: PriceBookRecord[] = [];
  readonly offerings: OfferingRecord[] = [];
  readonly snapshots: SaveSnapshotInput[] = [];

  async findActivePriceBook(tenantId: string, at = new Date()): Promise<PriceBookRecord | null> {
    const date = at.toISOString().slice(0, 10);
    return (
      this.priceBooks
        .filter(
          (p) =>
            p.tenantId === tenantId &&
            p.status === 'active' &&
            p.effectiveDate <= date &&
            (!p.expiryDate || p.expiryDate >= date),
        )
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null
    );
  }

  async findPriceBookById(tenantId: string, priceBookId: string): Promise<PriceBookRecord | null> {
    return this.priceBooks.find((p) => p.tenantId === tenantId && p.id === priceBookId) ?? null;
  }

  async savePriceBook(input: SavePriceBookInput): Promise<PriceBookRecord> {
    const existing = this.priceBooks.find(
      (p) => p.tenantId === input.tenantId && p.name === input.name,
    );
    const record: PriceBookRecord = {
      id: existing?.id ?? input.id ?? randomUUID(),
      tenantId: input.tenantId,
      templateId: input.templateId,
      name: input.name,
      currency: input.currency,
      status: input.status,
      effectiveDate: input.effectiveDate,
      expiryDate: input.expiryDate,
      bidwrightCatalogId: input.bidwrightCatalogId,
      bidwrightGlobalRateScheduleId: input.bidwrightGlobalRateScheduleId,
      productCategoryId: input.productCategoryId,
      serviceCategoryId: input.serviceCategoryId,
    };
    if (existing) Object.assign(existing, record);
    else this.priceBooks.push(record);
    return record;
  }

  async listOfferings(tenantId: string, types?: OfferingType[]): Promise<OfferingRecord[]> {
    return this.offerings.filter(
      (o) =>
        o.tenantId === tenantId && o.active && (!types?.length || types.includes(o.offeringType)),
    );
  }

  async findOfferingByRef(tenantId: string, ref: string): Promise<OfferingRecord | null> {
    return (
      this.offerings.find((o) => o.tenantId === tenantId && o.publicRef === ref && o.active) ?? null
    );
  }

  async saveOffering(input: SaveOfferingInput): Promise<OfferingRecord> {
    const existing = this.offerings.find(
      (o) =>
        o.tenantId === input.tenantId &&
        o.priceBookId === input.priceBookId &&
        o.canonicalCode === input.canonicalCode,
    );
    const record: OfferingRecord = {
      id: existing?.id ?? input.id ?? randomUUID(),
      publicRef: existing?.publicRef ?? input.publicRef ?? publicRef(),
      tenantId: input.tenantId,
      priceBookId: input.priceBookId,
      canonicalCode: input.canonicalCode,
      offeringType: input.offeringType,
      name: input.name,
      aliases: input.aliases,
      uom: input.uom,
      bidwrightCatalogItemId: input.bidwrightCatalogItemId,
      bidwrightMasterRateScheduleItemId: input.bidwrightMasterRateScheduleItemId,
      categoryBindingKey: input.categoryBindingKey,
      priceDisclosure: input.priceDisclosure,
      active: input.active,
      metadata: input.metadata ?? {},
    };
    if (existing) Object.assign(existing, record);
    else this.offerings.push(record);
    return record;
  }

  async saveTemplateBinding(_input: {
    tenantId: string;
    templateId: string;
    bindingKey: string;
    binding: Record<string, unknown>;
  }): Promise<void> {
    // In-memory M1 tests do not require binding persistence.
  }

  async saveSnapshot(input: SaveSnapshotInput): Promise<void> {
    this.snapshots.push(structuredClone(input));
  }
}
