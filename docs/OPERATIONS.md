# Running NiblGo in production

Logs, access, backups, recovery, what's kept after someone leaves, and what to
do when something goes wrong. SECURITY.md says how the app protects data; this
says how to look after it.

---

## Logs: what's in them, and what never is

| Where | What it records | Kept for |
| --- | --- | --- |
| Edge Function logs (Dashboard → Edge Functions → Logs) | Errors with a short reason ("anthropic call failed timeout", "upload failed photos ..."), the account id when an account is deleted. | Your Supabase plan's log retention (1 day free, 7 days Pro) |
| API gateway logs (Logs → API) | Each request's method, path and query string, status, time, IP. Query strings carry ids and search words; request bodies (passwords, messages, posts) are not logged. | Plan retention |
| Postgres logs (Logs → Postgres) | Errors. A refused write can include "Failing row contains (...)", i.e. the text of that one row. | Plan retention |
| Auth logs (Logs → Auth) and `auth.audit_log_entries` | Sign-ups, sign-ins, sign-outs, with email and IP. The table in the database keeps them until deleted. | Plan retention / until deleted |
| The phone | Three `console.warn`s for failed saves, with the error's message only. | The device |

What no code logs, anywhere: passwords, access or refresh tokens, push tokens,
API keys, request headers, message text, or post text. Checked function by
function (SECURITY.md, "Keys and secrets"). Two settings change what's logged:

- `NUTRITION_DEBUG=1` makes `lookup-nutrition` log each ingredient it worked
  on (handy when a label looks wrong). Off by default; turn it off again after.
- `DM_PUSH_PREVIEWS=off` makes DM notifications say "New message" instead of
  the words. On by default, like Instagram: the words pass through Expo's and
  Apple's push services and show on the lock screen (the phone's own "Show
  previews" setting can hide them there).

To trim the auth audit table (sign-in history with emails and IPs), run this in
the SQL Editor, or schedule it with Cron (Integrations → Cron):

```sql
delete from auth.audit_log_entries where created_at < now() - interval '90 days';
```

If your project refuses writes to the `auth` schema, set the retention you
want in Supabase support instead; nothing in the app needs that history.

---

## Production configuration

Nothing in the app or the functions is a debug or test endpoint: the seven edge
functions are the product, each requires a signed-in user (or the server's own
secret, for the sweep), and errors come back as short codes, never stack
traces or provider responses. Demo mode only exists in builds made without the
Supabase settings, and it never talks to a server.

Dashboard settings code can't check (tick them once, and again after changes):

- [ ] **Database → Extensions: turn off `pg_graphql`.** The app only uses the
      REST API; GraphQL would let anyone with the public key read the shape of
      the database (RLS still applies to the data).
- [ ] **Database → Settings: Enforce SSL** on, and (Pro) **Network
      restrictions** to the addresses that need direct database access, if any.
- [ ] Everything under "Pre-launch checklist" in SECURITY.md (auth settings,
      redirect URLs, rate limits, secrets, Cron jobs).
- [ ] `supabase/verify.sql` in the SQL Editor says PASS.

---

## Who has access

| Account | Can | Keep it to |
| --- | --- | --- |
| Supabase organization | Everything: data, keys, backups | The founders, with two-factor sign-in on. Give anyone else the "Read-only" or "Developer" role, never Owner |
| GitHub repository | Code, history | People who ship code |
| Expo / EAS | Builds, signing credentials, push sending | The founders |
| Apple Developer / App Store Connect | Releases, TestFlight testers | The founders; testers get TestFlight only |
| Anthropic console | Spend, the API key | The founders; set a monthly spend limit |
| api.data.gov (USDA key), Google Cloud (Places, later) | Their keys | The founders |
| Cloudflare or Netlify, the domain registrar | niblgo.com, email routing | The founders, two-factor on |

When someone leaves: remove them everywhere above, then rotate what they could
have copied (next section, "A key leaked"). The service-role key is the one
that matters most.

---

## Backups and recovery

**What Supabase backs up.** Free projects get no backups you can restore. Pro
projects get a daily backup kept for 7 days (Point-in-Time Recovery is an
add-on, down to the second). Either way that's **the database only**: photos in
Storage are not in it. Before real people's data is in the app, be on Pro.

**What `scripts/backup.sh` backs up.** The database (roles, schema, data) and
both photo buckets, into `backups/<time>/`. Run it weekly and before every
migration. It holds everyone's private messages and DM photos, so encrypt it
as it suggests, store it off the laptop (an encrypted drive or a private cloud
bucket only the founders can open), and keep a few weeks of copies, not for
ever. `backups/` is in `.gitignore`. The script uses the Supabase CLI's own
`db dump` and `storage cp`; it hasn't been run against your project from here
(it needs Docker and your database password), so run it once now and check
the folder has all five parts.

**Restoring, the usual case** (a bad migration, a mistaken delete): Dashboard →
Database → Backups → restore the daily backup (or a point in time). Same
project, same URLs, nothing else to change. Photos aren't touched by it.

**Restoring, the bad case** (the project is gone): from the latest
`scripts/backup.sh` folder, into a new project:

1. New Supabase project. Note its URL and database connection string.
2. Database, in one go:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "$NEW_DB_URL"
   ```
3. Run `supabase/schema.sql` once more in the SQL Editor (it's safe to repeat,
   and switches back on what lives outside the tables, like the session check).
4. Photos: `supabase link --project-ref <new ref>`, then
   `supabase storage cp -r photos ss:///photos --experimental` (and the same
   for `dm-photos`).
5. Photo links name the old project's address. In the SQL Editor, replace it:
   ```sql
   update public.app_config set value = 'https://<new ref>.supabase.co' where key = 'storage_origin';
   update public.posts    set photo_url  = replace(photo_url,  'https://<old ref>.supabase.co', 'https://<new ref>.supabase.co');
   update public.users    set avatar_url = replace(avatar_url, 'https://<old ref>.supabase.co', 'https://<new ref>.supabase.co');
   update public.comments set image_url  = replace(image_url,  'https://<old ref>.supabase.co', 'https://<new ref>.supabase.co');
   ```
6. Secrets, functions and Cron, as GO_LIVE.md describes; the auth settings
   from SECURITY.md's checklist.
7. A new app build with the new `EXPO_PUBLIC_SUPABASE_URL` and publishable key
   (`eas.json`), and the website rebuilt.
8. `verify.sql` says PASS; sign in, post, send a DM photo.

Everyone has to sign in again after this (sessions don't move between
projects). Practise it once on a throwaway project, so the first time isn't
the real one.

---

## What's kept after someone deletes their account

Deleting an account removes the account, profile, posts, recipes, comments,
likes, follows, messages they sent, reactions, collections, push tokens,
streaks and usage counters, and their photos (their own folder at once, their
DM photos within minutes, anything else in the daily sweep).
`supabase/tests/rls_attack_test.sql` section 21 checks nothing is left pointing
at the account.

Kept on purpose, and for how long:

| What | Why | How long |
| --- | --- | --- |
| Feedback and bug reports they sent | The team needs them | Kept, without their handle or account |
| Reports they filed | A victim leaving shouldn't erase what they reported | Kept, without them |
| Reports *about* them, with a copy of what was reported | Moderation evidence, and repeat behaviour stays visible | The copy until 2 years after the report is closed (`REPORT_RETENTION_DAYS`, default 730), then cleared by the daily sweep; the report and its outcome stay |
| Messages *others* sent them in a chat | They belong to the people who sent them | As long as those people keep them |
| Logs and the auth audit history | See "Logs" above | Plan retention / until trimmed |
| Backups | Disaster recovery | Until they age out (7 days on Pro; your own copies until you delete them) |

The privacy policy (`legal/PRIVACY_POLICY.md`, section 6 and the retention
table) says the same; update it with any change here, then rebuild the site
(`node scripts/build-site.js`).

---

## Test accounts and the outside test

All three build profiles in `eas.json` (development, preview, production) talk
to the production project, so every build anyone runs sees real data. For the
outside test:

- **Best: a separate staging project.** Make a second Supabase project, run
  `schema.sql`, deploy the functions, and give the testers a build pointed at
  it (a fourth `eas.json` profile with its URL and key). Nothing they do can
  touch real people.
- **If they test production:** they make their own accounts through the app
  like anyone else, use names that say so (`pentest_1`), and get no dashboard
  access and no service-role key. Afterwards, delete those accounts from the
  app or the dashboard. Ask them not to message or report real users.
- The demo mode in the app has its own local accounts that never reach a
  server.

There are no shared passwords, seeded accounts or test credentials in the
repository (`supabase/seed.sql` is a commented-out template), and
`supabase/reset.sql` refuses to run on a database with real accounts unless
you deliberately confirm it.

---

## When something goes wrong

**A key leaked** (pasted somewhere, committed, a laptop lost). Rotate at the
source; deleting it from the code doesn't help.

| Key | Rotate | Then |
| --- | --- | --- |
| Service-role / secret key | Dashboard → Project Settings → API Keys: make a new secret key, then delete the old one (legacy JWT keys: rotate the JWT secret, which also signs everyone out) | The functions pick up the new one; update the sweep's Cron job if it used the key |
| `SWEEP_SECRET` | `supabase secrets set SWEEP_SECRET=$(openssl rand -hex 32)` | Update the Cron job's header |
| Anthropic | console.anthropic.com → API keys: create, `supabase secrets set ANTHROPIC_API_KEY=...`, then delete the old | Check usage for anything you didn't send |
| USDA | api.data.gov: new key, `supabase secrets set USDA_API_KEY=...` | |
| Publishable key | Only if someone is abusing it: new publishable key, new app build | It's public by design; RLS is what protects data |

**An account is being abused or was taken over.** Ban it (MODERATION.md,
"Acting on a report"): the ban locks out every session at once. If the owner
was hijacked, set them a new password from Authentication → Users once you've
confirmed it's really them, then lift the ban, or lift it and have them use
"Forgot password?" on their own phone (the reset link only works on the phone
that asked for it).

**Data looks wrong after a change.** Stop deploying, restore the daily backup
(above), and run `verify.sql` and `supabase/tests/run_security.sh` against a
copy before trying again.
