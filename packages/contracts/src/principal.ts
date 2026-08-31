import type { BridgeRole } from './rbac.js';
export interface BridgePrincipal {
  tokenId: string;
  tenantId: string;
  role: BridgeRole;
  scopes: string[];
}
