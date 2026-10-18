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
 * The custom scheme (niblgo://post/<id>) always opens the installed app and
 * needs no domain setup, so it is what we fall back to.
 */
export const APP_LINK_BASE =
  process.env.EXPO_PUBLIC_APP_LINK_BASE ?? 'https://niblgo.com';

/**
 * Where the privacy policy and terms are hosted.
 *
 * Both must be public pages: Apple and Google load them during review, and the
 * sign-up screen links them so a user can read what they are agreeing to before
 * they agree. Source text lives in `legal/` — publish it and keep these in
 * sync. Override per environment with EXPO_PUBLIC_APP_LINK_BASE.
 */
export const PRIVACY_URL = `${APP_LINK_BASE}/privacy`;

/**
 * Where an invite sends people to get the app: TestFlight during the beta.
 * Swap in the App Store link at launch (and DOWNLOAD_URL in
 * scripts/post-preview-worker.js, which the website's "Get NiblGo" uses).
 */
export const GET_APP_URL = 'https://testflight.apple.com/join/J94Q9uXw';
export const TERMS_URL = `${APP_LINK_BASE}/terms`;

/**
 * Where Supabase sends people after they click the email-confirmation link.
 *
 * This is a real web page (hosted on the marketing site) that completes the
 * verification and offers a button back into the app. Without it Supabase
 * falls back to the project's Site URL, which dumps confirmed users on the
 * homepage. Passed as `emailRedirectTo` on sign-up and resend.
 */
export const EMAIL_CONFIRM_URL = `${APP_LINK_BASE}/auth/confirm`;

/**
 * Where a password-reset link sends people: a page on the website that hands a
 * session on to the app (niblgo://reset#…), where the new password is set
 * (setSession → updateUser). With the reset email template in
 * supabase/templates/, the link carries only a code (after the #, so it never
 * reaches the web server), and the page swaps it for the session when the
 * person taps its button: an email scanner opening the link first can't use
 * the reset up. Supabase ignores this redirect when that template is in use;
 * it still matters for the default template.
 *
 * Going through a web page rather than straight to niblgo:// is what makes it
 * dependable: an email app's built-in browser often won't follow a redirect to
 * an app link on its own, but always will when the person taps a button, and
 * on a computer the page can say to open the email on the phone instead.
 * Builds before this one asked for niblgo://reset directly; the app still
 * handles both.
 */
export const PASSWORD_RESET_URL = `${APP_LINK_BASE}/auth/reset`;

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
  model: 'claude-haiku-4-5',
  maxTokens: 1024,
  systemPrompt: [
    'You turn a casual description of a meal into a structured recipe card.',
    'Return STRICT JSON only, no prose, matching:',
    '{"is_recipe": boolean, "title": string, "ingredients": [{"item": string, "quantity": string, "unit": string}], "steps": [string], "cook_time_minutes": number | null}',
    'The person tapped "Format recipe", so always give them a recipe card.',
    'Every description of food gets one: a home-cooked dish gets that dish; just a dish',
    'name ("chicken alfredo", "banana bread") gets a sensible standard version with its',
    'usual ingredients, quantities and clear steps; store-bought, frozen or restaurant',
    'food gets the simplest way to make or put it together at home (frozen chicken',
    'strips tossed in a bottled wing sauce: bake the strips, warm the sauce, toss),',
    'keeping brand names as ingredients when that is what they used; even something',
    'simple ("cereal", "a sandwich") gets a short assembly recipe.',
    'Set is_recipe=true for all of these. Only set is_recipe=false when the text names',
    'no food or drink at all.',
    'Stay close to the blurb when it spells out ingredients/steps; only fill in a',
    'typical version when it is just a dish name. Quantities may be empty when unknown.',
  ].join(' '),
};
