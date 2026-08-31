export function assertDateWindow(effectiveDate: string, expiryDate: string | null): void {
  const start = Date.parse(`${effectiveDate}T00:00:00Z`);
  if (!Number.isFinite(start)) throw new Error('INVALID_EFFECTIVE_DATE');
  if (expiryDate) {
    const end = Date.parse(`${expiryDate}T23:59:59.999Z`);
    if (!Number.isFinite(end)) throw new Error('INVALID_EXPIRY_DATE');
    if (end < start) throw new Error('EXPIRY_BEFORE_EFFECTIVE_DATE');
  }
}

export function isActiveWindow(
  effectiveDate: string,
  expiryDate: string | null,
  at = new Date(),
): boolean {
  const start = Date.parse(`${effectiveDate}T00:00:00Z`);
  const end = expiryDate ? Date.parse(`${expiryDate}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  const current = at.getTime();
  return Number.isFinite(start) && current >= start && current <= end;
}
