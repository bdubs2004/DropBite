/**
 * Central config. All external services read their keys from EXPO_PUBLIC_*
 * env vars (set them in a .env file; see .env.example / SETUP_GUIDE.md).
 *
 * When Supabase env vars are missing the app runs in DEMO MODE:
 * a fully local, seeded experience backed by AsyncStorage so you can
 * test the whole product loop with zero API keys.
 */

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const GOOGLE_PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ?? '';

export const DEMO_MODE = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/**
 * AI recipe formatting model + prompt live here so cost/quality tuning is
 * one edit (CLAUDE.md: "Keep prompts and model choice in one config module").
 * The real call happens server-side in the Supabase Edge Function
 * (supabase/functions/format-recipe). Never put an Anthropic key in the app.
 */
export const AI_CONFIG = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 1024,
  systemPrompt: [
    'You turn a casual home-cook blurb into a structured recipe.',
    'Return STRICT JSON only, no prose, matching:',
    '{"is_recipe": boolean, "title": string, "ingredients": [{"item": string, "quantity": string, "unit": string}], "steps": [string], "cook_time_minutes": number | null}',
    'If the blurb clearly is not a cooking description (restaurant meal, "just cereal lol"), set is_recipe=false and leave the rest minimal.',
    "Never invent ingredients that aren't implied. Quantities may be empty strings when unknown.",
  ].join(' '),
};
