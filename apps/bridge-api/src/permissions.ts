import { AppError, hasPermission, type BridgePermission } from '@frontdesk-q/contracts';
import type { FastifyRequest } from 'fastify';

export function requirePermission(request: FastifyRequest, permission: BridgePermission): void {
  const principal = request.bridgePrincipal;
  if (!principal || !hasPermission(principal.role, permission)) {
    throw new AppError(
      'FORBIDDEN',
      `Role ${principal?.role ?? 'anonymous'} lacks ${permission}`,
      403,
      false,
      'You do not have permission to perform this action.',
    );
  }
}
