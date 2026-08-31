import { parse } from 'csv-parse/sync';
import type { PriceBookInputRow, PriceBookProvisioningInput, PriceDisclosure } from './types.js';
import { assertDateWindow } from './date-window.js';

type CsvRow = Record<string, string>;

function money(raw: string, field: string, code: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`INVALID_${field.toUpperCase()}:${code}`);
  return value;
}

function bool(raw: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(raw.trim().toLowerCase());
}

function disclosure(raw: string): PriceDisclosure {
  const value = raw.trim().toLowerCase();
  if (
    value === 'allowed' ||
    value === 'quote_only' ||
    value === 'range_only' ||
    value === 'human_only'
  ) {
    return value;
  }
  throw new Error(`INVALID_PRICE_DISCLOSURE:${raw}`);
}

export function parsePriceBookCsv(
  text: string,
  base: Omit<PriceBookProvisioningInput, 'rows'>,
): PriceBookProvisioningInput {
  const rawRows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
  const seen = new Set<string>();

  const rows: PriceBookInputRow[] = rawRows.map((row) => {
    const code = (row.code ?? '').trim();
    if (!code) throw new Error('MISSING_CODE');
    if (seen.has(code)) throw new Error(`DUPLICATE_PRICE_CODE:${code}`);
    seen.add(code);

    const type = (row.type ?? '').trim().toLowerCase();
    if (type !== 'product' && type !== 'service') throw new Error(`INVALID_TYPE:${code}`);

    const effectiveDate = row.effective_date?.trim() || base.effectiveDate;
    const expiryDate = row.expiry_date?.trim() || base.expiryDate;
    assertDateWindow(effectiveDate, expiryDate);

    const cost = money(row.cost ?? '', 'cost', code);
    const sellPrice = money(row.sell_price ?? '', 'sell_price', code);
    if (sellPrice < cost) throw new Error(`SELL_PRICE_BELOW_COST:${code}`);

    return {
      code,
      type,
      name: (row.name ?? '').trim(),
      aliases: (row.aliases ?? '')
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean),
      uom: (row.uom ?? '').trim().toUpperCase(),
      cost,
      sellPrice,
      category: (row.category ?? '').trim(),
      enabled: bool(row.enabled ?? 'true'),
      effectiveDate,
      expiryDate,
      priceDisclosure: disclosure(row.price_disclosure ?? 'quote_only'),
      ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
    };
  });

  assertDateWindow(base.effectiveDate, base.expiryDate);
  return { ...base, rows };
}
