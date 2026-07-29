# nibl Launch & Wiring Guide (VS Code)

Everything in this guide happens inside **Visual Studio Code**: you'll clone the
project, run commands in VS Code's built-in terminal, and edit config files in the
editor. Two parts:

- **Part A: run the test app** on your phone or laptop (about 10 minutes, zero API keys)
- **Part B: plug in the APIs** so every feature runs for real (Supabase, then Anthropic, and push; Google Places is deferred to Phase 2)

---

## Part A: Run the test app (demo mode, no keys)

Demo mode is automatic whenever Supabase env vars are missing. You get a seeded feed
(5 fake users, ~10 posts), local sign-up, and AI-card formatting via a built-in parser.
Everything is stored on the device.

> **Note:** Location / restaurant tagging ("where you ate") is turned **off** for the
> MVP — we're validating the core photo → blurb → post loop first. It's a one-line
> re-enable later (`LOCATION_TAGGING_ENABLED` in `src/config.ts`). See B3 below.

### A1. Install the tools (one time)

1. **VS Code:** <https://code.visualstudio.com> (download, install, open it).
2. **Node.js 20+ (LTS):** <https://nodejs.org>. Use the default installer options.
3. **Git:** <https://git-scm.com/downloads> (on Mac, VS Code will offer to install
   it for you the first time you need it).

> If VS Code was already open while you installed Node or Git, fully quit and
> reopen it so the new tools are picked up.

### A2. Get the project into VS Code

1. Open VS Code.
2. Press `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) to open the Command Palette, type
   **Git: Clone**, and press Enter.
3. Paste the repository URL:

   ```
   https://github.com/bdubs2004/DropBite.git
   ```

   Pick a folder to clone into (Documents is fine). VS Code may ask you to sign in
   to GitHub; use the browser sign-in it offers.
4. When cloning finishes, click **Open** in the popup (and **Yes, I trust the
   authors** if asked).
5. Important: the app currently lives on the build branch. Click the branch name in
   the **bottom-left corner** of the VS Code window (it says `main` or similar),
   then pick **`claude/app-build-test-launch-sypabw`** from the list that appears
   at the top. The file Explorer on the left should now show folders like `src/`,
   `assets/`, and `supabase/`.

### A3. Install dependencies (VS Code terminal)

1. Open the integrated terminal: **View → Terminal**, or press `` Ctrl+` ``
   (the backtick key, above Tab).
2. The terminal opens already inside the project folder. Run:

   ```bash
   npm install
   ```

   This takes a few minutes the first time. You only do it once.

### A4. Run it on your phone (recommended, since this is a mobile app)

1. On your phone, install **Expo Go** from the App Store (iPhone) or Play Store
   (Android).
2. Make sure your phone and computer are on the **same Wi-Fi network**.
3. In the VS Code terminal, run:

   ```bash
   npx expo start
   ```

4. A QR code appears right in the terminal panel.
   - **iPhone:** open the Camera app, point it at the QR code on your screen, tap
     the banner that pops up.
   - **Android:** open Expo Go and tap "Scan QR code".
5. The app loads on your phone. Create an account (any email/password; demo mode
   stores it locally) and you'll land in a live feed.

Terminal basics while the server runs:

- Leave the terminal open; the app hot-reloads on your phone whenever you save a
  file in VS Code.
- Stop the server with `Ctrl+C` in the terminal.
- Need a second terminal while the server runs? Click the **+** in the terminal
  panel's top-right corner.

> Same Wi-Fi not working (dorm/office networks often block it)? Stop the server
> (`Ctrl+C`) and run `npx expo start --tunnel` instead, which routes over the
> internet.

### A5. Or run it in your browser

In the VS Code terminal:

```bash
npm run web
```

Then open <http://localhost:8081> (VS Code usually shows a clickable link in the
terminal, or offers to open it for you). Tip: press F12 in the browser → toggle the
device toolbar → pick "iPhone 14 Pro" so you see it at phone proportions. On web the
Camera tile is limited, so use the Library tile to pick an image file; notifications
are mobile-only.

### A6. What to test (the core loop)

1. Sign up. The feed is already full (you auto-follow the seed users).
2. Tap **+**, pick a photo with Camera or Library, confirm the meal slot (pre-selected
   by time of day), and write a description like *"browned chicken thighs with 3 cloves
   garlic and 2 tbsp butter, simmered 15 min"*.
3. Tap **Format as recipe card**, fix any field inline (that's the point), then tap
   **Share post**. (Restaurant tagging is off for the MVP — see the note above.)
4. Your post appears at the top of the feed and your streak increments.
5. Check Profile (stats, streaks, your posts) and Settings (notification toggles,
   data export, account deletion; both really work).

---

## Part B: Plug in the APIs (go live)

Order matters: Supabase first (it's the backbone), then Anthropic, then push.
Google Places (B3) is deferred to Phase 2 and not needed to launch. All terminal
commands below go in the VS Code terminal, and all file edits happen in the VS Code
editor.

### B1. Supabase: auth, database, photo storage (about 20 min, free tier)

1. Create a project at <https://supabase.com> (choose a region near your users;
   remember your database password).
2. **Create the schema:** in VS Code's Explorer, open `supabase/schema.sql`, select
   everything (`Ctrl+A`), and copy it. Then in the Supabase dashboard go to
   **SQL Editor → New query**, paste, and click **Run**. This creates all tables
   (users, follows, posts, recipes, reactions, streaks), row-level security, and
   the public `photos` storage bucket.
3. **Turn off email confirmation for testing** (optional): Authentication → Providers
   → Email → disable "Confirm email". Re-enable before public launch.
4. **Get your keys:** Settings → API. Copy the **Project URL** and the **anon public**
   key.
5. **Create your .env file in VS Code:** in the Explorer, right-click
   `.env.example` → **Copy**, then right-click empty space → **Paste**, and rename
   the copy to `.env` (right-click → Rename). Open `.env` and fill in:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

   Save with `Ctrl+S`. (`.env` is gitignored, so your keys never get committed.)
6. Restart the dev server: in the terminal press `Ctrl+C`, then run
   `npx expo start --clear`. Demo mode switches off automatically; sign-ups now
   create real Supabase users, photos upload to storage, and the feed reads from
   Postgres.

> The anon key is designed to be public; security comes from the RLS policies in
> `schema.sql`. Never put the `service_role` key in the app.

### B2. Anthropic: real AI recipe cards (about 10 min)

The Anthropic key lives **server-side only**, in a Supabase Edge Function the app
calls; it never goes in `.env` or the app.

1. Get an API key at <https://console.anthropic.com> (Settings → API keys). Add ~$5
   prepaid credit; recipe formatting on Claude Haiku costs a fraction of a cent per
   post.
2. Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then run these
   in the VS Code terminal, one at a time:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF   # ref is in your project URL
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
   supabase functions deploy format-recipe
   supabase functions deploy delete-account
   ```

3. That's it, no app change needed. With Supabase configured, `src/services/ai.ts`
   already calls the `format-recipe` function. If you want to tune the AI later,
   the model and prompt are in `supabase/functions/format-recipe/index.ts`
   (mirrored in `src/config.ts`); open them right in VS Code.

   `delete-account` is the same deal for Settings → Delete account (auth deletion
   needs a server-side key).

### B3. Google Places: real restaurant search — DEFERRED to Phase 2

Location / restaurant tagging is **off** for the MVP, so you can skip this section
entirely at launch. We're shipping the core loop first and adding "where you ate"
tagging once people are using the base features. Everything for it is already built
and just gated behind `LOCATION_TAGGING_ENABLED` in `src/config.ts`.

When you're ready to turn it on:

1. Set `LOCATION_TAGGING_ENABLED = true` in `src/config.ts`. That alone restores the
   **Tags** step in compose and the restaurant tag on posts (with a built-in demo
   list, no key needed).
2. For live search instead of the demo list, add a Google Places key:
   - Go to <https://console.cloud.google.com>, create a project.
   - APIs & Services → Library → enable **Places API (New)**.
   - Credentials → Create credentials → API key. Restrict it to the Places API.
     (Billing account required; a recurring monthly free allowance covers testing.)
   - Open `.env` in VS Code and add `EXPO_PUBLIC_GOOGLE_PLACES_KEY=AIza...`, save.
3. Restart the dev server (`Ctrl+C`, then `npx expo start --clear`). The compose
   screen's restaurant search now hits Google live (`src/services/places.ts`).

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

Expo Go is for development. For a standalone installable app, run these in the VS
Code terminal:

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

## Handy VS Code extras (optional)

- **Source Control view** (branch icon in the left sidebar): see your changes and
  commit without ever leaving VS Code.
- **Extensions worth adding** (square icon in the sidebar): *Expo Tools* (autocomplete
  for app.json) and *Prettier* (auto-formatting on save).
- **Quick file open:** `Ctrl+P`, then type a filename like `theme.ts`.
- **Project-wide search:** `Ctrl+Shift+F` (e.g. search "AI_CONFIG" to find the AI
  settings).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Terminal says `npm` or `git` is not recognized | Node/Git finished installing after VS Code opened. Fully quit VS Code and reopen it |
| Phone can't connect to dev server | Stop with `Ctrl+C`, run `npx expo start --tunnel` |
| "Demo mode" still showing after adding .env | Restart with `npx expo start --clear`; env vars only load at bundle time |
| Wrong files in the Explorer / app looks old | Check the branch name in the bottom-left corner is `claude/app-build-test-launch-sypabw` |
| Sign-up succeeds but no profile | Did you run **all** of `supabase/schema.sql`? Check Table Editor → users |
| Photos don't upload | Confirm the `photos` bucket exists (schema.sql creates it) and is public |
| Recipe card button does nothing | Blurb must be ≥ 12 characters; if it's clearly not cooking ("ate at Chipotle") the app intentionally skips the card |
| AI formatting fails in production | Check `supabase functions logs format-recipe`; usually a missing or mistyped `ANTHROPIC_API_KEY` secret |
| No **Tags** step in compose / no restaurant on posts | Expected — location tagging is deferred (`LOCATION_TAGGING_ENABLED = false` in `src/config.ts`) |
| Restaurant search returns nothing (after re-enabling) | Key restricted to the wrong API. Enable **Places API (New)**, not the legacy one |

## Cost cheat-sheet (at test scale)

| Service | Cost |
| --- | --- |
| Supabase | Free tier covers MVP testing comfortably |
| Anthropic (Claude Haiku) | ~$2 per 1,000 recipe formats, prepaid |
| Google Places | Deferred to Phase 2; monthly free allowance covers testing when enabled |
| Expo / EAS | Free tier fine for dev builds |
| Apple Developer | $99/yr (only when you want iOS installs/TestFlight) |
| Google Play | $25 one-time (only for Play Store) |
