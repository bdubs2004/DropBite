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

> **Email confirmation can stay ON.** The app handles it: sign-up stores the
> handle and display name in the auth user's metadata and shows a "check your
> email" screen, and the profile row is created on the first sign-in after the
> link is clicked (`ensureProfile`). Using metadata rather than local state
> matters because people often confirm on a different device. Leave it on for
> launch — with it off, anyone can sign up as anyone's email address.

### Auth emails (password reset, sign-up confirmation)

Supabase's built-in email sender is for trying things out only. It **refuses
to send to anyone who isn't on your Supabase team**, and it sends **2 emails
an hour for the whole project** (sign-up confirmations and resets combined).
The app still says "Check your email", because Supabase accepted the request;
the email just never goes out. Set up your own sender before real people sign
up:

1. Make a free account at [resend.com](https://resend.com) → **Domains → Add
   domain** → `niblgo.com`. Add the DNS records it shows you where niblgo.com's
   DNS lives, and wait for it to say **Verified**.
2. Resend → **API Keys → Create API key** (sending access is enough). Copy it.
3. Supabase → **Authentication → Emails → SMTP Settings** → turn on **Enable
   custom SMTP**:
   - Sender email: `no-reply@niblgo.com` · Sender name: `NiblGo`
   - Host: `smtp.resend.com` · Port: `465`
   - Username: `resend` · Password: the API key from step 2
4. Supabase → **Authentication → Rate Limits** → raise **emails sent per hour**
   (custom SMTP starts you at 30; 100 is comfortable for launch).
5. Supabase → **Authentication → URL Configuration → Redirect URLs** → make
   sure these are listed, or the links land on the homepage instead of the app:
   - `niblgo://reset` (password reset opens the app to set a new password)
   - `https://niblgo.com/auth/confirm` (sign-up confirmation)

   List exactly these two and nothing broader: no `*` or `**` wildcards, and
   remove testing leftovers like `localhost` or `exp://`. Supabase sends a
   link wherever the request asks if it matches this list, so a loose entry
   lets someone have a confirmation or reset link carry its session to their
   own site.

**Check it:** tap "Forgot password?" in the app with an account's email. The
email should arrive within a minute (look in spam the first time), and tapping
its link on the phone should open NiblGo on the "Set a new password" screen. If
nothing arrives, **Authentication → Logs** in Supabase says why.

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
| `0010_function_grants.sql` | **Security fix** — stops anon calling the RLS-bypassing helpers |
| `0011_feedback.sql` | In-app feedback and bug reports |
| `0012_nutrition.sql` | Nutrition labels and serving sizes on recipe cards |
| `0013_report_comments_and_accounts.sql` | Report a comment or a whole account |
| `0014_start_conversation_rpc.sql` | Start a 1:1 DM in one server-side call |
| `0015_comment_photos.sql` | Photos in comments |
| `0016_comment_replies.sql` | Threaded replies on comments |
| `0017_group_conversations.sql` | Group DMs |
| `0018_post_preview_rpc.sql` | Rich preview for shared post links |
| `0019_group_title.sql` | Name a group chat |
| `0020_conversation_mute.sql` | Mute a chat |
| `0021_push_tokens.sql` | Push notifications for DMs |
| `0022_collections.sql` | Collections on profiles |
| `0023_message_reactions.sql` | Reactions on DMs |
| `0024_profile_shares_and_tags.sql` | Share a profile in a DM; tag people in posts |
| `0025_leave_group.sql` | Leave a group chat ("Dan left the chat") |
| `0026_photo_size.sql` | Photos keep their whole shape (stores each post photo's size) |
| `0027_handle_capitals.sql` | Handles keep their capitals (JoeMama), still unique ignoring case |
| `0028_activity.sql` | Follows, comment likes and replies in Activity; push for them; no liking your own post |
| `0029_activity_live.sql` | Live Activity, so the in-app banner drops down the moment it happens |
| `0030_rls_hardening.sql` | **Security fix** — closes the holes found before outside testing (DM membership, dates, streaks, reports, blocked users, photo listing); see SECURITY.md |
| `0031_storage_hardening.sql` | **Security fix** — photos only upload through `upload-photo` (real JPEGs, metadata stripped), private DM photos, photo links must be real uploads, orphan cleanup. Deploy `upload-photo` and `sweep-storage` and ship the matching app build at the same time |
| `0032_chat_hardening.sql` | **Security fix** — DM pushes go out once per message and only into the chat it was sent in; a phone gets one account's notifications; groups hold at most 32. Redeploy `notify-message` right after it |
| `0033_session_checks.sql` | **Security fix** — signing out, deleting the account or a ban locks the old token out of the API at once instead of after an hour. Nothing to deploy with it; if anything ever goes wrong, the file's header has a two-line switch-off |
| `0034_ai_limits.sql` | **Security fix** — AI spend gets a per-minute and an app-wide daily limit; recipe cards must be well-formed, so one malformed card can't crash the app for everyone. Redeploy `format-recipe` and `lookup-nutrition` after it |
| `0035_abuse_limits.sql` | **Security fix** — rate limits on everything people create, no double posts or comments, no disguised names, no staff-looking handles. Nothing to deploy with it |

They are all safe to run twice, and so is `schema.sql` itself. What re-running
`schema.sql` will **not** do is add a column to a table that already exists —
`create table if not exists` skips the whole table. That is what the migrations
are for, and what `verify.sql` checks for you.

---

## 2. Anthropic — AI recipe cards

Skip this and the app still works; the recipe card just never appears and posts
show the blurb alone. Nothing else depends on it.

**The key never goes in the app.** Anything in `.env` ships inside the app
bundle where anyone can read it. The key lives as a Supabase Edge Function
secret, and the app calls the function — `supabase/functions/format-recipe`,
which is already written and already wired to `src/services/ai.ts`. All you are
doing here is supplying the key and pushing the function up.

### Get the key

1. <https://console.anthropic.com> → **API keys** → create one. It starts
   `sk-ant-`. Copy it now; the console will not show it again.

   **Scope it to a workspace.** A key created without a workspace has to name
   one on every request, and the API rejects the call outright if it doesn't:
   `This API key is not scoped to a workspace`. The function turns that into an
   opaque `upstream_error`, and the app falls back to blurb-only — so an
   unscoped key looks exactly like the feature silently not working. If you
   already have an unscoped key, set the workspace as a secret instead of
   making a new key:

   ```bash
   supabase secrets set ANTHROPIC_WORKSPACE_ID=wrkspc_your_workspace_id
   ```
2. **Billing** → add credit. $5 goes a long way: recipe formatting runs on
   Claude Haiku 4.5 at $1 per million input tokens and $5 per million output,
   and one recipe card is roughly 250 tokens in and 300 out — under a fifth of
   a cent, so a few thousand cards for $5.

### Set the secret and deploy

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then, from the
project folder:

```bash
supabase login
supabase link --project-ref lmmuevnvshcqaqxjosbe
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
supabase functions deploy format-recipe
supabase functions deploy delete-account
```

`delete-account` is a separate function and unrelated to the AI, but deploy it
in the same pass: Settings → Delete account calls it, and without it account
deletion silently fails.

Prefer not to install anything? Both halves can be done in the dashboard.

**The secret** goes on the Edge Function Secrets page:

```
https://supabase.com/dashboard/project/lmmuevnvshcqaqxjosbe/functions/secrets
```

Add `ANTHROPIC_API_KEY` as the key and paste the value. It is **not** in the
database — you will not find it in the Table Editor, and it is not Supabase
Vault (Database → Vault), which is a different feature for secrets used *by SQL*
rather than by Edge Functions. Putting the key there would leave the function
unable to see it.

You can set the secret before any function exists, and you do **not** need to
redeploy after changing one — secrets are read at call time.

**The function itself** is separate: Edge Functions → deploy a new function, and
paste in `supabase/functions/format-recipe/index.ts`. Do the same for
`delete-account`.

### Nutrition on recipe cards

Recipe cards can carry a nutrition label. The numbers come from **USDA
FoodData Central**, not from the AI — the model is used only to turn "2 cloves
of garlic" into a weight in grams, which is a question about quantity rather
than about food science. Asking a model for calories directly would be cheaper
and would look identical on screen, and would be made up.

Get a free key at <https://api.data.gov/signup/> — it is instant, and allows
1,000 requests an hour. Then:

```bash
supabase secrets set USDA_API_KEY=your-key
supabase functions deploy lookup-nutrition
```

Without the key, nutrition simply is not offered. That is deliberate: no label
is better than a made-up one. Lookups are cached in `nutrition_cache`, so
"chicken breast" costs one request ever rather than one per post.

### Two more secrets worth setting

```bash
supabase secrets set AI_DAILY_LIMIT=40                      # AI calls per user per day
supabase secrets set AI_PER_MINUTE=6                        # ...and per user per minute
supabase secrets set AI_GLOBAL_DAILY_LIMIT=2000             # ...and for the whole app per day
supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com  # who may call the function
```

None is required to work (those are the defaults), but they're cheap insurance.
The functions require a signed-in user and meter usage through
`consume_ai_quota` (migration 0034): per person per day, per person per minute,
and the whole app per day, which is the most a crowd of accounts can spend.
Also set a monthly spend limit in the Anthropic console (Settings → Limits) as
the last backstop. `ALLOWED_ORIGINS`
restricts the browser origins allowed to call it — native builds send no Origin
header and are unaffected.

### Verify

Write a post with a real cooking blurb — "chicken thighs with garlic and
paprika, roasted 25 min" — and tap format. You should get an editable card.

If nothing appears, the app is doing what it is designed to do: any failure
falls back to blurb-only rather than blocking your post, which does mean
failures are quiet. The detail is in the function logs — Supabase dashboard →
Edge Functions → format-recipe → Logs:

| Log / response | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY not configured` | The secret is not set on this project — check the Secrets page. Setting it takes effect immediately; no redeploy needed |
| `anthropic call failed http 401` | Bad or revoked key |
| `anthropic call failed http 400` … `not scoped to a workspace` | Unscoped key — set `ANTHROPIC_WORKSPACE_ID`, or make a workspace-scoped key |
| `anthropic call failed http 400` with a model message | Model id not available to your account |
| `anthropic call failed http 429` | Out of credit, or rate limited |
| `rate_limited` (429 from the function) | One of your own limits tripped (per person per day or minute, or the app-wide day), not Anthropic |
| `anthropic call failed timeout` | The model took longer than 25 seconds; the app offers a retry |
| `reply repeated the instructions; dropped` | Someone's blurb tried to get the prompt out; nothing was shown |
| No log line at all | The call never reached the function — check it deployed, and that you are signed in |

The model and prompt live in `src/config.ts` (`AI_CONFIG`) and are mirrored in
the function. Change both together — the function is the one that actually runs.

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

### Photo uploads and cleanup (after migration 0031)

```bash
SWEEP_SECRET=$(openssl rand -hex 32); echo "$SWEEP_SECRET"   # copy this for the Cron job below
supabase secrets set SWEEP_SECRET="$SWEEP_SECRET"           # it can only start a sweep
supabase functions deploy upload-photo    # the only way photos get into storage
supabase functions deploy sweep-storage --no-verify-jwt   # deletes photos nothing uses any more
supabase functions deploy delete-account  # now also removes the person's DM photos
```

`--no-verify-jwt` is because the sweep's secret isn't a login token; the
function checks it itself, and refuses everyone else. Supabase only ever shows
a fingerprint of a secret afterwards, so keep the copy until the Cron job has
it (or set a new one the same way).

Ship them together with the app build that uses them: older builds upload
straight to storage, which is now refused.

1. Upload one photo from the app (a post or an avatar). That records where
   your photos live (`app_config.storage_origin`), which the database checks
   every saved photo link against. `verify.sql` shows it as OK afterwards.
   If you ever move to a custom domain, update that row to match.
2. **Move DM photos sent before 0031** into the private bucket, once. Repeat
   until it says `"moved": 0`:
   ```bash
   curl -X POST https://<ref>.supabase.co/functions/v1/sweep-storage \
     -H "x-sweep-secret: <SWEEP_SECRET>" \
     -d '{"migrate_legacy_dm_photos": true}'
   ```
3. **Schedule the daily sweep.** Dashboard → Integrations → Cron → create a
   job that calls the `sweep-storage` Edge Function once a day (e.g.
   `17 4 * * *`), method POST, header `x-sweep-secret: <SWEEP_SECRET>`, body
   `{"grace_hours": 24}`. It deletes at most 2,000 files a run. Don't put the
   service-role key in the job: Cron stores the request, headers included, in
   the database, and that key unlocks everything. If an existing job has it,
   edit the job to use the sweep secret instead.

`UPLOAD_HOURLY_LIMIT` (default 60) caps uploads per user per hour:
`supabase secrets set UPLOAD_HOURLY_LIMIT=60`.

### Push notifications for DMs and Activity

These do go through Expo's push service, sent by two edge functions. Deploy
both (after migration 0028):

```bash
supabase functions deploy notify-message    # DMs
supabase functions deploy notify-activity   # likes, comments, replies, comment likes, follows
```

`notify-message` needs migration 0032 (it pushes nothing without it), so run
the migration first, then redeploy the function.

Shares, reposts, tags and saves show in Activity but don't push. Each Activity
item is pushed at most once, and only right after it happens.

While someone has the app open, the same kinds drop down as an in-app banner
instead of the phone's own (Settings > In-app banners turns it off). Run
migration 0029 so it drops down the moment it happens; without it the app still
notices, but only on a 30 second check.

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
- [ ] Custom SMTP set up, so reset and confirmation emails reach everyone (see "Auth emails" above)
- [ ] `service_role` key is nowhere in the repo or `.env` — only in edge-function secrets
- [ ] `.env` is gitignored (it is) and was never committed
- [ ] `ALLOWED_ORIGINS` set, so your functions aren't callable from anywhere
- [ ] `AI_DAILY_LIMIT` set, so one user can't burn your Anthropic credit
- [ ] You can work a report: [MODERATION.md](MODERATION.md) — App Store review asks about this
- [ ] Account deletion works end to end (Settings → Delete account, with `delete-account` deployed)
- [ ] You can answer a data access request — see "Data access requests" in [MODERATION.md](MODERATION.md). There is deliberately no in-app export, so this is a manual process with a legal clock on it (30 days GDPR, 45 CCPA)
- [ ] Run the checks: `npm run typecheck` and `npm run test:reminders`
- [ ] `supabase/verify.sql` reports OK on every row
- [ ] Run the RLS tests against a scratch database: `supabase/tests/README.md`

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
