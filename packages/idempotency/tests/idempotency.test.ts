import { describe, expect, it } from 'vitest';
import { IdempotencyCoordinator, InMemoryOperationStore, requestHash } from '../src/index.js';

describe('idempotency', () => {
  it('canonicalizes object keys', () => {
    expect(requestHash({ b: 2, a: 1 })).toBe(requestHash({ a: 1, b: 2 }));
  });

  it('allows one executor under duplicate concurrency', async () => {
    const coordinator = new IdempotencyCoordinator(new InMemoryOperationStore());
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        coordinator.begin({
          tenantId: 'a',
          idempotencyKey: 'k',
          operationType: 'quote.prepare',
          requestBody: { q: 3 },
        }),
      ),
    );
    expect(results.filter((x) => x.kind === 'execute')).toHaveLength(1);
    expect(results.filter((x) => x.kind === 'in_progress')).toHaveLength(19);
  });

  it('replays a successful response', async () => {
    const coordinator = new IdempotencyCoordinator(new InMemoryOperationStore());
    const first = await coordinator.begin({
      tenantId: 'a',
      idempotencyKey: 'k2',
      operationType: 'quote.prepare',
      requestBody: { a: 1 },
    });
    if (first.kind !== 'execute') throw new Error('expected execute');
    await coordinator.succeed(first.operation.id, first.executionId, { ok: true });

    const replay = await coordinator.begin({
      tenantId: 'a',
      idempotencyKey: 'k2',
      operationType: 'quote.prepare',
      requestBody: { a: 1 },
    });
    expect(replay.kind).toBe('replay');
  });

  it('rejects key reuse with a different body', async () => {
    const coordinator = new IdempotencyCoordinator(new InMemoryOperationStore());
    await coordinator.begin({
      tenantId: 'a',
      idempotencyKey: 'k3',
      operationType: 'x',
      requestBody: { a: 1 },
    });
    await expect(
      coordinator.begin({
        tenantId: 'a',
        idempotencyKey: 'k3',
        operationType: 'x',
        requestBody: { a: 2 },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('reclaims an expired lease after a simulated restart', async () => {
    const store = new InMemoryOperationStore();
    const firstCoordinator = new IdempotencyCoordinator(store, 1);
    const first = await firstCoordinator.begin({
      tenantId: 'a',
      idempotencyKey: 'restart-key',
      operationType: 'quote.prepare',
      requestBody: { a: 1 },
    });
    expect(first.kind).toBe('execute');

    await new Promise((resolve) => setTimeout(resolve, 5));

    const restartedCoordinator = new IdempotencyCoordinator(store, 1000);
    const resumed = await restartedCoordinator.begin({
      tenantId: 'a',
      idempotencyKey: 'restart-key',
      operationType: 'quote.prepare',
      requestBody: { a: 1 },
    });
    expect(resumed.kind).toBe('execute');
  });
});
