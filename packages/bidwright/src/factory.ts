import { BidwrightClient } from './client.js';
import type { BidwrightConfig } from './types.js';
import { BidwrightProviderError } from './errors.js';

export interface BidwrightClientFactory {
  forTenant(tenantId: string): Promise<BidwrightClient>;
}

export class StaticPilotBidwrightClientFactory implements BidwrightClientFactory {
  constructor(
    private readonly allowedTenantId: string | undefined,
    private readonly config: Partial<BidwrightConfig>,
  ) {}

  async forTenant(tenantId: string): Promise<BidwrightClient> {
    if (!this.allowedTenantId || tenantId !== this.allowedTenantId) {
      throw new BidwrightProviderError(
        'BIDWRIGHT_ORG_MISMATCH',
        'Static pilot Bidwright credentials are not configured for this tenant',
        503,
        false,
      );
    }

    if (!this.config.baseUrl || !this.config.email || !this.config.password) {
      throw new BidwrightProviderError(
        'BIDWRIGHT_AUTH_FAILED',
        'Bidwright pilot credentials are not configured',
        503,
        false,
      );
    }

    return new BidwrightClient({
      baseUrl: this.config.baseUrl,
      email: this.config.email,
      password: this.config.password,
      ...(this.config.orgSlug ? { orgSlug: this.config.orgSlug } : {}),
      ...(this.config.expectedOrganizationId
        ? { expectedOrganizationId: this.config.expectedOrganizationId }
        : {}),
      ...(this.config.timeoutMs ? { timeoutMs: this.config.timeoutMs } : {}),
    });
  }
}
