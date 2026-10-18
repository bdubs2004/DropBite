/**
 * How much a dish cost to make: $, $$ or $$$, picked when posting (optional)
 * and filtered on in Search. Stored as posts.price_level, 1 to 3 (migration
 * 0040); no price is null.
 */

export type PriceLevel = 1 | 2 | 3;

export const PRICE_LEVELS: { level: PriceLevel; symbol: string; name: string }[] = [
  { level: 1, symbol: '$', name: 'Cheap' },
  { level: 2, symbol: '$$', name: 'Moderate' },
  { level: 3, symbol: '$$$', name: 'Pricey' },
];

/** "$$" for 2; '' for no price. */
export function priceSymbol(level: number | null | undefined): string {
  return PRICE_LEVELS.find((p) => p.level === level)?.symbol ?? '';
}

/** A post's price level, safe to draw: 1, 2, 3 or null. */
export function cleanPriceLevel(raw: unknown): PriceLevel | null {
  return raw === 1 || raw === 2 || raw === 3 ? raw : null;
}
