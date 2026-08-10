/**
 * Input bounds, in one place.
 *
 * These mirror the CHECK constraints in supabase/schema.sql. The database is
 * the authority — a scripted client can skip anything done here — so these
 * exist to cap fields as the user types and give a friendly message instead of
 * surfacing a raw constraint violation. Keep the two in sync.
 */
export const LIMITS = {
  displayName: 50,
  handle: 30,
  bio: 300,
  blurb: 2000,
  comment: 2000,
  message: 2000,
  restaurantName: 200,
  recipeTitle: 120,
  /** Max ingredients, and max steps, on one recipe card. */
  recipeItems: 50,
  /** Minimum password length. Raise Supabase's own minimum to match under
   *  Authentication > Providers > Email. */
  passwordMin: 8,
} as const;

/** Trim and hard-cap a string. */
export function clamp(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

/** Same as clamp, but empty input becomes null (for nullable columns). */
export function clampOrNull(value: string | null | undefined, max: number): string | null {
  const out = clamp(value, max);
  return out.length > 0 ? out : null;
}
