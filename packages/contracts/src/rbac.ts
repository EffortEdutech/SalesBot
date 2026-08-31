export type BridgeRole =
  'platform_admin' | 'tenant_owner' | 'estimator' | 'staff' | 'viewer' | 'ai_runtime';
export type BridgePermission =
  | 'intake.write'
  | 'offering.read'
  | 'price.read'
  | 'quote.read'
  | 'quote.prepare'
  | 'quote.approve'
  | 'quote.reject'
  | 'quote.deliver'
  | 'pricebook.manage'
  | 'tenant.manage'
  | 'audit.read';

const p: Record<BridgeRole, ReadonlySet<BridgePermission>> = {
  platform_admin: new Set([
    'intake.write',
    'offering.read',
    'price.read',
    'quote.read',
    'quote.prepare',
    'quote.approve',
    'quote.reject',
    'quote.deliver',
    'pricebook.manage',
    'tenant.manage',
    'audit.read',
  ]),
  tenant_owner: new Set([
    'intake.write',
    'offering.read',
    'price.read',
    'quote.read',
    'quote.prepare',
    'quote.approve',
    'quote.reject',
    'quote.deliver',
    'pricebook.manage',
    'tenant.manage',
    'audit.read',
  ]),
  estimator: new Set([
    'intake.write',
    'offering.read',
    'price.read',
    'quote.read',
    'quote.prepare',
    'quote.approve',
    'quote.reject',
    'quote.deliver',
    'audit.read',
  ]),
  staff: new Set(['intake.write', 'offering.read', 'price.read', 'quote.read', 'quote.prepare']),
  viewer: new Set(['quote.read', 'offering.read']),
  ai_runtime: new Set([
    'intake.write',
    'offering.read',
    'price.read',
    'quote.read',
    'quote.prepare',
  ]),
};
export const hasPermission = (role: BridgeRole, permission: BridgePermission) =>
  p[role].has(permission);
