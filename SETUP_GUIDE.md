# nibl Launch & Wiring Guide

Two parts:

- **Part A: run the test app** on your phone or laptop (5 minutes, zero API keys)
- **Part B: plug in the APIs** so every feature runs for real (Supabase, then Anthropic, Google Places, and push)

---

## Part A: Run the test app (demo mode, no keys)

Demo mode is automatic whenever Supabase env vars are missing. You get a seeded feed
(5 fake users, ~10 posts), local sign-up, AI-card formatting via a built-in parser,
and a demo restaurant list. Everything is stored on the device.

### A1. Prerequisites (laptop)

1. Install **Node.js 20+** from <https://nodejs.org> (LTS is fine).
2. Clone/download this repo, then in a terminal:

   ```bash
   cd DropBite
   npm install
   ```

### A2. On your phone (recommended, since this is a mobile app)

1. Install **Expo Go** from the App Store (iPhone) or Play Store (Android).
2. Make sure your phone and laptop are on the **same Wi-Fi network**.
3. In the project folder run:

   ```bash
   npx expo start
   ```

4. A QR code appears in the terminal.
   - **iPhone:** open the Camera app, point at the QR code, tap the banner.
   - **Android:** open Expo Go, tap "Scan QR code".
5. The app loads on your phone. Create an account (any email/password; demo mode
   stores it locally), and you'll land in a live feed.

   > Same Wi-Fi not working (dorm/office networks often block it)? Run
   > `npx expo start --tunnel` instead, which routes over the internet.

### A3. On your laptop (browser)

```bash
npm run web
```

Opens at <http://localhost:8081>. Tip: press F12 → toggle the device toolbar and pick
"iPhone 14 Pro" so you see it at phone proportions. Camera/notifications are limited on
web, so use the placeholder photo chips in the compose screen when testing there.

### A4. What to test (the core loop)

1. Sign up. The feed is already full (you auto-follow the seed users).
2. Tap **+**, pick a photo (or a placeholder chip), confirm the meal slot (pre-selected
   by time of day), and write a description like *"browned chicken thighs with 3 cloves
   garlic and 2 tbsp butter, simmered 15 min"*.
3. Tap **Format as recipe card**, fix any field inline (that's the point), tag a
   restaurant, then tap **Post**.
4. Your post appears at the top of the feed and your streak increments.
5. Check Profile (stats, streaks, your posts) and Settings (notification toggles,
   data export, account deletion; both really work).

---

## Part B: Plug in the APIs (go live)

Order matters: Supabase first (it's the backbone), then Anthropic, then Places, then push.

### B1. Supabase: auth, database, photo storage (about 20 min, free tier)

1. Create a project at <https://supabase.com> (choose a region near your users;
   remember your database password).
2. **Create the schema:** in the dashboard, SQL Editor → New query → paste the entire
   contents of `supabase/schema.sql` → Run. This creates all tables (users, follows,
   posts, recipes, reactions, streaks), row-level security, and the public `photos`
   storage bucket.
3. **Turn off email confirmation for testing** (optional): Authentication → Providers
   → Email → disable "Confirm email". Re-enable before public launch.
4. **Get your keys:** Settings → API. Copy the **Project URL** and the **anon public**
   key.
5. In the project folder:

   ```bash
   cp .env.example .env
   ```

   Fill in:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

6. Restart the dev server (`npx expo start --clear`). Demo mode switches off
   automatically; sign-ups now create real Supabase users, photos upload to storage,
   and the feed reads from Postgres.

> The anon key is designed to be public; security comes from the RLS policies in
> `schema.sql`. Never put the `service_role` key in the app.

### B2. Anthropic: real AI recipe cards (about 10 min)

The Anthropic key lives **server-side only**, in a Supabase Edge Function the app calls.

1. Get an API key at <https://console.anthropic.com> (Settings → API keys). Add ~$5
   prepaid credit; recipe formatting on Claude Haiku costs a fraction of a cent per post.
2. Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF   # ref is in your project URL
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
   supabase functions deploy format-recipe
   supabase functions deploy delete-account
   ```

3. That's it, no app change needed. With Supabase configured, `src/services/ai.ts`
   already calls the `format-recipe` function. (Model + prompt are configured in
   `supabase/functions/format-recipe/index.ts`, mirrored in `src/config.ts`.)

   `delete-account` is the same deal for Settings → Delete account (auth deletion
   needs a server-side key).

### B3. Google Places: real restaurant search (about 10 min)

1. Go to <https://console.cloud.google.com>, create a project.
2. APIs & Services → Library → enable **Places API (New)**.
3. Credentials → Create credentials → API key. Restrict it to the Places API.
   (Billing account required; there's a recurring monthly free allowance that easily
   covers testing.)
4. Add to `.env`:

   ```
   EXPO_PUBLIC_GOOGLE_PLACES_KEY=AIza...
   ```

5. Restart the dev server. The compose screen's restaurant search now hits Google
   live (`src/services/places.ts`).

### B4. Push notifications

Mealtime reminders are **local scheduled notifications**. They already work in Expo Go
on Android, and in any development/production build on both platforms, with no server:
the app schedules daily 8:00 / 12:00 / 18:00 notifications in the phone's own timezone,
and the Settings toggles control each slot.

Notes:

- iOS + Expo Go has limited notification support; for full fidelity make a dev build
  (below); no code changes needed.
- Nothing to configure unless you later want *remote* pushes (e.g. "your friend
  posted dinner"), which is Phase 2 territory (Expo Push + a server trigger).

### B5. Put it on your phone permanently (no laptop needed)

Expo Go is for development. For a standalone installable app:

```bash
npm install -g eas-cli
eas login                      # free Expo account
eas build:configure
eas build --profile preview --platform android   # installable .apk link
eas build --profile preview --platform ios       # needs Apple Developer ($99/yr)
```

EAS builds in the cloud and gives you a link/QR to install the real app. For App
Store / Play Store submission later: `eas submit`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Phone can't connect to dev server | `npx expo start --tunnel` |
| "Demo mode" still showing after adding .env | Restart with `npx expo start --clear`; env vars only load at bundle time |
| Sign-up succeeds but no profile | Did you run **all** of `supabase/schema.sql`? Check Table Editor → users |
| Photos don't upload | Confirm the `photos` bucket exists (schema.sql creates it) and is public |
| Recipe card button does nothing | Blurb must be ≥ 12 characters; if it's clearly not cooking ("ate at Chipotle") the app intentionally skips the card |
| AI formatting fails in production | Check `supabase functions logs format-recipe`; usually a missing or mistyped `ANTHROPIC_API_KEY` secret |
| Restaurant search returns nothing | Key restricted to the wrong API. Enable **Places API (New)**, not the legacy one |

## Cost cheat-sheet (at test scale)

| Service | Cost |
| --- | --- |
| Supabase | Free tier covers MVP testing comfortably |
| Anthropic (Claude Haiku) | ~$2 per 1,000 recipe formats, prepaid |
| Google Places | Monthly free allowance covers testing |
| Expo / EAS | Free tier fine for dev builds |
| Apple Developer | $99/yr (only when you want iOS installs/TestFlight) |
| Google Play | $25 one-time (only for Play Store) |
