export type OfferingType = 'product' | 'service';
export type PriceDisclosure = 'allowed' | 'quote_only' | 'range_only' | 'human_only';
export type PriceBookStatus = 'draft' | 'active' | 'expired' | 'disabled';

export interface PriceBookRecord {
  id: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OfferingRecord {
  id: string;
  publicRef: string;
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
  metadata: Record<string, unknown>;
}

export interface PriceBookInputRow {
  code: string;
  type: OfferingType;
  name: string;
  aliases: string[];
  uom: string;
  cost: number;
  sellPrice: number;
  category: string;
  enabled: boolean;
  effectiveDate: string;
  expiryDate: string | null;
  priceDisclosure: PriceDisclosure;
  notes?: string;
}

export interface PriceBookProvisioningInput {
  tenantId: string;
  templateId: string;
  name: string;
  currency: 'MYR';
  effectiveDate: string;
  expiryDate: string | null;
  rows: PriceBookInputRow[];
  sourceSha256?: string;
}

export interface InternalResolvedPrice {
  offering: OfferingRecord;
  priceBook: PriceBookRecord;
  currency: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  extendedPrice: number;
  uom: string;
  providerSource: 'catalog' | 'rate_schedule';
  masterRateScheduleItemId: string | null;
}

export interface RuntimePriceResult {
  pricing_status: 'resolved';
  disclosure: PriceDisclosure;
  currency?: string;
  unit_price?: number;
  quantity?: number;
  extended_price?: number;
  user_safe_message?: string;
  warnings: string[];
}
