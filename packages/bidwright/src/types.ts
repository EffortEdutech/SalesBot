export interface BidwrightConfig {
  baseUrl: string;
  email: string;
  password: string;
  orgSlug?: string;
  expectedOrganizationId?: string;
  timeoutMs?: number;
}
export interface BidwrightOrganization {
  id: string;
  slug?: string;
  name?: string;
  [key: string]: unknown;
}
export interface BidwrightLoginResponse {
  token: string;
  user: Record<string, unknown>;
  organization: BidwrightOrganization | null;
}
export interface CreateProjectInput {
  name: string;
  clientName: string;
  customerId?: string | null;
  location: string;
  packageName?: string;
  scope?: string;
  creationMode?: 'manual' | 'intake' | 'snap' | 'container';
  summary?: string;
  isStandalone?: boolean;
}
export interface CreateProjectResponse {
  project: Record<string, any>;
  quote: Record<string, any>;
  revision: Record<string, any>;
  workspaceState?: Record<string, any>;
}
export interface EntityCategory {
  id: string;
  name: string;
  entityType: string;
  defaultUom?: string;
  validUoms?: string[];
  calculationType?: string;
  itemSource?: 'rate_schedule' | 'catalog' | 'freeform';
  enabled?: boolean;
  [key: string]: unknown;
}
export interface Catalog {
  id: string;
  name: string;
  kind: string;
  description?: string;
  [key: string]: unknown;
}
export interface CatalogItem {
  id: string;
  catalogId?: string;
  code: string;
  name: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface RateScheduleTier {
  id: string;
  name: string;
  multiplier: number;
  sortOrder: number;
  uom?: string | null;
  [key: string]: unknown;
}
export interface RateScheduleItem {
  id: string;
  catalogItemId?: string | null;
  code?: string;
  name?: string;
  unit?: string;
  rates?: Record<string, number>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface RateSchedule {
  id: string;
  name: string;
  category: string;
  scope: 'global' | 'revision';
  projectId?: string | null;
  revisionId?: string | null;
  sourceScheduleId?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  tiers?: RateScheduleTier[];
  items?: RateScheduleItem[];
  [key: string]: unknown;
}
