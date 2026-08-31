export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function extendedMoney(unitPrice: number, quantity: number): number {
  return roundMoney(unitPrice * quantity);
}

export function deriveMarkup(unitCost: number, unitSell: number): number {
  if (unitCost === 0) {
    if (unitSell === 0) return 0;
    throw new Error('ZERO_COST_CANNOT_DERIVE_MARKUP');
  }
  return (unitSell - unitCost) / unitCost;
}
