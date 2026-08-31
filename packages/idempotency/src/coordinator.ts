import { randomUUID } from 'node:crypto';
import { AppError } from '@frontdesk-q/contracts';
import { requestHash } from './hash.js';
import type { BridgeOperation, OperationStore } from './store.js';

export type BeginResult =
  | { kind: 'execute'; operation: BridgeOperation; executionId: string }
  | { kind: 'replay'; operation: BridgeOperation; response: unknown }
  | { kind: 'in_progress'; operation: BridgeOperation }
  | { kind: 'reconcile'; operation: BridgeOperation; executionId: string }
  | { kind: 'failed'; operation: BridgeOperation };

export class IdempotencyCoordinator {
  constructor(
    private readonly store: OperationStore,
    private readonly leaseMs = 30_000,
  ) {}

  async begin(input: {
    tenantId: string;
    idempotencyKey: string;
    operationType: string;
    requestBody: unknown;
  }): Promise<BeginResult> {
    if (!input.idempotencyKey) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutation requires X-Idempotency-Key',
        400,
        false,
        'The request could not be safely processed.',
      );
    }

    const hash = requestHash(input.requestBody);
    const reserved = await this.store.reserve({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      operationType: input.operationType,
      requestHash: hash,
    });

    if (reserved.operation.requestHash !== hash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was reused with a different request body',
        409,
        false,
        'This request conflicts with an earlier operation.',
      );
    }

    if (reserved.operation.status === 'succeeded') {
      return {
        kind: 'replay',
        operation: reserved.operation,
        response: reserved.operation.responseJson,
      };
    }
    if (reserved.operation.status === 'failed_terminal') {
      return { kind: 'failed', operation: reserved.operation };
    }

    const executionId = `exec_${randomUUID()}`;
    const claimed = await this.store.claim(reserved.operation.id, executionId, this.leaseMs);
    if (!claimed) return { kind: 'in_progress', operation: reserved.operation };

    if (claimed.status === 'upstream_unknown') {
      return { kind: 'reconcile', operation: claimed, executionId };
    }
    return { kind: 'execute', operation: claimed, executionId };
  }

  checkpoint(
    id: string,
    executionId: string,
    step: string,
    fields: Partial<BridgeOperation> = {},
  ): Promise<void> {
    return this.store.checkpoint(id, {
      status: 'executing',
      currentStep: step,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + this.leaseMs),
      ...fields,
    });
  }

  markProviderCreateUncertain(id: string, executionId: string, step: string): Promise<void> {
    return this.store.checkpoint(id, {
      status: 'upstream_unknown',
      currentStep: step,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + this.leaseMs),
      lastErrorCode: 'UPSTREAM_STATE_UNKNOWN',
    });
  }

  succeed(id: string, executionId: string, response: unknown): Promise<void> {
    return this.store.checkpoint(id, {
      status: 'succeeded',
      currentStep: 'complete',
      responseJson: response,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  upstreamUnknown(id: string, executionId: string, code = 'UPSTREAM_STATE_UNKNOWN'): Promise<void> {
    return this.store.checkpoint(id, {
      status: 'upstream_unknown',
      lastErrorCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  failTerminal(id: string, executionId: string, code: string): Promise<void> {
    return this.store.checkpoint(id, {
      status: 'failed_terminal',
      lastErrorCode: code,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }
}
