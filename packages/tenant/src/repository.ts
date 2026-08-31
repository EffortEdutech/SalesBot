import type { BridgeRole } from '@frontdesk-q/contracts';
import type { DbPool } from '@frontdesk-q/db';

export interface TenantTokenRecord {
  tokenId: string;
  tokenHash: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: 'active' | 'disabled';
  role: BridgeRole;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}
export interface TenantRepository {
  findActiveTokenByHash(tokenHash: string): Promise<TenantTokenRecord | null>;
}

export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly pool: DbPool) {}
  async findActiveTokenByHash(tokenHash: string): Promise<TenantTokenRecord | null> {
    const result = await this.pool.query(
      `select t.id token_id,t.token_hash,t.tenant_id,o.name tenant_name,o.status tenant_status,
              t.role,t.scopes,t.expires_at,t.revoked_at
       from bridge_api_tokens t join bridge_organizations o on o.id=t.tenant_id
       where t.token_hash=$1 and t.revoked_at is null
         and (t.expires_at is null or t.expires_at>now()) limit 1`,
      [tokenHash],
    );
    const r = result.rows[0];
    if (!r) return null;
    return {
      tokenId: r.token_id,
      tokenHash: r.token_hash,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      tenantStatus: r.tenant_status,
      role: r.role,
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      expiresAt: r.expires_at ? new Date(r.expires_at) : null,
      revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    };
  }
}
export class InMemoryTenantRepository implements TenantRepository {
  constructor(public readonly records: TenantTokenRecord[] = []) {}
  async findActiveTokenByHash(tokenHash: string): Promise<TenantTokenRecord | null> {
    const now = Date.now();
    return (
      this.records.find(
        (x) =>
          x.tokenHash === tokenHash &&
          x.tenantStatus === 'active' &&
          !x.revokedAt &&
          (!x.expiresAt || x.expiresAt.getTime() > now),
      ) ?? null
    );
  }
}
