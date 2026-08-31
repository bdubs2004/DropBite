# Going live: what you actually have to hook up

The short checklist for taking NiblGo out of demo mode. Each step says what it
unlocks and how to tell it worked. [SETUP_GUIDE.md](SETUP_GUIDE.md) has the same
ground click-by-click if you want the long version.

**Only step 1 is required.** Everything after it is a feature you can turn on
later without touching the ones before it.

| # | Thing | Required? | Time | Cost at test scale |
| --- | --- | --- | --- | --- |
| 1 | Supabase (database, auth, photo storage) | **Yes** | ~20 min | Free tier |
| 2 | Anthropic key (AI recipe cards) | No | ~10 min | ~$5 credit lasts a long time |
| 3 | A real build on your phone | For notifications | ~30 min | Free |
| 4 | A domain + association files (deep links) | No | ~30 min | Cost of a domain |
| 5 | Google Places (restaurant tagging) | No — Phase 2 | — | Free tier |

---

## How the app decides it is live

One switch, in `src/config.ts`:

```ts
export const DEMO_MODE = !SUPABASE_URL || !SUPABASE_ANON_KEY;
```

No Supabase URL and key → demo mode: everything is seeded and stored on the
device. Set both → the app talks to your real backend. There is no flag to flip
and nothing to remember to turn off.

---

## 1. Supabase — required

This is the whole backend: accounts, the database, photo storage, and the
security rules. Without it the app can only run in demo mode.

1. Create a project at <https://supabase.com>. Pick a region near your users and
   keep the database password somewhere safe.
2. **SQL Editor → New query** → paste the entire contents of
   `supabase/schema.sql` → **Run**. That creates every table, all the row-level
   security policies, the notification triggers, and the public `photos` bucket
   (10 MB cap, images only).
3. **Settings → API** → copy the **Project URL** and the **anon public** key.
4. Copy `.env.example` to `.env` and fill in:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   ```

   **Mind the prefix.** Supabase labels these `NEXT_PUBLIC_*` in its dashboard
   because it assumes Next.js. Expo only exposes `EXPO_PUBLIC_*` to the app, so
   pasting the dashboard's names verbatim leaves you in demo mode with nothing
   explaining why. Either key format works: the legacy JWT (`eyJ...`) or the
   newer `sb_publishable_...`.

5. Restart with `npx expo start --clear`.

**Verify:** paste `supabase/verify.sql` into the SQL Editor and run it. Every
row should say OK; anything else names the file that fixes it. Then check the
app: the sign-in screen no longer says "Demo mode: everything is stored on this
device." Create an account, post a photo, and confirm the row in **Table Editor
→ posts** and the image in **Storage → photos**.

> **`ERROR: 42710: type "meal_slot" already exists`?** You already ran some of
> the schema. Nothing is broken — `schema.sql` is safe to run repeatedly, so
> just run it again and it will fill in what is missing and leave your data
> alone. (If you are on a copy of the file from before this was fixed, pull the
> latest first.) Then run `verify.sql`. To start genuinely clean instead, run
> `supabase/reset.sql` — it deletes every account, post and photo, so only use
> it on a project you are still setting up.

> The anon key is *meant* to be public; it is baked into the app bundle. All the
> real protection is in the RLS policies. Never put the `service_role` key in
> `.env` or anywhere in the app. See [SECURITY.md](SECURITY.md).

> **Turn email confirmation off while testing** — Authentication → Providers →
> Email → disable "Confirm email". With it on, `signUp` returns a user but no
> session, so the profile row the app writes immediately afterwards is rejected
> by RLS (`auth.uid()` is null) and sign-up fails. Turning it back on for launch
> needs the app to handle the confirm-then-create flow, which is not built yet.

### If your database already exists

Don't re-run `schema.sql` — run whatever migrations came after it, in order,
from `supabase/migrations/`:

| File | What it adds |
| --- | --- |
| `0002_reports.sql` | Content reports (see [MODERATION.md](MODERATION.md)) |
| `0003_comment_reactions.sql` | Likes on comments |
| `0004_direct_messages.sql` | DMs |
| `0005_blocks.sql` | User blocking |
| `0006_security_hardening.sql` | Tightened policies and input limits |
| `0007_message_images.sql` | Photo attachments in DMs |
| `0008_dm_follow_and_reports.sql` | Follow-gated DMs, reportable messages |
| `0009_notifications.sql` | In-app notifications for post interactions |

They are all safe to run twice, and so is `schema.sql` itself. What re-running
`schema.sql` will **not** do is add a column to a table that already exists —
`create table if not exists` skips the whole table. That is what the migrations
are for, and what `verify.sql` checks for you.

---

## 2. Anthropic — AI recipe cards

Skip this and the app works fine; the recipe card just doesn't appear, and posts
show the blurb alone.

**The key never goes in the app.** It lives as a Supabase Edge Function secret,
because anything in `.env` ships inside the app bundle where anyone can read it.

1. Get a key at <https://console.anthropic.com> and add ~$5 of credit. Formatting
   a recipe on Haiku costs a fraction of a cent.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
   supabase functions deploy format-recipe
   supabase functions deploy delete-account
   ```

`delete-account` is separate but deploy it too — Settings → Delete account needs
it, and account deletion has to actually work.

**Optional secrets, both worth setting before launch:**

```bash
supabase secrets set AI_DAILY_LIMIT=40                 # AI calls per user per day (default 40)
supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com
```

**Verify:** write a post with a real recipe blurb ("chicken thighs with garlic,
20 min") and tap format. You should get an editable card. Supabase → Edge
Functions → format-recipe → Logs shows the call.

Model and prompt live in `src/config.ts` (`AI_CONFIG`), mirrored in
`supabase/functions/format-recipe/index.ts`. Change them in both.

---

## 3. A real build — needed for mealtime notifications

Mealtime reminders are **local** notifications, scheduled on the device. That
means **no push service, no FCM or APNs keys, no server** — and they fire in
whatever timezone the phone is in, which is what you want when someone travels.

What you do need is a build that isn't Expo Go, since Expo Go's notification
support is limited (notably on Android from SDK 53 on). A development build is
enough to test:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --profile development --platform ios     # or android
```

**Verify:** Settings → set a reminder a few minutes out → lock the phone → wait.
One notification per meal. If you get two, that was the bug fixed in
`src/lib/mealReminderPlan.ts`; make sure you're on a build that includes it, and
the next sync cleans up the leftovers.

---

## 4. Deep links — optional

`niblgo://post/<id>` already opens the installed app with no setup at all.

For `https://yourdomain.com/post/<id>` links to open the app instead of a
browser, you need a domain you control, serving two files: Apple's
`apple-app-site-association` and Android's `assetlinks.json`. Both must be at
fixed paths over https. Set `EXPO_PUBLIC_APP_LINK_BASE` to that domain.

Full walkthrough in SETUP_GUIDE.md § B4. Until then, https links open the web
build, which resolves to the right screen anyway — the same linking config drives
both.

---

## 5. Google Places — Phase 2, deliberately off

Restaurant / "where you ate" tagging is built but gated behind
`LOCATION_TAGGING_ENABLED` in `src/config.ts`, so you can launch without it. To
turn it on later: flip that flag to `true`, enable "Places API (New)" in Google
Cloud, and set `EXPO_PUBLIC_GOOGLE_PLACES_KEY`. No other code changes.

---

## Before real people use it

- [ ] Email confirmation back **on** in Supabase (Authentication → Providers → Email)
- [ ] `service_role` key is nowhere in the repo or `.env` — only in edge-function secrets
- [ ] `.env` is gitignored (it is) and was never committed
- [ ] `ALLOWED_ORIGINS` set, so your functions aren't callable from anywhere
- [ ] `AI_DAILY_LIMIT` set, so one user can't burn your Anthropic credit
- [ ] You can work a report: [MODERATION.md](MODERATION.md) — App Store review asks about this
- [ ] Account deletion works end to end (Settings → Delete account, with `delete-account` deployed)
- [ ] **Wire up data export** — see Known gaps below
- [ ] Run the checks: `npm run typecheck` and `npm run test:reminders`
- [ ] `supabase/verify.sql` reports OK on every row
- [ ] Run the RLS tests against a scratch database: `supabase/tests/README.md`

## Known gaps

One thing is built but not reachable, and it matters for launch:

**Data export has no button.** `exportMyData()` is implemented in both services
and returns the user's profile, posts, follows, reactions and streak as JSON —
but nothing in Settings calls it. CLAUDE.md lists working data export as an MVP
requirement, and data portability is a legal obligation in the EU (GDPR art. 20)
and California (CCPA). Account *deletion* is wired up and works; only export is
missing. It needs a button in the Settings account section that calls
`svc.exportMyData()` and hands the result to the share sheet — small, but do it
before you take real users.

## Sanity checks you can run right now

```bash
npm run typecheck        # TypeScript, strict mode
npm run test:reminders   # mealtime reminder scheduling
```

And against your database, in the Supabase SQL Editor:

```
supabase/verify.sql      # 40 checks: tables, RLS, policy counts, functions,
                         # triggers, columns, and the photo bucket's limits
```

The database security tests in `supabase/tests/` need a throwaway Postgres; the
README there explains the harness. They are worth running before launch — they
cover the rules that stop one user reading another's DMs, notifications, or
private follower list.
