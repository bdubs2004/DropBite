import { DEMO_MODE } from '../config';
import { LIMITS } from '../lib/limits';
import { Ingredient } from '../types';
import { NutritionSource, Per100g } from '../lib/nutrition';
import { getSupabase } from './supabase/client';

export interface NutritionResult {
  ingredients: Ingredient[];
  source: NutritionSource | null;
  /** Ingredients we could not price, named so the UI can say which. */
  unmatched: string[];
}

/**
 * Work out nutrition for a set of ingredients.
 *
 * Production calls the `lookup-nutrition` edge function, which uses the model
 * only to estimate a weight and then reads the actual nutrient numbers out of
 * USDA FoodData Central. Demo mode uses the small seeded table below.
 *
 * Returns null on any failure. Like recipe formatting, nutrition must never
 * block a post — a card without a label is fine, a wrong label is not.
 */
export async function lookupNutrition(ingredients: Ingredient[]): Promise<NutritionResult | null> {
  const usable = ingredients.filter((i) => i.item?.trim());
  if (usable.length === 0) return null;
  try {
    if (DEMO_MODE) {
      await new Promise((r) => setTimeout(r, 700));
      return demoNutrition(usable);
    }
    const sb = getSupabase();
    const { data, error } = await sb.functions.invoke('lookup-nutrition', {
      body: { ingredients: usable.map((i) => ({ item: i.item, quantity: i.quantity, unit: i.unit })) },
    });
    if (error || !data) return null;
    return sanitizeNutrition(data, usable);
  } catch {
    return null;
  }
}

/** Never trust the shape coming back, same as the recipe path. */
function sanitizeNutrition(data: any, original: Ingredient[]): NutritionResult | null {
  if (!data || !Array.isArray(data.ingredients)) return null;
  const num = (v: any, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

  const ingredients: Ingredient[] = original.map((orig, i) => {
    const row = data.ingredients[i] ?? {};
    const n = row.nutrition;
    const nutrition =
      n && typeof n === 'object'
        ? {
            calories: num(n.calories, 100000) ?? 0,
            protein_g: num(n.protein_g, 10000) ?? 0,
            carbs_g: num(n.carbs_g, 10000) ?? 0,
            fat_g: num(n.fat_g, 10000) ?? 0,
            fiber_g: num(n.fiber_g, 10000) ?? 0,
            sugar_g: num(n.sugar_g, 10000) ?? 0,
            sodium_mg: num(n.sodium_mg, 1000000) ?? 0,
          }
        : null;
    return {
      ...orig,
      grams: num(row.grams, 20000),
      fdc_id: typeof row.fdc_id === 'number' ? row.fdc_id : null,
      nutrition,
    };
  });

  const source: NutritionSource | null =
    data.source === 'usda' || data.source === 'estimated' || data.source === 'demo'
      ? data.source
      : null;
  const unmatched = Array.isArray(data.unmatched)
    ? data.unmatched.map((u: any) => String(u).slice(0, 120)).slice(0, 50)
    : ingredients.filter((i) => !i.nutrition).map((i) => i.item);

  return { ingredients, source, unmatched };
}

export interface FormattedRecipe {
  is_recipe: boolean;
  title: string;
  ingredients: Ingredient[];
  steps: string[];
  cook_time_minutes: number | null;
}

/**
 * Turn a casual blurb into a structured recipe.
 *
 * Production: calls the Supabase Edge Function `format-recipe`, which holds
 * the Anthropic API key server-side (never ship the key in the app).
 * Demo mode: a local heuristic parser so the flow is fully testable offline.
 *
 * Always parse defensively: on any failure return null and let the UI fall
 * back to blurb-only. Formatting must never block a post.
 */
export async function formatRecipe(blurb: string): Promise<FormattedRecipe | null> {
  try {
    if (DEMO_MODE) {
      // simulate a beat of latency so the loading state is honest
      await new Promise((r) => setTimeout(r, 900));
      return heuristicFormat(blurb);
    }
    const sb = getSupabase();
    const { data, error } = await sb.functions.invoke('format-recipe', {
      // Bounded before it leaves the device; the function enforces the same
      // cap, and sending less keeps a long blurb from being billed as tokens.
      body: { blurb: blurb.slice(0, LIMITS.blurb) },
    });
    if (error) return null;
    return sanitize(data);
  } catch {
    return null;
  }
}

function sanitize(data: any): FormattedRecipe | null {
  if (!data || typeof data !== 'object') return null;
  return {
    is_recipe: Boolean(data.is_recipe),
    title: String(data.title ?? 'My Recipe').slice(0, LIMITS.recipeTitle),
    ingredients: Array.isArray(data.ingredients)
      ? data.ingredients
          .slice(0, LIMITS.recipeItems)
          .filter((i: any) => i && typeof i.item === 'string')
          .map((i: any) => ({
            item: String(i.item),
            quantity: String(i.quantity ?? ''),
            unit: String(i.unit ?? ''),
          }))
      : [],
    steps: Array.isArray(data.steps)
      ? data.steps.slice(0, LIMITS.recipeItems).map((s: any) => String(s).slice(0, 500))
      : [],
    cook_time_minutes:
      typeof data.cook_time_minutes === 'number' && Number.isFinite(data.cook_time_minutes)
        ? Math.min(Math.max(Math.round(data.cook_time_minutes), 0), 6000)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Demo-mode nutrition.
//
// These are ROUND APPROXIMATIONS for a handful of common foods, and they exist
// so the label, the serving-size stepper and the layout can be exercised with
// zero API keys — the same reason the demo feed has invented users in it.
//
// They are tagged `source: 'demo'`, and the UI says "sample data" when it sees
// that tag, because a number that looks like a nutrition fact and is not one is
// worse than no number. Real figures come from USDA through the
// `lookup-nutrition` function; nothing here is ever used in production.
// ---------------------------------------------------------------------------

/** Approximate, per 100 g. Demo only. */
const DEMO_PER_100G: Record<string, Per100g> = {
  chicken: { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fiber_g: 0, sugar_g: 0, sodium_mg: 74 },
  beef:    { calories: 250, protein_g: 26, carbs_g: 0, fat_g: 15, fiber_g: 0, sugar_g: 0, sodium_mg: 72 },
  egg:     { calories: 143, protein_g: 13, carbs_g: 0.7, fat_g: 9.5, fiber_g: 0, sugar_g: 0.4, sodium_mg: 142 },
  butter:  { calories: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81, fiber_g: 0, sugar_g: 0.1, sodium_mg: 11 },
  oil:     { calories: 884, protein_g: 0, carbs_g: 0, fat_g: 100, fiber_g: 0, sugar_g: 0, sodium_mg: 2 },
  flour:   { calories: 364, protein_g: 10, carbs_g: 76, fat_g: 1, fiber_g: 2.7, sugar_g: 0.3, sodium_mg: 2 },
  sugar:   { calories: 387, protein_g: 0, carbs_g: 100, fat_g: 0, fiber_g: 0, sugar_g: 100, sodium_mg: 1 },
  rice:    { calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, fiber_g: 0.4, sugar_g: 0.1, sodium_mg: 1 },
  pasta:   { calories: 131, protein_g: 5, carbs_g: 25, fat_g: 1.1, fiber_g: 1.8, sugar_g: 0.6, sodium_mg: 6 },
  cheese:  { calories: 402, protein_g: 25, carbs_g: 1.3, fat_g: 33, fiber_g: 0, sugar_g: 0.5, sodium_mg: 621 },
  milk:    { calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3, fiber_g: 0, sugar_g: 5.1, sodium_mg: 43 },
  potato:  { calories: 77, protein_g: 2, carbs_g: 17, fat_g: 0.1, fiber_g: 2.2, sugar_g: 0.8, sodium_mg: 6 },
  tomato:  { calories: 18, protein_g: 0.9, carbs_g: 3.9, fat_g: 0.2, fiber_g: 1.2, sugar_g: 2.6, sodium_mg: 5 },
  onion:   { calories: 40, protein_g: 1.1, carbs_g: 9.3, fat_g: 0.1, fiber_g: 1.7, sugar_g: 4.2, sodium_mg: 4 },
  garlic:  { calories: 149, protein_g: 6.4, carbs_g: 33, fat_g: 0.5, fiber_g: 2.1, sugar_g: 1, sodium_mg: 17 },
  salt:    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 38758 },
};

/** Rough weights for the demo path only. */
const DEMO_GRAMS: Record<string, number> = {
  clove: 3, cloves: 3, tsp: 5, teaspoon: 5, teaspoons: 5, tbsp: 14, tablespoon: 14,
  tablespoons: 14, cup: 120, cups: 120, oz: 28, ounce: 28, ounces: 28, lb: 454,
  lbs: 454, pound: 454, pounds: 454, g: 1, gram: 1, grams: 1, kg: 1000,
  pinch: 0.4, dash: 0.6, slice: 25, slices: 25, stick: 113,
};

function demoNutrition(ingredients: Ingredient[]): NutritionResult {
  const unmatched: string[] = [];
  const out = ingredients.map((ing) => {
    const item = ing.item.toLowerCase();
    const key = Object.keys(DEMO_PER_100G).find((k) => item.includes(k));
    const qty = parseFloat(ing.quantity) || 1;
    const unitWeight = DEMO_GRAMS[ing.unit.toLowerCase().trim()] ?? 100;
    const grams = Math.round(qty * unitWeight);

    if (!key) {
      unmatched.push(ing.item);
      return { ...ing, grams, fdc_id: null, nutrition: null };
    }
    const per = DEMO_PER_100G[key];
    const f = grams / 100;
    return {
      ...ing,
      grams,
      fdc_id: null,
      nutrition: {
        calories: per.calories * f, protein_g: per.protein_g * f, carbs_g: per.carbs_g * f,
        fat_g: per.fat_g * f, fiber_g: per.fiber_g * f, sugar_g: per.sugar_g * f,
        sodium_mg: per.sodium_mg * f,
      },
    };
  });
  return { ingredients: out, source: 'demo', unmatched };
}

// ---------------------------------------------------------------------------
// Demo-mode heuristic formatter. Deliberately simple; the point is to make
// the editable-recipe-card flow testable before the Anthropic key is wired in.
// ---------------------------------------------------------------------------

const UNITS =
  'cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|cloves?|cans?|sticks?|pinch(?:es)?|dash(?:es)?|slices?|stalks?|bunch(?:es)?';

const NOT_RECIPE_HINTS = [
  'restaurant', 'ordered', 'takeout', 'take-out', 'drive thru', 'drive-thru',
  'just cereal', 'leftovers from', 'ate at', 'ate out', 'delivery',
];

const FOOD_WORDS = [
  'chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'tofu', 'egg', 'eggs',
  'garlic', 'onion', 'butter', 'oil', 'olive oil', 'flour', 'sugar', 'salt',
  'pepper', 'rice', 'pasta', 'noodles', 'cheese', 'milk', 'cream', 'tomato',
  'tomatoes', 'potato', 'potatoes', 'carrot', 'carrots', 'lemon', 'lime',
  'basil', 'thyme', 'rosemary', 'paprika', 'cumin', 'soy sauce', 'honey',
  'mushroom', 'mushrooms', 'spinach', 'broccoli', 'beans', 'corn', 'bacon',
  'sausage', 'bread', 'ginger', 'chili', 'peppers', 'zucchini', 'oats',
];

const COOKING_VERBS =
  /\b(brown(?:ed)?|sear(?:ed)?|saut[ée](?:ed|d)?|roast(?:ed)?|bake(?:d)?|boil(?:ed)?|simmer(?:ed)?|fr(?:y|ied)|grill(?:ed)?|mix(?:ed)?|whisk(?:ed)?|stir(?:red)?|chop(?:ped)?|dice(?:d)?|mince(?:d)?|toss(?:ed)?|threw|throw|add(?:ed)?|marinat(?:e|ed)|season(?:ed)?|caramelize(?:d)?|reduce(?:d)?|fold(?:ed)?|knead(?:ed)?|smoke(?:d)?)\b/i;

export function heuristicFormat(blurb: string): FormattedRecipe {
  const lower = blurb.toLowerCase();
  const looksLikeRecipe =
    COOKING_VERBS.test(blurb) ||
    FOOD_WORDS.filter((w) => lower.includes(w)).length >= 2;
  const notRecipe = NOT_RECIPE_HINTS.some((h) => lower.includes(h));

  if (!looksLikeRecipe || notRecipe) {
    return { is_recipe: false, title: '', ingredients: [], steps: [], cook_time_minutes: null };
  }

  // quantities like "2 tbsp butter", "1/2 cup flour"
  const ingredients: Ingredient[] = [];
  const seen = new Set<string>();
  const qtyRe = new RegExp(
    `(\\d+(?:[\\/.]\\d+)?)\\s*(${UNITS})?\\s+(?:of\\s+)?([a-z][a-z ]{2,28}?)(?=[,.;!]|\\s+(?:and|then|until|for)\\b|$)`,
    'gi',
  );
  const TIME_WORDS = /^(min(ute)?s?|hrs?|hours?|sec(ond)?s?|days?)\b/i;
  let m: RegExpExecArray | null;
  while ((m = qtyRe.exec(blurb)) !== null && ingredients.length < 10) {
    const item = m[3].trim().toLowerCase();
    if (TIME_WORDS.test(item)) continue; // "simmered 15 min" is a time, not an ingredient
    if (!seen.has(item)) {
      seen.add(item);
      ingredients.push({ item, quantity: m[1], unit: (m[2] ?? '').toLowerCase() });
    }
  }
  // plain food-word mentions without quantities
  for (const w of FOOD_WORDS) {
    if (ingredients.length >= 10) break;
    if (lower.includes(w) && ![...seen].some((s) => s.includes(w))) {
      seen.add(w);
      ingredients.push({ item: w, quantity: '', unit: '' });
    }
  }

  // steps: split into sentences that contain a cooking verb
  const sentences = blurb
    .split(/(?<=[.!?])\s+|,\s+then\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps = sentences
    .filter((s) => COOKING_VERBS.test(s))
    .map((s) => s.replace(/^(and|then|so)\s+/i, ''))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/[.!?]*$/, '.'));

  // cook time if mentioned
  const t = blurb.match(/(\d+)\s*(?:min(?:ute)?s?|hrs?|hours?)/i);
  let cookTime: number | null = null;
  if (t) {
    cookTime = /h/i.test(t[0]) ? parseInt(t[1], 10) * 60 : parseInt(t[1], 10);
  }

  // title: main protein/dish word + style
  const main = FOOD_WORDS.find((w) => lower.includes(w));
  const title = main
    ? `${main.charAt(0).toUpperCase() + main.slice(1)} ${
        /roast/i.test(blurb) ? 'Roast' : /soup|broth/i.test(blurb) ? 'Soup' : /salad/i.test(blurb) ? 'Salad' : 'Dish'
      }`
    : 'My Recipe';

  return {
    is_recipe: true,
    title,
    ingredients,
    steps: steps.length ? steps : ['Cook it the way you described. Edit this card to add detail.'],
    cook_time_minutes: cookTime,
  };
}
