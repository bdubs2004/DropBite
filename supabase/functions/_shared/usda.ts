// USDA FoodData Central: picking the right food from a search, and reading its
// nutrients. Used by lookup-nutrition; kept apart so it can be tested without
// the network.
//
// Why picking matters: USDA's search ranks loosely, and its first hit for a
// short term is often the plainest version of the food. "popcorn" comes back
// as air-popped, unsalted popcorn (about 8 mg sodium per 100 g), which is not
// what a bag of microwave butter popcorn is (hundreds of mg). So the search
// term keeps the words that change the numbers (microwave, butter, salted,
// fried...) and the result whose description covers the most of them wins.

/** USDA nutrient numbers we keep (stable ids; the names drift between datasets). */
export const NUTRIENT_IDS: Record<string, string> = {
  '208': 'calories', // Energy, kcal
  '203': 'protein_g',
  '205': 'carbs_g', // Carbohydrate, by difference
  '204': 'fat_g', // Total lipid (fat)
  '291': 'fiber_g',
  '269': 'sugar_g', // Sugars, total
  '307': 'sodium_mg',
};

export const EMPTY_PER_100G = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

/** Generic datasets only, all reported per 100 g. FNDDS covers prepared foods. */
export const USDA_DATA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS)';
/** How many results to choose from. */
export const USDA_PAGE_SIZE = 12;

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'in', 'or', 'for', 'to', 'style', 'type', 'nfs', 'ns']);

/** Lowercase words, no punctuation, simple plurals folded ("eggs" -> "egg"). */
export function words(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/**
 * The search result that best matches the term, or null when none shares a
 * single word with it (better "not counted" than a wrong food counted).
 *
 * Most of the term's words covered wins. Among equally good matches USDA's own
 * order decides (so "egg" stays whole egg, not the shorter "egg white"), with
 * extra words only a slight nudge toward the closer food.
 */
export function pickBestFood<T extends { description?: unknown }>(term: string, foods: T[]): T | null {
  const want = [...new Set(words(term))];
  if (want.length === 0 || !Array.isArray(foods)) return null;
  let best: { food: T; score: number } | null = null;
  foods.forEach((food, rank) => {
    const have = new Set(words(String(food?.description ?? '')));
    const covered = want.filter((w) => have.has(w)).length;
    if (covered === 0) return;
    const extra = [...have].filter((w) => !want.includes(w)).length;
    const score = (covered / want.length) * 100 - rank * 2 - extra * 0.25;
    if (!best || score > best.score) best = { food, score };
  });
  return best ? (best as { food: T; score: number }).food : null;
}

/** Nutrients per 100 g from a search result, or null when it carries none. */
export function per100gFrom(food: { foodNutrients?: unknown } | null): Record<string, number> | null {
  if (!food) return null;
  const per100g: Record<string, number> = { ...EMPTY_PER_100G };
  let sawAny = false;
  for (const n of (Array.isArray(food.foodNutrients) ? food.foodNutrients : []) as any[]) {
    // The search endpoint and the detail endpoint disagree on shape; accept both.
    const number = String(n?.nutrientNumber ?? n?.nutrient?.number ?? '');
    const value = Number(n?.value ?? n?.amount);
    const key = NUTRIENT_IDS[number];
    if (key && Number.isFinite(value)) {
      per100g[key] = value;
      sawAny = true;
    }
  }
  return sawAny ? per100g : null;
}

/**
 * The cache key for a term. Versioned, so matches made by an older way of
 * picking (the first search result, before v2) are never reused.
 */
export function cacheKey(term: string): string {
  return `v2|${term}`.slice(0, 120);
}
