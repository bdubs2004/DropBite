import { NutritionSource } from './nutrition';
import { LIMITS } from './limits';
import { Ingredient, Recipe } from '../types';

/**
 * A recipe card read from the server, made safe to draw.
 *
 * Every viewer draws a post's card, and React Native crashes on an object
 * where text belongs. The database refuses malformed cards (migration 0034),
 * but cards saved before that, or by an old build, are drawn through this, so
 * one bad card can never take down someone else's feed. Anything that isn't
 * the documented shape is dropped or turned into text; numbers that aren't
 * sensible become "unknown".
 */
export function cleanRecipe(raw: unknown): Recipe | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const num = (v: unknown, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;

  const ingredients: Ingredient[] = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && !Array.isArray(i))
    .map((i) => ({
      item: text(i.item, LIMITS.ingredientItem),
      quantity: text(i.quantity, LIMITS.ingredientQuantity),
      unit: text(i.unit, LIMITS.ingredientQuantity),
      grams: num(i.grams, 20000),
      fdc_id: num(i.fdc_id, Number.MAX_SAFE_INTEGER),
      nutrition: cleanNutrition(i.nutrition),
    }))
    .filter((i) => i.item.trim().length > 0)
    .slice(0, LIMITS.recipeItems);

  const steps = (Array.isArray(r.steps) ? r.steps : [])
    .map((s) => text(s, LIMITS.recipeStep))
    .filter((s) => s.trim().length > 0)
    .slice(0, LIMITS.recipeItems);

  const servings = num(r.servings, 100);
  const source = r.nutrition_source;
  return {
    id: text(r.id, 64),
    post_id: text(r.post_id, 64),
    title: text(r.title, LIMITS.recipeTitle) || 'My Recipe',
    ingredients,
    steps,
    cook_time_minutes: num(r.cook_time_minutes, 6000) !== null ? Math.round(r.cook_time_minutes as number) : null,
    ai_generated: r.ai_generated === true,
    user_edited: r.user_edited === true,
    servings: servings !== null && servings >= 1 ? Math.floor(servings) : 1,
    nutrition: cleanNutrition(r.nutrition),
    nutrition_source:
      source === 'usda' || source === 'estimated' || source === 'demo' ? (source as NutritionSource) : null,
  };
}

const NUTRIENTS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'] as const;

/** Nutrition totals: the seven numbers, each non-negative and finite, or nothing at all. */
export function cleanNutrition(v: unknown): Recipe['nutrition'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out = {} as NonNullable<Recipe['nutrition']>;
  let any = false;
  for (const k of NUTRIENTS) {
    const n = o[k];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e8) {
      out[k] = n;
      any = true;
    } else {
      out[k] = 0;
    }
  }
  return any ? out : null;
}
