import { AppError, type BridgePrincipal } from '@frontdesk-q/contracts';
import { hashBridgeToken } from '@frontdesk-q/auth';
import type { FastifyRequest } from 'fastify';
import type { TenantRepository } from '@frontdesk-q/tenant';
function bearer(req: FastifyRequest) {
  const h = req.headers.authorization;
  if (!h) return null;
  return /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim() || null;
}
export function createTenantAuthenticator(input: {
  repository: TenantRepository;
  pepper: string;
  requireTenantHeader: boolean;
}) {
  return async (req: FastifyRequest): Promise<BridgePrincipal> => {
    const raw = bearer(req);
    if (!raw)
      throw new AppError(
        'AUTH_REQUIRED',
        'Authorization bearer token is required',
        401,
        false,
        'Authentication is required.',
      );
    const rec = await input.repository.findActiveTokenByHash(hashBridgeToken(raw, input.pepper));
    if (!rec || rec.tenantStatus !== 'active')
      throw new AppError(
        'AUTH_INVALID',
        'Invalid, expired, revoked, or disabled token',
        401,
        false,
        'Authentication failed.',
      );
    const asserted = req.headers['x-tenant-id'];
    if (input.requireTenantHeader && !asserted)
      throw new AppError(
        'TENANT_MISMATCH',
        'X-Tenant-ID is required',
        403,
        false,
        'The tenant context could not be verified.',
      );
    if (asserted && asserted !== rec.tenantId)
      throw new AppError(
        'TENANT_MISMATCH',
        `Token tenant ${rec.tenantId} does not match asserted tenant ${asserted}`,
        403,
        false,
        'The tenant context could not be verified.',
      );
    return { tokenId: rec.tokenId, tenantId: rec.tenantId, role: rec.role, scopes: rec.scopes };
  };
}
