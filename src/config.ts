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
 * Base URL used when sharing a link out of the app.
 *
 * For a shared link to OPEN THE APP rather than a browser, this domain must
 * serve the platform association files (Apple App Site Association for iOS,
 * assetlinks.json for Android) — see SETUP_GUIDE.md. Until that is live, an
 * https link opens the web build instead, which still resolves to the right
 * screen because the same linking config drives web routes.
 *
 * The custom scheme (nibl://post/<id>) always opens the installed app and
 * needs no domain setup, so it is what we fall back to.
 */
export const APP_LINK_BASE =
  process.env.EXPO_PUBLIC_APP_LINK_BASE ?? 'https://nibl.app';

/**
 * Location / restaurant tagging ("where you ate", Google Places-backed).
 *
 * DEFERRED to Phase 2. We're launching the core loop (photo → blurb → post →
 * feed) first and want proof people use the base features before layering on
 * venue tagging. The data model, services (`src/services/places.ts`), and UI
 * are all still wired up — they're just hidden behind this flag. To bring the
 * feature back, flip this to `true` (and set EXPO_PUBLIC_GOOGLE_PLACES_KEY for
 * live search; the demo list works without a key). No other code changes
 * needed. Search the codebase for LOCATION_TAGGING_ENABLED to find every spot.
 */
export const LOCATION_TAGGING_ENABLED: boolean = false;

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
