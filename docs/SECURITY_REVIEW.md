# NiblGo security review: brief for the outside test

State as of 14 October 2026: database migrations through `0037`, edge
functions as in `supabase/functions/`. SECURITY.md has the detail behind each
line here; docs/OPERATIONS.md covers logs, backups and access.

## The system in one paragraph

An Expo / React Native app (iOS first) talking straight to Supabase: Postgres
with row-level security through the REST API (PostgREST), Supabase Auth, two
storage buckets (`photos`, public by URL; `dm-photos`, private), and seven edge
functions (`upload-photo`, `format-recipe`, `lookup-nutrition`,
`notify-message`, `notify-activity`, `delete-account`, `sweep-storage`). The
app ships only the project URL and the publishable key; everything else is
decided by the database and the functions. A small static site (niblgo.com)
hosts the legal pages, the email-confirmation page and shared-post previews.

## How to test

- **Where:** preferably a staging project (OPERATIONS.md, "Test accounts and
  the outside test"). If production: your own accounts made through the app,
  named so they're obviously yours, deleted afterwards. No dashboard access
  or service-role key is part of the test.
- **Expect limits:** per-person rate limits (SECURITY.md, "Spam and
  duplicates") and the AI allowance will refuse bursts on purpose. That's a
  pass, not a finding, unless you get past them.
- **Please don't** message, report or otherwise involve real users, or run
  volume tests against shared infrastructure (Supabase, Expo push, Anthropic,
  USDA) beyond what's needed to show a limit holds.

## What's protected, and the evidence

**End to end.** `supabase/tests/e2e/run.sh` (`npm run test:e2e`) starts a
private copy of the whole backend (real Supabase Auth, real PostgREST, the
seven edge functions) and attacks it through the app's own front door with
User A (owns the data), User B (an unrelated account) and User C (signed out):
110 checks (78 attacks and 32 everyday features), every one with an expected and an actual result, in
`supabase/tests/e2e/RESULTS.md`. The table below is the database-level detail.

Every database claim below is a check in `supabase/tests/rls_attack_test.sql`
(239 checks, six accounts signing in the way the API does, an attacker with an
ordinary account), run on a fresh install and on an upgraded database
(`supabase/tests/run_security.sh`). `supabase/verify.sql` checks the same
things on the live project.

| Area | What holds | Evidence |
| --- | --- | --- |
| Data access (RLS) | RLS on every table; users can read, change or delete only what's theirs or public; ids can't be swapped to reach other rows; no self-granted roles; definer functions pinned and answering only about the caller | Suite sections 1-12 |
| Photo storage | Uploads only through `upload-photo` (real JPEG, metadata stripped, path and random name chosen by the server, hourly cap); DM photos private to chat members via short-lived signed links; links must be real uploads; orphans swept daily | Sections 13-16; `npm run test:jpeg`, `test:upload`, `test:sweep` |
| DMs and groups | Members only, for messages, members, photos and reactions; leaving ends access to all of it; pushes only for your own fresh message, once, to that chat; one account per phone for pushes; groups capped at 32 | Sections 8, 17; `test:notify` |
| Sessions and sign-in | A token dies with its session (sign-out, deletion, ban), checked on every API request; one generic sign-in error; confirm and reset links only sign in the phone that asked; exact redirect allowlist | Section 18; PostgREST end-to-end run (SECURITY.md); `test:authlink` |
| Secrets and functions | Only the publishable key ships (history, bundle and logs scanned); every function verifies the session with Supabase Auth and takes identity only from it | `.gitleaks.toml` scan; `npm run test:functions` |
| AI | Signed in only; per-person-per-day, per-minute and app-wide daily limits; size caps and timeouts; no tools; the reply is rebuilt into a fixed schema and dropped if it repeats the prompt; nutrition numbers from USDA, never the model | Section 19; `test:ai`, `test:recipedata` |
| Abuse | Rate limits on everything people create; duplicate guards; no disguised names (control and direction-flipping characters); no staff-looking handles; malformed recipe cards refused and drawn safely | Sections 19-20; `test:handle` |
| Privacy | Account deletion leaves nothing pointing at the account; feedback is kept without the person; reports outlive accounts, and their copies of content are cleared 2 years after closing | Section 21 |

## Known limitations and accepted risks

Decided on purpose, and documented so they aren't reported as surprises:

- **Public by URL:** post, avatar and comment photos (posts are public; links
  are 128-bit random). Profiles (handle, name, bio, avatar, time zone) are
  readable by any signed-in user, including someone you've blocked.
- **Signed DM photo links** work for an hour for whoever holds them.
- **Storage and Realtime** honour a token until it expires (an hour); they
  don't go through the per-request session check. After sign-out a token
  reaches only its own chats' photos and Activity; after deletion, nothing.
- **Sign-up reveals whether an email is registered** (Supabase's own API does;
  limited by the per-IP sign-up rate limit). No CAPTCHA yet.
- **Sessions don't expire on their own** (like Instagram); paid-plan session
  limits work if turned on.
- **Recipe labels are client-set** (`nutrition_source`, `ai_generated`,
  `user_edited`): a scripted client can mislabel its own card.
- **Rate limits use fixed windows**, so up to twice a limit can land across a
  window boundary.
- **Older data isn't rewritten:** text, recipe-card and push-token rules added
  in 0034-0035 apply to new and edited rows; anything older is drawn safely
  by the app (`cleanRecipe`), and `verify.sql` counts malformed older cards.
  Handles that were taken before the reserved list stay as they are.
- **DM notifications carry the message's words** through Expo's and Apple's
  push services by default (`DM_PUSH_PREVIEWS=off` sends "New message").
- **Logs:** API logs include query strings (ids, search words); Postgres error
  logs can include the row a refused write tried to save. Retention is
  Supabase's (OPERATIONS.md, "Logs").
- **`npm audit`** still lists advisories in Expo's build tooling (CLI, Metro,
  code signing). It runs on the build machine and doesn't ship in the app.
- **Location tagging** is off behind a flag; when it's on, the Google Places
  key ships in the app and must be restricted (SECURITY.md checklist).

## Not done yet

In code, deliberately deferred:

- **Password reset** isn't set up (the reset deep link is guarded, but the
  flow hasn't been finished or tested end to end).
- **Moderation extras** from MODERATION.md: a published appeals contact, an
  appeals path, and auto-hiding a post past a report threshold.

Outside the code (they can't be checked from the repository, so confirm them
before the test; docs/DEPLOY_SECURITY_UPDATE.md walks through all of them in
order):

- [ ] `supabase/upgrade_all.sql` run on production (all migrations, 0002 to
      0037); `verify.sql` says PASS.
- [ ] Edge functions deployed at the current version (all seven), with
      `sweep-storage --no-verify-jwt` and its daily Cron job using
      `x-sweep-secret`.
- [ ] Secrets set: `ANTHROPIC_API_KEY`, `USDA_API_KEY`, `SWEEP_SECRET`, and the
      limits you want (`supabase secrets list`).
- [ ] Auth settings from SECURITY.md's checklist: confirm email on, exact
      redirect URLs, rate limits, minimum password length 8, leaked-password
      protection, refresh-token reuse detection.
- [ ] `pg_graphql` off; SSL enforced (OPERATIONS.md, "Production
      configuration").
- [ ] On a paid plan with daily backups, and `scripts/backup.sh` run once.
- [ ] Monthly spend limit set in the Anthropic console.
- [ ] Two-factor sign-in on Supabase, GitHub, Expo, Apple, Anthropic and the
      domain; GitHub secret scanning and push protection on.
- [ ] A staging project for the testers, or their test accounts agreed.
- [ ] The current app build (no microphone permission) on TestFlight.

## Re-running everything

```bash
npm run test:e2e                          # 110 end-to-end checks, Users A, B and C (Linux)
supabase/tests/run_security.sh            # 239 database checks, fresh install
supabase/tests/run_security.sh upgrade    # the same, on an upgraded database
npm test                                  # app and function unit tests
npm run test:functions                    # every edge function, run for real (needs Deno)
gitleaks git --log-opts="--all" . && gitleaks dir .   # secrets in history and files
```
