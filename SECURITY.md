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
      was turned off for testing.
- [ ] Raise the Supabase minimum password length to **8** to match the app.
- [ ] Set `ALLOWED_ORIGINS` on both edge functions if you ship a web build;
      otherwise CORS stays `*`.
- [ ] Set `AI_DAILY_LIMIT` to whatever you're willing to pay for.
- [ ] Confirm leaked-password protection is on (Authentication → Policies).
- [ ] Turn on Supabase auth rate limiting.
- [ ] Confirm the `service_role` key exists **only** in function secrets.
- [ ] Publish a moderation contact and community guidelines (see
      MODERATION.md for the remaining UGC gaps).
- [ ] Run `supabase/tests/` against a scratch Postgres after any schema change,
      above all `rls_attack_test.sql` (see `supabase/tests/README.md`).
- [ ] Paste `supabase/verify.sql` into the SQL Editor after migrating: its
      "locked:" rows confirm the 0030 holes are closed on the real project.

## Reporting

Found something? Email the address on the repo owner's GitHub profile rather
than opening a public issue.
