# Database security tests

Run the real `schema.sql` against a throwaway local Postgres and assert the
security properties that matter, so a future schema edit can't quietly undo
them.

## e2e/: the whole backend, attacked for real

```bash
npm run test:e2e        # or: supabase/tests/e2e/run.sh
```

Starts a private copy of the backend and attacks it through the same front
door the app uses, with three identities: **User A** owns the data, **User B**
is a separate, unrelated account, **User C** is signed out (plus a few
supporting accounts: Alice's friends, one that deletes itself, one that gets
banned). What runs is real: Postgres 16 with `schema.sql`, the Supabase Auth
server (sign-up, sign-in, sign-out, tokens), the PostgREST API server with the
session check, all seven edge functions under Deno, and supabase-js as the
client. Storage is a stand-in that authorizes the way Supabase Storage does,
through the `storage.objects` policies (`gateway.mjs` explains), and Anthropic,
USDA and Expo push are stand-ins that count their calls.

It checks, with an expected and an actual result for each: B can't read A's
messages, change her collection or bookmarks, edit or delete her posts, get
her private photos or join her group; C can't call any protected function;
bad uploads are refused and nothing is stored; AI requests stop at the limit
(and refused ones cost nothing); and an old token stops working after sign-out,
account deletion or a ban. It also checks the public things stay public.
`e2e/RESULTS.md` is the latest run.

Linux only (it downloads Linux builds of PostgREST and Supabase Auth, cached in
`~/.cache/niblgo-e2e`); needs Postgres 16, Node, Deno and openssl. Set
`E2E_RESULTS=path.md` to write a results table.

## rls_attack_test.sql: start here

The main suite: 239 checks, self-asserting (it ends with an error if any fail).
Six separate accounts sign in the way the API does it, with their own tokens,
and an attacker with a normal account (Mallory, who follows the victim and has
her own posts and a DM with her) tries to read, change or delete other people's
data by id across every table: profiles, posts, recipes, comments, likes,
reposts, shares, saves, collections, DMs, group chats and their membership,
notifications, reports, feedback, streaks, push tokens, tags and photo storage.
It also checks the database as a whole: RLS on every table, no views, no policy
open to signed-out users, every SECURITY DEFINER function pinned, and exactly
which functions anon and signed-in users can call.

Writes are sent the way an attacker would (no RETURNING, like PostgREST's
`Prefer: return=minimal`): RETURNING adds a read check that can make a write
that actually succeeds look refused, which once hid a real hole here.

```bash
supabase/tests/run_security.sh            # fresh install from schema.sql
supabase/tests/run_security.sh upgrade    # committed schema + migrations 0030+
```

It runs on `supabase_sim.sql`, a stand-in for Supabase that matters more than it
looks: it grants every new table and function to anon and authenticated the way
Supabase does by default, drives `auth.uid()` from the token, and makes
service_role bypass RLS. The older `harness.sql` grants by hand, which is how
"signed-in users can call is_following()" went unnoticed.

Before migration 0030 this suite failed 32 checks; the worst was a DM member
moving their own membership row into any other thread and reading it.

Sections 13-16 cover photo storage (migration 0031): nobody can upload
straight into storage, list or touch other people's files, or read a DM photo
from a chat they're not in; saved photo links must be real uploads in your own
space (no outside servers, no copying someone else's photo); and
`storage_orphans()` finds exactly the files nothing uses.

Section 17 covers chats (migration 0032): after leaving a group you can't read
its photos, members or messages, or send, react or rename; reactions can't be
moved into a thread you're not in; groups stop at 32 people; only Activity is
broadcast live; a message is pushed once, only by the server, only into the
thread it was sent in, and never by someone who has left; push tokens must be
real and belong to one account.

Section 18 covers sessions (migration 0033): `check_request()`, which
PostgREST runs before every request, lets a live session through and refuses a
signed-out, deleted, soft-deleted, banned or timed-out one, a session that
belongs to someone else, a token naming no session or a malformed one, while
signed-out visitors and the server pass. It also checks the check is switched
on (`pgrst.db_pre_request` on the `authenticator` role).

Section 19 covers AI allowance and recipe data (migration 0034): the daily,
per-minute and app-wide limits trip where they should and only the server can
spend allowance; a recipe card whose ingredients, steps or nutrition aren't
the documented shape is refused, and a well-formed one still saves.

Section 20 covers spam and impersonation (migration 0035): DMs, comments and
feedback stop at their limits while someone else's are untouched, every table
people create rows in carries the limit, a double-tapped photo or comment
lands once, names and text can't hide direction-flipping or control
characters, and staff-looking handles are refused.

Section 21 deletes an account that has a bit of everything and checks nothing
anywhere still points at it (every foreign key to users), its posts, comments
and DMs are gone, its feedback is kept without its name, reports it filed or
that were filed about it survive without the account, and closed reports clear
their copy of the content once old enough (migration 0036).

The upload and cleanup functions have their own tests, run with `npm test`:
`test:jpeg` (real JPEGs pass and come out without EXIF/GPS; PNG, HTML, SVG,
disguised, truncated, appended-payload and decompression-bomb files are
refused), `test:ai` (request size, model timeouts, hostile or malformed model
replies, prompt echoes), `test:upload`, `test:sweep` and `test:notify` (the functions' rules,
with stand-ins for Supabase). `npm run test:functions` (needs Deno) runs every
edge function for real against a stand-in Supabase that records each call:
no token, the publishable key or a forged token gets 401 with nothing touched,
a user id in the request is never taken as identity, and only the server can
run the sweep.

## reports_test.sql

Covers the moderation guarantees documented in `MODERATION.md`:

| # | Property |
| --- | --- |
| 1 | A user can file a report |
| 2 | The same user cannot report one post twice |
| 3 | You cannot file a report in someone else's name |
| 4 | Different users can each report the same post |
| 5 | **A reported user cannot see reports against them** |
| 6 | A reporter sees only their own reports |
| 7 | **A reported user cannot delete reports against them** |
| 8 | A reporter cannot change a report's status |
| 9 | You cannot report your own post |
| 10 | **Deleting the post does NOT destroy the reports** (snapshot survives) |
| 11 | A moderator (service role) sees the full triage view |

## dm_test.sql

Direct messages are the most private rows in the app. Asserts:

| # | Property |
| --- | --- |
| 1 | A member can read their own thread |
| 2 | **A non-member sees no messages, conversations, or membership rows** |
| 3 | **A non-member cannot add themselves to someone else's thread** |
| 4 | A non-member cannot post into a thread |
| 5 | You cannot send a message as another user |
| 6 | You cannot delete someone else's message |
| 7 | An empty message (no text, no shared post) is rejected |
| 8 | Starting a brand-new thread still works |
| 9 | Deleting a shared post clears the attachment but keeps the message |

Test 3 caught a real hole during development: an earlier policy allowed
`user_id = auth.uid()` on insert, which let anyone join a stranger's thread
and read the whole history. Membership now requires either already being in
the thread or the thread being empty.

## Not a test, but nearby: verify.sql

`supabase/verify.sql` is the read-only counterpart to these. It runs against a
real project (paste it into the Supabase SQL Editor) and reports whether the
tables, policy counts, functions, notification triggers, migration columns and
the photo bucket's limits are all as they should be. Use it after setting up or
migrating a database; use the tests below to check the rules themselves.

## dm_follow_test.sql

DMs are opt-in: you can only *start* a thread with someone you follow, but
once a thread exists both sides can talk. Asserts:

| # | Property |
| --- | --- |
| 1 | You can open a thread with someone you follow |
| 2 | A private account can still start threads (`is_following` is SECURITY DEFINER) |
| 3 | **A stranger cannot open a thread with you** |
| 4 | The person you messaged can reply without following you back |
| 5 | Unfollowing does not lock you out of a thread you already have |
| 6 | A stranger still cannot add themselves to an existing thread |
| 7 | You can report a message from a thread |
| 8 | **Deleting the message does NOT destroy the report** (snapshot survives) |
| 9 | Nobody can read anyone else's reports |
| 10 | Nobody can report themselves |

Test 2 is the one worth keeping: the follow check has to be SECURITY DEFINER,
because the RLS policy on `follows` hides rows belonging to private accounts —
a plain subquery would have silently stopped private accounts from ever
starting a conversation.

## blocks_test.sql

| # | Property |
| --- | --- |
| 1-2 | **Blocking is symmetric**: neither party sees the other's posts |
| 3 | The blocked user's comments are hidden too |
| 4 | A blocked user cannot re-follow |
| 5-6 | Neither side can message through an existing DM thread |
| 7 | **A blocked user cannot tell they were blocked** |
| 8 | ...and cannot delete the block |
| 9 | The blocker sees their own block |
| 10 | Nobody can block themselves |
| 11 | Unblocking restores visibility |

## notifications_test.sql

Notifications are the one table the app can never write to: rows come from
`AFTER INSERT` triggers on reactions, comments, reposts and shares, and there
is deliberately no insert policy at all. Asserts:

| # | Property |
| --- | --- |
| 1 | Liking a post notifies its owner |
| 2 | Unliking and re-liking does **not** stack a duplicate |
| 3 | Every comment is its own notification |
| 4 | Reposts and shares notify too |
| 5 | Your own activity never notifies you |
| 6 | **Nobody can read anyone else's notifications** |
| 7 | **Nobody can forge one** — there is no insert policy |
| 8 | Nobody can mark someone else's as read |
| 9 | You can mark yours read, but cannot readdress them to someone else |
| 10 | **Blocking hides notifications the blocked user already caused**, and new ones never land |
| 11 | Deleting a post takes its notifications with it |
| 12 | You can clear your own |

Test 10 is why the block test lives in the RLS policy rather than in the app:
put it in the client and blocking someone would leave their old notifications
sitting in your list, and the badge count would disagree with the list.

## hardening_test.sql

| # | Property |
| --- | --- |
| 1 | **A private follower list cannot be enumerated by a third party** |
| 2 | ...but counts stay public via `follow_counts()` |
| 3 | The owner still sees their own full list |
| 4 | `photo_url` rejects `javascript:` / `data:`, accepts `https:` |
| 5 | Over-long bio and blurb rejected |
| 6 | Forged streaks rejected |
| 7 | The AI quota ledger is unreadable, unwritable, and its function is service-role only |
| 8 | Post owners can moderate comments on their own posts |
| 9 | The storage bucket caps size and MIME type |
| 10 | The AI daily quota actually cuts off at the limit |

## Running

Needs a local `postgres` + `psql` (verified on 16). Nothing touches Supabase.

```bash
export PATH=$PATH:/usr/lib/postgresql/16/bin
BASE=/var/tmp/niblpg
rm -rf "$BASE" && mkdir -p "$BASE" && chown postgres "$BASE" && chmod 700 "$BASE"

su postgres -c "initdb -D $BASE/data -A trust"
su postgres -c "pg_ctl -D $BASE/data -l $BASE/pg.log -o '-k $BASE -p 5433 -c listen_addresses=' -w start"

# harness.sql fakes the Supabase-managed bits (auth.uid(), storage.*, roles)
su postgres -c "psql -h $BASE -p 5433 -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/harness.sql"
su postgres -c "psql -h $BASE -p 5433 -d postgres -v ON_ERROR_STOP=1 -f supabase/schema.sql"
su postgres -c "psql -h $BASE -p 5433 -d postgres -f supabase/tests/reports_test.sql"

su postgres -c "pg_ctl -D $BASE/data stop"
```

## Reading the output

The `ERROR:` lines are the point — each is the database refusing something it
should refuse. A clean run prints **4** of them (tests 2, 3, 9, and the
duplicate in 2), plus `DELETE 0` / `UPDATE 0` for 7 and 8, `0` rows for test 5,
and **2 surviving reports** in test 10. If an expected refusal disappears, a
control has regressed.

`harness.sql` drives `auth.uid()` from a `test.uid` GUC, so `set test.uid =
'<uuid>'` is how each test "signs in" as a different user.
