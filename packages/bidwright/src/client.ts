import { z } from 'zod';
import { BidwrightProviderError } from './errors.js';
import type {
  BidwrightConfig,
  BidwrightLoginResponse,
  Catalog,
  CatalogItem,
  CreateProjectInput,
  CreateProjectResponse,
  EntityCategory,
  RateSchedule,
  RateScheduleItem,
  RateScheduleTier,
} from './types.js';

const loginSchema = z
  .object({
    token: z.string().min(1),
    user: z.record(z.unknown()),
    organization: z
      .object({ id: z.string().min(1) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export class BidwrightClient {
  private token: string | null = null;
  private authenticatedOrganizationId: string | null = null;
  constructor(private readonly config: BidwrightConfig) {}
  private url(path: string) {
    return new URL(
      path,
      this.config.baseUrl.endsWith('/') ? this.config.baseUrl : `${this.config.baseUrl}/`,
    );
  }
  private async fetchWithTimeout(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(this.url(path), {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new BidwrightProviderError(
          'BIDWRIGHT_TIMEOUT',
          `Bidwright request timed out: ${path}`,
          504,
          true,
        );
      throw new BidwrightProviderError(
        'BIDWRIGHT_UNAVAILABLE',
        `Bidwright request failed: ${path}`,
        502,
        true,
      );
    }
  }
  async authenticate(): Promise<BidwrightLoginResponse> {
    const res = await this.fetchWithTimeout('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
        ...(this.config.orgSlug ? { orgSlug: this.config.orgSlug } : {}),
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new BidwrightProviderError(
        'BIDWRIGHT_AUTH_FAILED',
        `Bidwright login failed with HTTP ${res.status}`,
        502,
        false,
        res.status,
        raw,
      );
    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success)
      throw new BidwrightProviderError(
        'BIDWRIGHT_AUTH_FAILED',
        'Bidwright login response did not match expected contract',
        502,
        false,
        res.status,
        raw,
      );
    const org = (parsed.data.organization ?? null) as BidwrightLoginResponse['organization'];
    if (this.config.expectedOrganizationId && org?.id !== this.config.expectedOrganizationId) {
      this.token = null;
      throw new BidwrightProviderError(
        'BIDWRIGHT_ORG_MISMATCH',
        `Expected Bidwright organization ${this.config.expectedOrganizationId}, received ${org?.id ?? 'none'}`,
        502,
        false,
      );
    }
    this.token = parsed.data.token;
    this.authenticatedOrganizationId = org?.id ?? null;
    return { token: parsed.data.token, user: parsed.data.user, organization: org };
  }
  getOrganizationId() {
    return this.authenticatedOrganizationId;
  }
  invalidateSession() {
    this.token = null;
    this.authenticatedOrganizationId = null;
  }
  private async request(
    path: string,
    init: RequestInit = {},
    retryAuth = true,
    binary = false,
  ): Promise<any> {
    const token = this.token ?? (await this.authenticate()).token;
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const res = await this.fetchWithTimeout(path, { ...init, headers });
    if (res.status === 401 && retryAuth) {
      this.invalidateSession();
      await this.authenticate();
      return this.request(path, init, false, binary);
    }
    if (binary && res.ok) return Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('application/json')
      ? await res.json().catch(() => ({}))
      : await res.text();
    if (!res.ok) {
      if (res.status === 401)
        throw new BidwrightProviderError(
          'BIDWRIGHT_AUTH_FAILED',
          'Bidwright rejected the refreshed session',
          502,
          false,
          res.status,
          body,
        );
      throw new BidwrightProviderError(
        'BIDWRIGHT_HTTP_ERROR',
        `Bidwright HTTP ${res.status} for ${path}`,
        res.status >= 500 ? 502 : 422,
        res.status >= 500,
        res.status,
        body,
      );
    }
    return body;
  }
  searchProjects(search: string, pageSize = 50): Promise<Record<string, any>> {
    const query = new URLSearchParams({
      page: '1',
      pageSize: String(pageSize),
      search,
      sortDir: 'desc',
    });
    return this.request(`/projects?${query.toString()}`);
  }
  getWorkspace(projectId: string): Promise<Record<string, any>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/workspace`);
  }
  getProject(projectId: string) {
    return this.request(`/projects/${encodeURIComponent(projectId)}`);
  }
  createProject(input: CreateProjectInput): Promise<CreateProjectResponse> {
    return this.request('/projects', { method: 'POST', body: JSON.stringify(input) });
  }
  listCatalogs(): Promise<Catalog[]> {
    return this.request('/catalogs');
  }
  createCatalog(input: { name: string; kind: string; description?: string }): Promise<Catalog> {
    return this.request('/catalogs', { method: 'POST', body: JSON.stringify(input) });
  }
  listCatalogItems(id: string): Promise<CatalogItem[]> {
    return this.request(`/catalogs/${encodeURIComponent(id)}/items`);
  }
  createCatalogItem(
    id: string,
    input: {
      code: string;
      name: string;
      unit: string;
      unitCost: number;
      unitPrice: number;
      category?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<CatalogItem> {
    return this.request(`/catalogs/${encodeURIComponent(id)}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  updateCatalogItem(
    catalogId: string,
    itemId: string,
    input: Record<string, unknown>,
  ): Promise<CatalogItem> {
    return this.request(
      `/catalogs/${encodeURIComponent(catalogId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }
  listEntityCategories(): Promise<EntityCategory[]> {
    return this.request('/entity-categories');
  }
  createEntityCategory(input: Partial<EntityCategory>): Promise<EntityCategory> {
    return this.request('/entity-categories', { method: 'POST', body: JSON.stringify(input) });
  }
  listRateSchedules(scope = 'global'): Promise<RateSchedule[]> {
    return this.request(`/api/rate-schedules?scope=${encodeURIComponent(scope)}`);
  }
  getRateSchedule(id: string): Promise<RateSchedule> {
    return this.request(`/api/rate-schedules/${encodeURIComponent(id)}`);
  }
  createRateSchedule(input: {
    name: string;
    description?: string;
    category?: string;
    defaultMarkup?: number;
    autoCalculate?: boolean;
    effectiveDate?: string | null;
    expiryDate?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<RateSchedule> {
    return this.request('/api/rate-schedules', { method: 'POST', body: JSON.stringify(input) });
  }
  updateRateSchedule(id: string, input: Record<string, unknown>): Promise<RateSchedule> {
    return this.request(`/api/rate-schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  createRateScheduleTier(
    id: string,
    input: { name: string; multiplier?: number; sortOrder?: number; uom?: string | null },
  ): Promise<RateScheduleTier> {
    return this.request(`/api/rate-schedules/${encodeURIComponent(id)}/tiers`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  createRateScheduleItem(
    id: string,
    input: {
      resourceId?: string | null;
      catalogItemId?: string;
      rates?: Record<string, number>;
      costRates?: Record<string, number>;
      burden?: number;
      perDiem?: number;
      metadata?: Record<string, unknown>;
      sortOrder?: number;
    },
  ): Promise<RateScheduleItem> {
    return this.request(`/api/rate-schedules/${encodeURIComponent(id)}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  updateRateScheduleItem(
    scheduleId: string,
    itemId: string,
    input: Record<string, unknown>,
  ): Promise<RateScheduleItem> {
    return this.request(
      `/api/rate-schedules/${encodeURIComponent(scheduleId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }
  importRateScheduleToRevision(projectId: string, scheduleId: string) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/rate-schedules/import`, {
      method: 'POST',
      body: JSON.stringify({ scheduleId }),
    });
  }
  listRevisionRateSchedules(projectId: string): Promise<RateSchedule[]> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/rate-schedules`);
  }
  createWorksheet(
    projectId: string,
    input: { name: string; folderId?: string | null; order?: number },
  ) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/worksheets`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  createWorksheetItem(
    projectId: string,
    worksheetId: string,
    input: {
      phaseId?: string | null;
      categoryId?: string | null;
      category: string;
      entityType: string;
      entityName: string;
      description?: string;
      quantity: number;
      uom: string;
      cost?: number;
      markup?: number;
      price?: number;
      rateScheduleItemId?: string | null;
      itemId?: string | null;
      tierUnits?: Record<string, number>;
      sourceNotes?: string;
    },
  ) {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/worksheets/${encodeURIComponent(worksheetId)}/items`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
  recalculateProject(projectId: string) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/recalculate`, {
      method: 'POST',
    });
  }
  createRevision(projectId: string) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/revisions`, { method: 'POST' });
  }
  getMainPdf(projectId: string): Promise<Buffer> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/pdf/main`, {}, true, true);
  }
}
