const replacements: Array<[RegExp, string]> = [
  [/\bair[\s-]*conditioner\b/gi, ' aircond '],
  [/\bair[\s-]*con\b/gi, ' aircond '],
  [/\baircond\b/gi, ' aircond '],
  [/\ba\/c\b/gi, ' aircond '],
  [/\bac\b/gi, ' aircond '],
  [/\binstallation\b/gi, ' install '],
  [/\binstalling\b/gi, ' install '],
  [/\binstalled\b/gi, ' install '],
  [/\bmetres?\b/gi, ' m '],
  [/\bmeters?\b/gi, ' m '],
  [/\bhours?\b/gi, ' hr '],
];

const stop = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'to',
  'and',
  'with',
  'please',
  'need',
  'want',
]);

export function normalizeSearchText(value: string): string {
  let result = value.normalize('NFKD').toLowerCase();
  for (const [pattern, replacement] of replacements) result = result.replace(pattern, replacement);
  return result
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTokens(value: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(value)
        .split(' ')
        .filter((x) => x && !stop.has(x)),
    ),
  ];
}

export function extractHp(value: string): number | null {
  const normalized = normalizeSearchText(value);
  const hp = /(?:^|\s)(\d+(?:\.\d+)?)\s*hp(?:\s|$)/i.exec(normalized);
  if (hp) return Number(hp[1]);
  const horsepower = /(?:^|\s)(\d+(?:\.\d+)?)\s*horsepower(?:\s|$)/i.exec(value);
  return horsepower ? Number(horsepower[1]) : null;
}
