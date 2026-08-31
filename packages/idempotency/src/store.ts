import type { DbPool } from '@frontdesk-q/db';

export type OperationStatus =
  | 'reserved'
  | 'executing'
  | 'upstream_unknown'
  | 'succeeded'
  | 'failed_retriable'
  | 'failed_terminal';

export interface BridgeOperation {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  operationType: string;
  requestHash: string;
  status: OperationStatus;
  currentStep: string | null;
  bridgeResourceId: string | null;
  bidwrightProjectId: string | null;
  bidwrightQuoteId: string | null;
  bidwrightRevisionId: string | null;
  responseJson: unknown | null;
  lastErrorCode: string | null;
  attemptCount: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  updatedAt: Date;
}

export interface ReserveResult {
  created: boolean;
  operation: BridgeOperation;
}

export interface OperationStore {
  reserve(input: {
    tenantId: string;
    idempotencyKey: string;
    operationType: string;
    requestHash: string;
  }): Promise<ReserveResult>;
  claim(id: string, owner: string, leaseMs: number): Promise<BridgeOperation | null>;
  checkpoint(id: string, input: Partial<BridgeOperation>): Promise<void>;
  get(id: string): Promise<BridgeOperation | null>;
}

function mapRow(row: any): BridgeOperation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    operationType: row.operation_type,
    requestHash: row.request_hash,
    status: row.status,
    currentStep: row.current_step,
    bridgeResourceId: row.bridge_resource_id,
    bidwrightProjectId: row.bidwright_project_id,
    bidwrightQuoteId: row.bidwright_quote_id,
    bidwrightRevisionId: row.bidwright_revision_id,
    responseJson: row.response_json,
    lastErrorCode: row.last_error_code,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

export class PostgresOperationStore implements OperationStore {
  constructor(private readonly pool: DbPool) {}

  async reserve(input: {
    tenantId: string;
    idempotencyKey: string;
    operationType: string;
    requestHash: string;
  }): Promise<ReserveResult> {
    const inserted = await this.pool.query(
      `insert into bridge_operations
        (tenant_id,idempotency_key,operation_type,request_hash,status,attempt_count)
       values($1,$2,$3,$4,'reserved',1)
       on conflict(tenant_id,idempotency_key) do nothing
       returning *`,
      [input.tenantId, input.idempotencyKey, input.operationType, input.requestHash],
    );

    if (inserted.rows[0]) return { created: true, operation: mapRow(inserted.rows[0]) };

    const existing = await this.pool.query(
      `select * from bridge_operations where tenant_id=$1 and idempotency_key=$2 limit 1`,
      [input.tenantId, input.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error('OPERATION_RESERVATION_RACE');
    return { created: false, operation: mapRow(existing.rows[0]) };
  }

  async claim(id: string, owner: string, leaseMs: number): Promise<BridgeOperation | null> {
    const result = await this.pool.query(
      `update bridge_operations
       set lease_owner=$2,
           lease_expires_at=now() + ($3::text || ' milliseconds')::interval,
           attempt_count=attempt_count+1,
           updated_at=now()
       where id=$1
         and status not in ('succeeded','failed_terminal')
         and (
           lease_owner=$2
           or lease_expires_at is null
           or lease_expires_at < now()
         )
       returning *`,
      [id, owner, Math.max(1, leaseMs)],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async checkpoint(id: string, input: Partial<BridgeOperation>): Promise<void> {
    const mapping: Record<string, string> = {
      status: 'status',
      currentStep: 'current_step',
      bridgeResourceId: 'bridge_resource_id',
      bidwrightProjectId: 'bidwright_project_id',
      bidwrightQuoteId: 'bidwright_quote_id',
      bidwrightRevisionId: 'bidwright_revision_id',
      responseJson: 'response_json',
      lastErrorCode: 'last_error_code',
      attemptCount: 'attempt_count',
      leaseOwner: 'lease_owner',
      leaseExpiresAt: 'lease_expires_at',
    };
    const entries = Object.entries(input).filter(
      ([key, value]) => mapping[key] && value !== undefined,
    );
    if (!entries.length) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    entries.forEach(([key, value], index) => {
      sets.push(`${mapping[key]}=$${index + 1}`);
      values.push(value);
    });
    values.push(id);

    await this.pool.query(
      `update bridge_operations
       set ${sets.join(',')},
           updated_at=now(),
           completed_at=case when status in('succeeded','failed_terminal') then now() else completed_at end
       where id=$${values.length}`,
      values,
    );
  }

  async get(id: string): Promise<BridgeOperation | null> {
    const result = await this.pool.query('select * from bridge_operations where id=$1', [id]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }
}

export class InMemoryOperationStore implements OperationStore {
  private readonly map = new Map<string, BridgeOperation>();
  private seq = 0;

  private key(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }

  async reserve(input: {
    tenantId: string;
    idempotencyKey: string;
    operationType: string;
    requestHash: string;
  }): Promise<ReserveResult> {
    const key = this.key(input.tenantId, input.idempotencyKey);
    const existing = this.map.get(key);
    if (existing) return { created: false, operation: structuredClone(existing) };

    const operation: BridgeOperation = {
      id: `op_${++this.seq}`,
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: input.operationType,
      requestHash: input.requestHash,
      status: 'reserved',
      currentStep: null,
      bridgeResourceId: null,
      bidwrightProjectId: null,
      bidwrightQuoteId: null,
      bidwrightRevisionId: null,
      responseJson: null,
      lastErrorCode: null,
      attemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    };
    this.map.set(key, operation);
    return { created: true, operation: structuredClone(operation) };
  }

  async claim(id: string, owner: string, leaseMs: number): Promise<BridgeOperation | null> {
    const now = Date.now();
    for (const [key, operation] of this.map) {
      if (operation.id !== id) continue;
      if (operation.status === 'succeeded' || operation.status === 'failed_terminal') return null;
      const claimable =
        operation.leaseOwner === owner ||
        !operation.leaseExpiresAt ||
        operation.leaseExpiresAt.getTime() < now;
      if (!claimable) return null;

      const next = {
        ...operation,
        leaseOwner: owner,
        leaseExpiresAt: new Date(now + Math.max(1, leaseMs)),
        attemptCount: operation.attemptCount + 1,
        updatedAt: new Date(),
      };
      this.map.set(key, next);
      return structuredClone(next);
    }
    return null;
  }

  async checkpoint(id: string, input: Partial<BridgeOperation>): Promise<void> {
    for (const [key, operation] of this.map) {
      if (operation.id === id) {
        this.map.set(key, { ...operation, ...input, updatedAt: new Date() });
        return;
      }
    }
    throw new Error('OPERATION_NOT_FOUND');
  }

  async get(id: string): Promise<BridgeOperation | null> {
    const operation = [...this.map.values()].find((x) => x.id === id);
    return operation ? structuredClone(operation) : null;
  }
}
