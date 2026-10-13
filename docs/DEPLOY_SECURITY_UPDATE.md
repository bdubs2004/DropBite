# Shipping the security update

Everything from the security review (migrations 0030 to 0036, seven edge
functions, settings, the website and the app), in the order that's safe. Do it
top to bottom in one sitting. If you already did some steps after an earlier
item, doing them again is harmless: every migration is safe to re-run, and
redeploying a function just replaces it.

Why this order: the functions expect the new database (the AI functions call
`consume_ai_quota` with new limits, `notify-message` needs
`claim_message_push`, the sweep needs `redact_closed_reports`), and the app
expects the functions. Database first, then functions, then the app.

---

## 0. Before you start (5 minutes)

1. Make sure the code is current on your machine:
   ```bash
   git stash          # only if app.json has local changes
   git pull
   git stash pop      # only if you stashed
   npm install
   ```
2. Take a backup. Dashboard → Database → Backups if you're on a paid plan, and
   (either way) `scripts/backup.sh`, which also copies the photos
   (docs/OPERATIONS.md, "Backups").
3. Paste `supabase/verify.sql` into the SQL Editor and run it. Note what it
   says; you'll run it again at the end.

## 1. Database (SQL Editor)

Open each file in `supabase/migrations/`, paste it into the SQL Editor and run
it, **in this order**. Wait for "Success" before the next one. Always run the
whole list, even the ones you ran before: a later one updates something an
earlier one sets (0031 refines 0030's report handling), so running an older
one again on its own would undo part of a newer one. Run in order, they end up
exactly like a fresh install (the security suite checks that).

| # | File | What it does |
| --- | --- | --- |
| 1 | `0030_rls_hardening.sql` | Locks down who can read and change what |
| 2 | `0031_storage_hardening.sql` | Photo uploads only through the server; private DM photos |
| 3 | `0032_chat_hardening.sql` | DM pushes once per message; one account per phone; group cap |
| 4 | `0033_session_checks.sql` | Old tokens stop working after sign-out, deletion or a ban |
| 5 | `0034_ai_limits.sql` | AI per-minute and app-wide limits; recipe cards must be well-formed |
| 6 | `0035_abuse_limits.sql` | Spam limits, duplicate guards, no disguised names or staff handles |
| 7 | `0036_retention.sql` | Reports outlive accounts; report copies cleared after 2 years |

Two of them may print a **warning** rather than an error; both are fine:
- 0033: "Session check NOT switched on". This means Supabase didn't let it
  change the API setting. Run this in the SQL Editor, then re-check with
  `verify.sql`:
  ```sql
  alter role authenticator set pgrst.db_pre_request = 'public.check_request';
  notify pgrst, 'reload config';
  ```
- 0034: "Some recipe cards saved before 0034 are malformed". Old cards stay as
  they are; the app draws them safely; `verify.sql` says how many.

An actual **error** means stop: copy it and send it to me before going on.

## 2. Secrets (terminal, in the project folder)

```bash
supabase login                      # if you haven't on this machine
supabase link --project-ref <your project ref>

# Required, new: lets the daily cleanup run without the master key.
SWEEP_SECRET=$(openssl rand -hex 32); echo "$SWEEP_SECRET"    # copy it for step 4
supabase secrets set SWEEP_SECRET="$SWEEP_SECRET"

# Required, should already be set (check with: supabase secrets list)
#   ANTHROPIC_API_KEY, USDA_API_KEY   (and ANTHROPIC_WORKSPACE_ID if your key needs it)

# Optional; these are the defaults if you set nothing:
supabase secrets set AI_DAILY_LIMIT=40 AI_PER_MINUTE=6 AI_GLOBAL_DAILY_LIMIT=2000 UPLOAD_HOURLY_LIMIT=60
#   DM_PUSH_PREVIEWS=off     DM notifications say "New message" instead of the words
#   REPORT_RETENTION_DAYS=730   how long closed reports keep their copy (privacy policy: 2 years)
#   ALLOWED_ORIGINS=https://niblgo.com   only if you ship a web version
```

`supabase secrets list` should then show only those names (plus the
`SUPABASE_*` ones Supabase adds itself). If anything else is there, delete it
(`supabase secrets unset NAME`).

## 3. Edge functions (terminal)

Deploy each one by name: deploying "all" would deploy the sweep without the
flag it needs.

```bash
supabase functions deploy upload-photo
supabase functions deploy format-recipe
supabase functions deploy lookup-nutrition
supabase functions deploy notify-message
supabase functions deploy notify-activity
supabase functions deploy delete-account
supabase functions deploy sweep-storage --no-verify-jwt
```

## 4. One-time jobs (terminal and dashboard)

1. **Daily cleanup (Cron).** Dashboard → Integrations → Cron. If there's
   already a `sweep-storage` job, edit it; otherwise create one: type "Edge
   Function", `sweep-storage`, method POST, schedule `17 4 * * *`, header
   `x-sweep-secret: <the secret from step 2>`, body `{"grace_hours": 24}`.
   Make sure **no** `Authorization: Bearer <service role key>` header is left
   on it.
2. **Old DM photos into the private bucket** (once; skip if you did it after
   item 2). Repeat until it says `"moved": 0`:
   ```bash
   curl -X POST https://<ref>.supabase.co/functions/v1/sweep-storage \
     -H "x-sweep-secret: <the secret>" -d '{"migrate_legacy_dm_photos": true}'
   ```
3. **Storage address** (skip if done): post one photo from the new app build
   (step 7) and `verify.sql`'s "storage origin" row turns OK.

## 5. Dashboard settings (can't be done from code)

Authentication:
- [ ] Providers → Email: **Confirm email** on; **Secure email change** on;
      minimum password length **8**.
- [ ] URL Configuration: Site URL `https://niblgo.com`; Redirect URLs exactly
      `niblgo://reset` and `https://niblgo.com/auth/confirm`. Delete anything
      else (wildcards, `localhost`, `exp://`).
- [ ] Rate Limits: sign-ups/sign-ins 30 per 5 min, token verifications 30 per
      5 min (the defaults); emails per hour 100 once custom SMTP is on.
- [ ] Sessions: "Detect and revoke potentially compromised refresh tokens" on;
      JWT expiry 3600.
- [ ] Policies: leaked-password protection on (paid plans).

Database and project:
- [ ] Database → Extensions: turn **off** `pg_graphql` (the app doesn't use it).
- [ ] Database → Settings: **Enforce SSL** on.
- [ ] Billing: a paid plan before real users, for daily backups.

Accounts:
- [ ] Two-factor sign-in on Supabase, GitHub, Expo, Apple, Anthropic, and the
      domain/hosting accounts.
- [ ] Anthropic console → Limits: a monthly spend limit.
- [ ] GitHub → Settings → Code security: secret scanning and push protection on.

## 6. Website

Redeploy niblgo.com (`node scripts/build-site.js`, then your usual upload).
It carries the fixed email-confirmation page and the updated privacy policy.

## 7. App

```bash
eas build -p ios --profile production --auto-submit
```

This build: no microphone permission, the in-app limits and messages, sign-out
clears the phone, confirm links only sign in the phone that asked.

## 8. Check it worked (10 minutes)

1. `supabase/verify.sql` in the SQL Editor says **PASS**. Anything else names
   the step to redo.
2. On the new build: sign up a new account (the email arrives, the link opens
   the app); post a photo; format a recipe and fix a quantity; DM a photo to a
   friend and see it arrive; sign out and back in.
3. Dashboard → Edge Functions → `sweep-storage` → Logs the next morning: one
   run, no errors.
4. Dashboard → Edge Functions → `lookup-nutrition` → Logs: search for
   `usda fetch failed`. If any line is from before today, it held your USDA
   key: make a new one at api.data.gov and `supabase secrets set
   USDA_API_KEY=...`.

---

## Still on you (beyond password reset)

None of these block the release, but they're yours to decide or do:

- **Read the privacy policy change** (section 6 and the retention table in
  `legal/PRIVACY_POLICY.md`). It now says what the system really does.
- **Give the testers a staging project** if you can (docs/OPERATIONS.md,
  "Test accounts and the outside test"). All three build profiles point at
  production today.
- **Moderation extras** (MODERATION.md, "Still missing"): a published appeals
  contact and path, and optionally auto-hiding heavily reported posts.
- **When location tagging comes back**: restrict the Google Places key to the
  app's bundle id and the Places API, with a daily quota.
- **Optional**: `DM_PUSH_PREVIEWS=off` if you'd rather DM text never left the
  server in notifications; trimming the auth audit table on a schedule
  (docs/OPERATIONS.md, "Logs").
