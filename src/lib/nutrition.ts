import { Ingredient } from '../types';

/**
 * Recipe nutrition: summing ingredients, and dividing by servings.
 *
 * Two rules make the rest of this coherent:
 *
 *  1. **Totals are the stored truth.** `Nutrition` on a recipe is always the
 *     whole dish. Per-serving numbers are derived at display time, so changing
 *     the serving count later costs nothing and cannot corrupt the underlying
 *     figures.
 *  2. **Servings is the user's to set.** Nothing can infer that a pie feeds
 *     four. The AI sees "flour, butter, apples" and has no idea whether one
 *     person ate it. Getting this wrong by 4x is worse than showing nothing,
 *     which is why the editor asks.
 */

/** Totals for a whole recipe, or the per-serving slice of one. */
export interface Nutrition {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

/** Where the numbers came from. Shown on the card; never guessed at. */
export type NutritionSource = 'usda' | 'estimated' | 'demo';

export const EMPTY_NUTRITION: Nutrition = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

const KEYS = Object.keys(EMPTY_NUTRITION) as (keyof Nutrition)[];

/** Nutrients per 100 g, as USDA reports them. */
export type Per100g = Nutrition;

/**
 * Scale a per-100g figure to an actual weight.
 *
 * Returns null rather than zero when the weight is unknown: an ingredient we
 * could not weigh must be excluded and *said* to be excluded, not silently
 * counted as contributing nothing.
 */
export function forGrams(per100g: Per100g, grams: number | null | undefined): Nutrition | null {
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) return null;
  const factor = grams / 100;
  const out = { ...EMPTY_NUTRITION };
  for (const k of KEYS) out[k] = (per100g[k] ?? 0) * factor;
  return out;
}

export function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  const out = { ...EMPTY_NUTRITION };
  for (const k of KEYS) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

export interface RecipeTotals {
  /** Totals for the whole dish. */
  total: Nutrition;
  /** How many ingredients contributed. */
  counted: number;
  /** Ingredients skipped because we had no nutrition for them. */
  missing: string[];
}

/**
 * Sum whatever nutrition the ingredients carry.
 *
 * Ingredients without nutrition are reported in `missing` rather than dropped
 * quietly — a total that silently omits the butter is worse than one that says
 * "butter not counted", because the first looks complete.
 */
export function totalForRecipe(ingredients: Ingredient[]): RecipeTotals {
  let total = { ...EMPTY_NUTRITION };
  let counted = 0;
  const missing: string[] = [];

  for (const ing of ingredients) {
    const n = ing.nutrition;
    if (!n) {
      if (ing.item?.trim()) missing.push(ing.item.trim());
      continue;
    }
    total = addNutrition(total, n);
    counted++;
  }
  return { total, counted, missing };
}

/**
 * One serving's worth.
 *
 * A serving count below 1 is treated as 1 rather than dividing by zero or
 * returning Infinity — the database constrains it to 1..100, but this is
 * called on unsaved editor state too.
 */
export function perServing(total: Nutrition, servings: number): Nutrition {
  const n = Number.isFinite(servings) && servings >= 1 ? Math.floor(servings) : 1;
  const out = { ...EMPTY_NUTRITION };
  for (const k of KEYS) out[k] = (total[k] ?? 0) / n;
  return out;
}

/**
 * Round for display.
 *
 * Calories to the nearest 5 and grams to the nearest whole number, because
 * precision the underlying data does not have is a lie told with decimals.
 * The FDA rounds nutrition labels for the same reason.
 */
export function roundForDisplay(n: Nutrition): Nutrition {
  return {
    calories: Math.round(n.calories / 5) * 5,
    protein_g: Math.round(n.protein_g),
    carbs_g: Math.round(n.carbs_g),
    fat_g: Math.round(n.fat_g),
    fiber_g: Math.round(n.fiber_g),
    sugar_g: Math.round(n.sugar_g),
    sodium_mg: Math.round(n.sodium_mg / 5) * 5,
  };
}

/** "Serves 4" / "Serves 1". */
export function servingsLabel(servings: number): string {
  const n = Math.max(1, Math.floor(servings || 1));
  return n === 1 ? 'Serves 1' : `Serves ${n}`;
}

/**
 * How much of the dish one serving is — the thing the user is really choosing.
 * 4 servings of a pie is "1/4 of the recipe".
 */
export function servingFractionLabel(servings: number): string {
  const n = Math.max(1, Math.floor(servings || 1));
  return n === 1 ? 'the whole recipe' : `1/${n} of the recipe`;
}
