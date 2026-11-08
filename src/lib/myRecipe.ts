import { LIMITS } from './limits';
import { cleanRecipe } from './recipeData';
import { Ingredient, MyRecipe, MyRecipeInput } from '../types';

/**
 * A saved recipe as the app gets it back: never trust its shape (a family
 * member's card is drawn on your screen too). Same cleaning as a post's card.
 */
export function cleanMyRecipe(raw: unknown): MyRecipe | null {
  const r = cleanRecipe(raw);
  if (!r) return null;
  const o = raw as Record<string, unknown>;
  return {
    id: r.id,
    user_id: typeof o.user_id === 'string' ? o.user_id : '',
    title: r.title,
    ingredients: r.ingredients.map(({ item, quantity, unit }) => ({ item, quantity, unit })),
    steps: r.steps,
    cook_time_minutes: r.cook_time_minutes,
    ai_generated: r.ai_generated,
    user_edited: r.user_edited,
    created_at: typeof o.created_at === 'string' ? o.created_at : '',
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : '',
  };
}

/**
 * A card from the editor, ready to save: empty ingredient and step rows
 * dropped, everything trimmed and kept within the database's limits, and a
 * title (falling back to the meal's name) so it's never blank.
 */
export function tidyRecipe(
  card: { title: string; ingredients: Ingredient[]; steps: string[]; cook_time_minutes: number | null },
  fallbackTitle: string,
): Pick<MyRecipeInput, 'title' | 'ingredients' | 'steps' | 'cook_time_minutes'> {
  const title = (card.title.trim() || fallbackTitle.trim() || 'My recipe').slice(0, LIMITS.recipeTitle);
  return {
    title,
    ingredients: card.ingredients
      .map((i) => ({
        item: i.item.trim().slice(0, LIMITS.ingredientItem),
        quantity: String(i.quantity ?? '').trim().slice(0, LIMITS.ingredientQuantity),
        unit: String(i.unit ?? '').trim().slice(0, LIMITS.ingredientQuantity),
      }))
      .filter((i) => i.item.length > 0)
      .slice(0, LIMITS.recipeItems),
    steps: card.steps
      .map((s) => s.trim().slice(0, LIMITS.recipeStep))
      .filter((s) => s.length > 0)
      .slice(0, LIMITS.recipeItems),
    cook_time_minutes:
      card.cook_time_minutes != null && card.cook_time_minutes >= 0
        ? Math.min(Math.round(card.cook_time_minutes), 6000)
        : null,
  };
}

/** "5 ingredients · 30 min". */
export function recipeSummary(r: { ingredients: unknown[]; cook_time_minutes: number | null }): string {
  const parts: string[] = [];
  if (r.ingredients.length) parts.push(r.ingredients.length === 1 ? '1 ingredient' : `${r.ingredients.length} ingredients`);
  if (r.cook_time_minutes) parts.push(`${r.cook_time_minutes} min`);
  return parts.join(' · ');
}
