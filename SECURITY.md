# Security

How NiblGo is secured, what's deliberately deferred, and what to check before
launch. Read alongside `supabase/schema.sql` (the enforcement layer) and
`supabase/tests/` (the proof).

## The one rule

**The client is hostile.** The app ships with a public Supabase anon key, so
anyone can extract it and talk to the database directly with their own script.
The UI hiding something is not a control. Every real control lives in Postgres
(RLS + CHECK constraints) or in an edge function.

Client-side validation still exists, but only for friendly errors — never as
the enforcement point.

## Trust boundaries

| Where | Trust | Notes |
| --- | --- | --- |
| App code + `EXPO_PUBLIC_*` env | **None.** Public. | Anon key belongs here; nothing secret ever does. |
| Postgres RLS / CHECK | Authoritative | The real access control. |
| Edge functions (service-role key) | Authoritative | Verify the caller's JWT before doing anything. |
| Anthropic API key | Server-only secret | `supabase secrets set`, never `.env`, never the bundle. |
| Model output | **Untrusted input** | Steered by user text; bounded and re-shaped before use. |

## Keys and secrets

Every key the project uses, and where it lives:

| Key | Where it lives | Secret? |
| --- | --- | --- |
| Supabase URL + publishable key (`sb_publishable_…`) | App bundle (`eas.json`, `EXPO_PUBLIC_*`), the website's post-preview worker | No. Meant to be public; RLS decides what it can do |
| Supabase service-role key | Edge Function environment only (Supabase injects it) | **Yes.** Bypasses RLS |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_WORKSPACE_ID`) | Edge Function secrets (`format-recipe`, `lookup-nutrition`) | **Yes** |
| `USDA_API_KEY` | Edge Function secrets (`lookup-nutrition`), sent as a header | Yes (free, low value) |
| `SWEEP_SECRET` | Edge Function secrets + the daily Cron job | Yes, but it can only start a photo sweep |
| `EXPO_PUBLIC_GOOGLE_PLACES_KEY` | App bundle, once Phase 2 tagging is on | No (can't be): restrict it, see the checklist |
| Expo / Apple signing credentials | EAS servers (`eas credentials`), never the repo | Yes |

**Checked before outside testing:**
- `gitleaks` over every commit on every branch (111) and the working tree,
  plus a direct search of every commit for service-role JWTs, `sb_secret_`,
  `sk-ant-`, Google, Expo, GitHub and Resend tokens and private keys. The only
  key ever committed is the publishable key in `eas.json`, which is meant to
  ship. No `.env`, signing key or `.p8/.p12` was ever committed (`.gitignore`
  covers them). Re-run any time with `gitleaks git --log-opts="--all" .` and
  `gitleaks dir .` (settings in `.gitleaks.toml`): a clean run says "no leaks
  found".
- The production iOS JavaScript bundle, built with the real `eas.json`
  settings: the only key in it is the publishable key. (`sb_secret_` appears
  once, as supabase-js's own check that refuses secret keys in an app.)
- Logs: no function logs a token, key or request header. `lookup-nutrition`
  used to put the USDA key in the request URL, and a failed request's error
  message (which is logged) includes the URL; the key now goes in a header.
- No secret has been exposed, so nothing needs rotating, with one possible
  exception: if the `lookup-nutrition` logs ever show `usda fetch failed`,
  that line held the USDA key, so make a new one (api.data.gov, a minute).
  If a secret ever does leak, rotate it at the source. Deleting it from the
  code or history doesn't help: copies of a pushed commit can't be recalled.

**Edge functions** (`npm run test:functions` runs each one for real under Deno
against a stand-in Supabase that records every call):
- Every function except the sweep needs a signed-in user, and checks the token
  with Supabase Auth (`auth.getUser`), which also knows if the session has
  ended. No token, the publishable key, or a forged token naming someone else
  gets 401 before the function touches anything.
- Identity only ever comes from that verified session. A user id in the
  request body is ignored: asked to delete "someone else", `delete-account`
  deletes the caller.
- What each one is allowed to do is checked too: `upload-photo` only into your
  own folder or a chat you're in; `notify-message` only your own fresh message
  (0032); `notify-activity` only Activity you caused; the AI functions are
  metered per user per day.
- `sweep-storage` is for the server only: `SWEEP_SECRET` (or the service-role
  key), compared in constant time. A signed-in user gets 401.
- All of them take POST only, and answer errors with a code, never internals.

## What's enforced

**Authentication & ownership.** Supabase Auth issues the JWT; `auth.uid()` is
the only source of identity. Every write policy checks the row belongs to the
caller — ids are never read from a request body. `delete-account` deletes the
account that owns the presented JWT, nothing else.

**Private follower lists.** `users.follows_private` is enforced in RLS, not
just the UI: a follow edge is only visible to a third party when neither side
is private. Counts stay public through `follow_counts()`, a `SECURITY DEFINER`
function with a pinned empty `search_path`. (Before this, the setting was
cosmetic — the `follows` table was readable by any signed-in user.)

**Direct messages** are members-only at the row level. Non-members cannot read
messages, conversations, or even membership rows; you cannot send as another
user or delete someone else's message. There is no way in from the client:
threads and their members are only ever created by `start_conversation()` and
`start_group_conversation()`, and a member can change nothing about their
membership except mute and last-read (column grants). Before 0030 a member
could move their own membership row into *any* thread
(`update conversation_members set conversation_id = ...`) and read its whole
history; an even earlier version let anyone add themselves to a stranger's
thread.

**Leaving a chat ends your access to all of it.** That's the policy: the
moment you leave (the only way out; nobody can remove anyone else), you can't
read the thread, its members, its old or new messages, or its photos, and you
can't send, react or rename. Starting a chat with the same people makes a new,
empty thread rather than reopening the old one. The one exception is a DM photo
link you signed while still in the chat, which keeps working until it expires
(an hour). A group holds at most 32 people (0032).

**IDs can't be swapped to get in.** Every write is checked against the row it
ends up as, not the id you name: moving a membership, a reaction or a message
into another thread, sending a photo from another chat's folder, reporting a
message you can't see, or naming someone else as the sender are all refused,
and `rls_attack_test.sql` tries each of them.

**Nothing private goes out live.** Only `notifications` is in the Realtime
publication, and Realtime applies RLS to it, so each person receives only their
own Activity; chats are fetched, never broadcast. Message pushes come from
`notify-message`, which since 0032 pushes a message only once, only if the
caller sent it, in the thread named, in the last five minutes, while still in
it, and only to the other members who haven't muted it and aren't in a block
with the sender. Before that it could be replayed to spam a chat. Push tokens
belong to one account: saving a token takes it off any other account, and
signing out removes it, so a phone that switches accounts stops showing the
old account's DMs on its lock screen. Edge functions answer errors with a code
(`server_error`), never the underlying message.

**Direct messages are opt-in.** You can only *start* a thread with someone you
follow and aren't blocked with, which the start functions check inside
`SECURITY DEFINER` (a plain subquery would fail for private accounts, whose
follow rows RLS hides). Replying is not gated, so the person you messaged can
answer without following you back, and unfollowing later doesn't lock either of
you out of a thread you already have.

**The RLS helpers only answer about you.** `is_blocked_pair`,
`is_conversation_member`, `conversation_has_block` and `can_reply_under` must be
callable by signed-in users because policies call them, which also makes them
callable directly over the API. Each one answers only questions that involve
the caller, so nobody can ask "did Alice block Eve?" or "is Alice in this
thread?". `is_following` and `conversation_is_empty` no longer back any policy
and aren't callable at all; `is_following` used to expose private follow lists.

**Values the server owns.** Some things a client must not get to choose, so the
database sets them whatever the request says (migration 0030):
- `created_at` on every table the app writes, and a thread's `updated_at`. A
  post dated 2099 used to sit at the top of every feed forever, and messages
  and comments could be backdated.
- **Streaks**, kept by a trigger on `posts` in the user's timezone. The app
  can't write them; anyone could previously top the leaderboard with a made-up
  999-day streak.
- **Reports**: the reported person and the evidence snapshot are read from the
  real post, comment or message *with the reporter's own access*, so you can
  only report what you can see and a report can't be used to read a DM you're
  not in. Every report starts `open`. Feedback likewise starts `new` and carries
  the filer's real handle.
- **Profiles** can change only the fields the app edits (name, bio, avatar,
  follower privacy), not id, creation date or timezone. **Notifications** can
  change only read/unread.

**Notifications cannot be forged.** `public.notifications` has select, update
and delete policies for the recipient, and deliberately **no insert policy at
all**. Rows are written only by `AFTER INSERT` triggers on reactions, comments,
reposts and shares, which are `SECURITY DEFINER` with a pinned empty
`search_path`. So a patched client can neither spam someone else's bell nor
quietly skip writing a notification for an interaction it made. The block test
lives in the select policy rather than the app, so blocking someone
retroactively hides the notifications they already caused.

**Blocking** is symmetric in effect though stored one-directionally: neither
party sees the other's posts, comments, recipes, likes, reposts or shares, new
follows are refused, and an existing DM thread stops accepting messages from
both sides. Liking, commenting, saving, reposting or sharing all need the post
to be visible to you, so a blocked person can't keep commenting on the
blocker's posts by id. A blocked user cannot read the blocks table, so they
cannot tell, and cannot delete the block.

**Reports** are write-mostly: a reporter reads back only their own, the
reported user can never see or delete them, and nobody changes `status` from
the app. Deleting a reported post does not destroy the report — `post_id` is
`ON DELETE SET NULL` and the content is snapshotted, by the database, at report
time.

**Saved posts** are owner-only. **Comments** are immutable and deletable by
their author *or* the post owner, so users can moderate their own posts.

**Photo storage.** Two buckets, by design:

| Bucket | Public? | Holds | Why |
| --- | --- | --- | --- |
| `photos` | Public | Post photos, avatars, comment photos | Posts are public: share links on niblgo.com show them to signed-out visitors |
| `dm-photos` | **Private** | DM photos, one folder per chat | Only people in that chat can read them, through signed links that last an hour |

- **Uploads only go through the `upload-photo` edge function.** Clients can't
  write to storage at all. The function reads the bytes (never the
  Content-Type or file name) and accepts only a real JPEG: it walks the file's
  structure, checks the pixel size, strips EXIF (GPS location, camera serial),
  XMP and comments, and cuts off anything appended after the image. It picks
  the bucket, the folder (your own; for DM photos, a chat you're in and not
  blocked in) and a 128-bit random name, never overwrites, and caps uploads at
  60 per user per hour (`UPLOAD_HOURLY_LIMIT`). Both buckets also cap files at
  10 MB and accept only `image/jpeg`.
- **Photo links must be real uploads.** A post, avatar, comment or message can
  only point at a file that exists in this project's storage, in the poster's
  own folder (or that chat's folder). Before 0031 a link could be any `https`
  host, which could log the IP of everyone who viewed it, or someone else's
  photo.
- **Nobody can list, replace or delete someone else's files**, signed in or
  not. Listing is limited to your own folder (and chats you're in).
- **Nothing is left behind.** `storage_orphans()` finds files nothing uses any
  more (deleted posts, comments, messages, old avatars, deleted accounts) and
  the `sweep-storage` function deletes them daily, through the Storage API.
  Photos that are evidence in an open report are kept until it's closed.
  Deleting an account removes the person's whole folder and the DM photos their
  deleted messages leave behind, straight away.

**Input bounds.** Every user-writable column is length- or range-bounded
(`schema.sql`), mirrored in `src/lib/limits.ts` for the UI. Recipe JSON is
capped by array length *and* byte size.

**AI cost control.** `format-recipe` verifies the caller's JWT (the public anon
key is not authentication) and meters each user against a daily cap via
`consume_ai_quota()`. Tune with `AI_DAILY_LIMIT`; default 40/user/day. The
quota ledger is unreadable and unwritable from the client.

**Injection.** Search terms are stripped of PostgREST filter syntax before
interpolation into `.or()`/`.ilike()` (`sanitizeSearchTerm`) — raw input there
lets a caller inject extra filter conditions. No raw SQL is built anywhere.

**Error handling.** Edge functions log detail server-side and return opaque
codes. Sign-in failures return one generic message so the form isn't an
account-existence oracle.

**Sign-in, sessions and sign-out.**
- *One answer for every failed sign-in* ("Wrong email or password"), and being
  rate limited says only "too many attempts", so neither tells you whether an
  account exists. Supabase's password reset and resend-confirmation also answer
  the same either way. After 5 wrong passwords in a row the app waits 30
  seconds, doubling each miss up to 5 minutes; Supabase's per-IP rate limits
  (checklist below) are what actually stop guessing.
- *Email confirmation*: with **Confirm email** on, a new account gets no session
  until the link is opened, and sign-in refuses an unconfirmed account (only
  after the right password, so that isn't an oracle either).
- *A token dies with its session* (0033). Supabase tokens are signed JWTs valid
  for an hour, and the API used to honour one for that whole hour after
  sign-out, account deletion or a ban. Now PostgREST runs `check_request()`
  before every request and answers 401 unless the session the token names
  still exists, belongs to it, is within its time limit, and the account isn't
  deleted or banned. Tested against a real PostgREST 12 server: the same token
  gets 200 while signed in and 401 the moment the session is gone. Edge
  functions already asked Supabase Auth, which knows the same thing.
- *Signing out* ends this phone's session on the server (others stay signed
  in, like Instagram), removes its push token (0032) and clears its recent
  searches, so the next person on the phone sees none of it. If a session ends
  somewhere else (deleted, banned, signed out from another phone), the app goes
  back to the sign-in screen when it next comes to the front. Being offline
  never signs anyone out.

**Deep links and redirects.**
- The app opens `niblgo://` (and `https://niblgo.com/`) links only to its own
  screens: a post, a profile, a few tabs, and the two auth links. Route values
  are ids, fetched under RLS like anything else. No link makes the app open an
  outside address; the only outside pages it opens are the fixed Terms and
  Privacy links.
- *Session injection.* A confirm or reset link carries a session, and anyone
  can build one from their own account and send it to someone, which would
  quietly sign the victim into the attacker's account (and whatever they then
  posted or messaged would land there). The app now uses a link's session
  only if this phone asked for that kind of link, for that email, in the last
  48 hours, nobody is signed in, and the token hasn't expired
  (`linkSessionAllowed`). Anything else is ignored; they can sign in by hand.
- *The confirm page* (`niblgo.com/auth/confirm`) only ever forwards to
  `niblgo://auth/confirm`, and no longer prints the link's error text, so a
  crafted link can't put its own words on niblgo.com.
- *Where Supabase sends email links* is the `redirect_to` the request names,
  but only if it's on the **Redirect URLs** allowlist; anything else falls back
  to the Site URL. Keep that list to the two exact entries in the checklist: a
  wildcard there would let anyone have a confirmation or reset link carry its
  session to a site of their choosing.

**Demo mode** hashes passwords with a per-user salt rather than storing them in
the clear in AsyncStorage, and generates ids from the platform CSPRNG rather
than `Math.random`.

## Deliberately deferred

- **Post, avatar and comment photos are public by URL**, by design (posts
  are public and shared links show them signed out). The 128-bit random names
  mean a photo can only be found through a link to it.
- **A signed DM photo link works for an hour for whoever holds it.** That's
  how signed links work; it's short, and only a chat member can make one.
- **Profiles expose `timezone`** to every signed-in user (an approximate
  location). Nothing reads it server-side except the streak trigger.
- **Storage and Realtime trust a token until it expires** (an hour), because
  they don't go through PostgREST's per-request check. After signing out, that
  token can still read only its own chats' photos and its own Activity; after
  deleting the account, nothing (the memberships and rows are gone).
- **Sign-up reveals whether an email is registered.** Supabase's own sign-up
  API answers an existing address with a placeholder user that has no
  identities, so anyone calling it directly can tell; the app showing "that
  email already has an account" adds nothing. It's limited by the per-IP
  sign-up rate limit. Turning on CAPTCHA (Authentication → Bot protection)
  would slow it further, but needs a CAPTCHA step in the app.
- **Sessions don't time out on their own** (like Instagram). Supabase's session
  time-box and inactivity timeout are paid-plan settings; the app works with
  them if they're turned on (expired sessions are refused).
- **Recipe labels are client-set**: `nutrition_source`, `ai_generated` and
  `user_edited` are whatever the app sends, so a scripted client could label
  its own numbers as USDA.
- **Location/restaurant tagging** is off (`LOCATION_TAGGING_ENABLED`). Its
  columns still exist and are still constrained.
- **Feed reads are broad.** Any signed-in user can read any non-blocked post —
  correct for MVP, where all posts are public. Revisit if private accounts ship.
- **`npm audit` reports advisories in Expo's build tooling** (postcss,
  brace-expansion, uuid) reached only through the CLI/bundler, not shipped in
  the app. They can't be resolved without breaking the SDK 54 pin that keeps
  Expo Go working. Re-check on the next SDK upgrade.

## Pre-launch checklist

- [ ] Run the migrations in `supabase/migrations/` in order if the database
      predates them (a fresh `schema.sql` already includes everything).
- [ ] Re-enable **Confirm email** (Authentication → Providers → Email) if it
      was turned off for testing. In the same place, keep **Secure email
      change** on.
- [ ] Authentication → URL Configuration: **Site URL** `https://niblgo.com`;
      **Redirect URLs** exactly `niblgo://reset` and
      `https://niblgo.com/auth/confirm`. No wildcards, and remove any
      `localhost` or `exp://` entries left from testing.
- [ ] Authentication → Rate Limits: keep sign-ups and sign-ins at 30 per 5
      minutes per IP and token verifications at 30 per 5 minutes (the
      defaults); emails per hour 100 once custom SMTP is on.
- [ ] Authentication → Sessions: leave **Detect and revoke potentially
      compromised refresh tokens** on. Leave the JWT expiry at 3600 seconds.
- [ ] After migration 0033, `verify.sql` shows "signed-out and deleted accounts
      are locked out at once: OK".
- [ ] Raise the Supabase minimum password length to **8** to match the app.
- [ ] Set `ALLOWED_ORIGINS` on the edge functions if you ship a web build;
      otherwise CORS stays `*`.
- [ ] Set `AI_DAILY_LIMIT` to whatever you're willing to pay for.
- [ ] Confirm leaked-password protection is on (Authentication → Policies).
- [ ] Turn on Supabase auth rate limiting.
- [ ] Confirm the `service_role` key exists **only** in function secrets.
      `supabase secrets list` should show only `ANTHROPIC_API_KEY`,
      `ANTHROPIC_WORKSPACE_ID` (if used), `USDA_API_KEY`, `SWEEP_SECRET` and
      the optional `AI_DAILY_LIMIT`, `UPLOAD_HOURLY_LIMIT`, `ALLOWED_ORIGINS`
      (plus the `SUPABASE_*` ones Supabase adds itself).
- [ ] The daily `sweep-storage` Cron job sends `x-sweep-secret`, not the
      service-role key (GO_LIVE.md, "Photo uploads and cleanup").
- [ ] Before turning Phase 2 tagging on: in Google Cloud, restrict the Places
      key to the iOS bundle id `com.niblgo.app` (and the Android package) and
      to the Places API only, and set a daily quota. It ships in the app, so
      the restrictions are the only thing stopping someone else spending it.
- [ ] Turn on GitHub secret scanning and push protection for the repo
      (Settings → Code security), so a pasted key is stopped at `git push`.
- [ ] Publish a moderation contact and community guidelines (see
      MODERATION.md for the remaining UGC gaps).
- [ ] Run `supabase/tests/` against a scratch Postgres after any schema change,
      above all `rls_attack_test.sql` (see `supabase/tests/README.md`).
- [ ] Paste `supabase/verify.sql` into the SQL Editor after migrating: its
      "locked:" rows confirm the 0030 to 0033 holes are closed on the real
      project.
- [ ] Never add the chat tables to Realtime (Database → Publications); verify.sql
      flags it if someone does.

## Reporting

Found something? Email the address on the repo owner's GitHub profile rather
than opening a public issue.
