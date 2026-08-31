import type {
  Catalog,
  CatalogItem,
  EntityCategory,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
} from '@frontdesk-q/bidwright';

export interface PricingProviderClient {
  listEntityCategories(): Promise<EntityCategory[]>;
  createEntityCategory(input: Partial<EntityCategory>): Promise<EntityCategory>;
  listCatalogs(): Promise<Catalog[]>;
  createCatalog(input: { name: string; kind: string; description?: string }): Promise<Catalog>;
  listCatalogItems(catalogId: string): Promise<CatalogItem[]>;
  createCatalogItem(catalogId: string, input: Record<string, unknown>): Promise<CatalogItem>;
  updateCatalogItem(
    catalogId: string,
    itemId: string,
    input: Record<string, unknown>,
  ): Promise<CatalogItem>;
  listRateSchedules(scope?: string): Promise<RateSchedule[]>;
  getRateSchedule(id: string): Promise<RateSchedule>;
  createRateSchedule(input: Record<string, unknown>): Promise<RateSchedule>;
  updateRateSchedule(id: string, input: Record<string, unknown>): Promise<RateSchedule>;
  createRateScheduleTier(
    scheduleId: string,
    input: Record<string, unknown>,
  ): Promise<RateScheduleTier>;
  createRateScheduleItem(
    scheduleId: string,
    input: Record<string, unknown>,
  ): Promise<RateScheduleItem>;
  updateRateScheduleItem(
    scheduleId: string,
    itemId: string,
    input: Record<string, unknown>,
  ): Promise<RateScheduleItem>;
  importRateScheduleToRevision(projectId: string, scheduleId: string): Promise<unknown>;
  listRevisionRateSchedules(projectId: string): Promise<RateSchedule[]>;
}

export interface PricingProviderClientFactory {
  forTenant(tenantId: string): Promise<PricingProviderClient>;
}
