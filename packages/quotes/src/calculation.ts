import { requestHash } from '@frontdesk-q/idempotency';

export interface AuthoritativeTotals {
  subtotal: number | null;
  grandTotal: number;
  warnings: string[];
  calculationHash: string;
}

function objects(value: unknown, depth = 0): Record<string, any>[] {
  if (depth > 7 || !value || typeof value !== 'object') return [];
  const object = value as Record<string, any>;
  const result: Record<string, any>[] = [object];
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) {
      for (const item of child) result.push(...objects(item, depth + 1));
    } else if (child && typeof child === 'object') {
      result.push(...objects(child, depth + 1));
    }
  }
  return result;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function extractAuthoritativeTotals(
  payload: unknown,
  revisionId: string,
): AuthoritativeTotals | null {
  const candidates = objects(payload)
    .map((object) => {
      const rawGrandTotal = number(object.grandTotal);
      const calculatedTotal = number(object.calculatedTotal) ?? number(object.total);
      const grandTotal =
        rawGrandTotal === 0 && calculatedTotal !== null && calculatedTotal > 0
          ? calculatedTotal
          : (rawGrandTotal ?? calculatedTotal);
      const subtotal = number(object.subtotal);
      let rank = 0;
      if (object.id === revisionId) rank += 10;
      if (object.revisionNumber !== undefined) rank += 4;
      if (object.quoteId) rank += 2;
      if (subtotal !== null) rank += 1;
      return { object, grandTotal, subtotal, rank };
    })
    .filter((x) => x.grandTotal !== null)
    .sort((a, b) => b.rank - a.rank);

  const best = candidates[0];
  if (!best || best.grandTotal === null) return null;

  const warnings = [
    ...new Set(
      objects(payload).flatMap((object) =>
        Array.isArray(object.warnings)
          ? object.warnings.filter((x: unknown): x is string => typeof x === 'string')
          : [],
      ),
    ),
  ];

  return {
    subtotal: best.subtotal,
    grandTotal: best.grandTotal,
    warnings,
    calculationHash: requestHash({
      revisionId,
      subtotal: best.subtotal,
      grandTotal: best.grandTotal,
      warnings,
    }),
  };
}

export function blockingWarnings(warnings: string[]): string[] {
  const blocking = /(missing|not found|invalid|unresolved|no active|mismatch|failed|error)/i;
  return warnings.filter((warning) => blocking.test(warning));
}
