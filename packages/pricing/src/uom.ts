import { pricingError } from './errors.js';

const aliases: Record<string, string> = {
  EA: 'EA',
  EACH: 'EA',
  UNIT: 'EA',
  UNITS: 'EA',
  PC: 'EA',
  PCS: 'EA',
  M: 'M',
  METER: 'M',
  METERS: 'M',
  METRE: 'M',
  METRES: 'M',
  HR: 'HR',
  HOUR: 'HR',
  HOURS: 'HR',
  LS: 'LS',
  LOT: 'LS',
  LUMP_SUM: 'LS',
};

export function normalizeUom(value: string): string {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return aliases[key] ?? key;
}

export function assertCompatibleUom(expected: string, supplied: string): string {
  const e = normalizeUom(expected);
  const s = normalizeUom(supplied);
  if (e !== s) {
    throw pricingError('UNIT_MISMATCH', `Expected ${e}, received ${s}`);
  }
  return e;
}
