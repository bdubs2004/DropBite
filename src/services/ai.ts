import { DEMO_MODE } from '../config';
import { LIMITS } from '../lib/limits';
import { Ingredient } from '../types';
import { getSupabase } from './supabase/client';

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
