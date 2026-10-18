# End-to-end security verification: last run

Run 2026-10-18 17:41 UTC with `supabase/tests/e2e/run.sh`: Postgres 16 + schema.sql, Supabase Auth v2.177.0, PostgREST 12.2.3, the seven edge functions on Deno, supabase-js as the client. Storage is a stand-in that authorizes through the same storage.objects policies (gateway.mjs).

User A owns the data; User B is a separate, unrelated account; User C is signed out.

**148 of 148 checks passed.**

## 1. User B requests User A's private messages

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B reads the messages in A's DM | denied (0 rows) | 0 row(s) | PASS |
| B asks for A's message by its id | denied (0 rows) | 0 row(s) | PASS |
| B searches every message for "key" | denied (0 rows) | 0 row(s) | PASS |
| B reads A's conversation itself | denied (0 rows) | 0 row(s) | PASS |
| B reads who is in A's DM | denied (0 rows) | 0 row(s) | PASS |
| B makes the server push A's message | nothing sent | sent 0 | PASS |
| control: Dana, who is in the DM, reads it | 1 row | 1 row(s) | PASS |

## 2. User B changes the ID (and owner) of User A's collection

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B makes A's collection his (changes user_id) | denied (0 rows changed) | 0 row(s) | PASS |
| B changes the collection's id | denied (0 rows changed) | 0 row(s) | PASS |
| B renames it | denied (0 rows changed) | 0 row(s) | PASS |
| B deletes it | denied (0 rows deleted) | 0 row(s) | PASS |
| B adds a post to it | denied (error) | error: new row violates row-level security policy for table "collection_posts" | PASS |
| afterwards A's collection is exactly as it was | owner A, name "Weeknight dinners" | {"id":"1a55c8ca-07f3-4d46-94b6-c63e11ab8728","user_id":"11e6d333-9745-4926-b4fe-615f4845d06b","name":"Weeknight dinners"} | PASS |
| B reads A's saved posts (the private list) | denied (0 rows) | 0 row(s) | PASS |
| B clears A's saved posts | denied (0 rows) | 0 row(s) | PASS |
| control: A still sees her saved post | 1 row | 1 row(s) | PASS |

## 3. User B edits or deletes User A's post

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B edits A's caption | denied (0 rows changed) | 0 row(s) | PASS |
| B takes ownership of A's post | denied (0 rows changed) | 0 row(s) | PASS |
| B deletes A's post | denied (0 rows deleted) | 0 row(s) | PASS |
| B posts as A (user_id = A) | denied (error) | error: Upload photos with the app. | PASS |
| B edits A's profile | denied (0 rows changed) | 0 row(s) | PASS |
| afterwards A's post is untouched | unchanged | {"blurb":"Alice's garlic chicken","user_id":"11e6d333-9745-4926-b4fe-615f4845d06b"} | PASS |
| control: A edits her own post | 1 row changed | 1 row(s) | PASS |

## 4. User B tries to get User A's private photos

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B asks for a link to A's DM photo (knowing its exact path) | denied (no link) | link: Either the object does not exist or you do not have permissions | PASS |
| B downloads it directly with his login | denied | HTTP 400 | PASS |
| anyone fetches it as a public link | denied (the bucket is private) | HTTP 400 | PASS |
| B lists the files in A's chat | denied (0 files) | 0 file(s) | PASS |
| B uploads a photo into A's chat | denied (403) | HTTP 403 {"error":"not_allowed"} | PASS |
| B deletes A's DM photo | denied (0 deleted, still there) | 0 deleted | PASS |
| B uploads straight into A's photo folder | denied | error: new row violates row-level security policy for table "objects" | PASS |
| control: Dana, in the chat, gets a link and opens the photo | 200 | HTTP 200 | PASS |
| design: A's public post photo opens for anyone with its link | 200 | HTTP 200 | PASS |

## 5. User C (signed out) calls protected backend functions

| Check | Expected | Got | |
| --- | --- | --- | --- |
| C calls upload-photo | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls format-recipe | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls lookup-nutrition | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls notify-message | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls notify-activity | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls delete-account | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C calls sweep-storage | denied (401) | HTTP 401 with the app key, 401 with nothing | PASS |
| C starts a chat with A (database function) | denied (error) | error: permission denied for function start_conversation | PASS |
| C reads messages | denied | 0 row(s) | PASS |
| C lists users (and their details) | denied (the app is for signed-in users) | 0 row(s) | PASS |
| C posts as A | denied (error) | error: Upload photos with the app. | PASS |
| design: C opens a shared post link (preview card) | 1 row (share links work signed out) | 1 row(s) | PASS |

## 6. User B tries to add himself to User A's private group

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B inserts himself as a member | denied (error) | error: new row violates row-level security policy for table "conversation_members" | PASS |
| B starts a group with the same people | denied (he follows none of them) | error: You can only message people you follow. Follow them first. | PASS |
| B moves his membership from his own chat into A's group | denied | error: permission denied for table conversation_members | PASS |
| B posts into A's group | denied (error) | error: new row violates row-level security policy for table "messages" | PASS |
| B renames A's group | denied (0 rows) | 0 row(s) | PASS |
| afterwards the group is still A, Dana and Eli | 3 members, not Bob | 3 members | PASS |

## 7. Invalid or oversized uploads

| Check | Expected | Got | |
| --- | --- | --- | --- |
| a PNG sent as a JPEG | rejected (415) | HTTP 415 {"error":"not_a_jpeg"} | PASS |
| an HTML page renamed to .jpg | rejected (415) | HTTP 415 {"error":"not_a_jpeg"} | PASS |
| a truncated JPEG | rejected (415) | HTTP 415 {"error":"not_a_jpeg"} | PASS |
| an 11 MB upload (limit 10 MB) | rejected (413) | HTTP 413 {"error":"too_large"} | PASS |
| an empty upload | rejected (4xx) | HTTP 415 {"error":"not_a_jpeg"} | PASS |
| an unknown photo kind | rejected (400) | HTTP 400 {"error":"bad_kind"} | PASS |
| uploading straight to storage, skipping the checks | denied | error: new row violates row-level security policy for table "objects" | PASS |
| none of those stored a file | 0 files | 0 file(s) stored | PASS |
| a real JPEG with a comment and a payload appended | accepted, cleaned (payload and metadata removed) | HTTP 200; stored 408 bytes, payload removed | PASS |

## 8. Excessive AI requests

| Check | Expected | Got | |
| --- | --- | --- | --- |
| A asks for 8 recipe cards in a row (limit 6 a minute) | 6 × 200, then 429 rate_limited | 200, 200, 200, 200, 200, 200, 429 rate_limited, 429 rate_limited | PASS |
| the AI provider was called only for the allowed ones | 6 calls (refused requests cost nothing) | 6 calls | PASS |
| analytics: the 6 cards made are recorded, the 2 refused ones aren't | 6 | 6 recorded | PASS |
| nutrition shares the same allowance | 429 (rate limited) | HTTP 429 | PASS |
| an oversized blurb (2,001 characters) | rejected (400), no AI call | HTTP 400, 0 AI calls | PASS |
| a blurb that gets the model to repeat its instructions | dropped (502), instructions never returned | HTTP 502 {"error":"unparseable"} | PASS |

## 9. Reusing a session after signing out, deleting the account, or a ban

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B's token works while he is signed in | 1 row | 1 row(s) | PASS |
| after signing out, the old token reads data | denied (401 session_ended) | HTTP 401 session_ended | PASS |
| after signing out, the old token calls a database function | denied (401) | HTTP 401 | PASS |
| after signing out, the old token calls an edge function | denied (401) | HTTP 401 | PASS |
| after signing out, the old refresh token gets a new session | denied | error: Invalid Refresh Token: Refresh Token Not Found | PASS |
| Zoe deletes her account (through the app's function) | ok | {"ok":true,"photos_removed":0,"photos_pending":false} | PASS |
| the deleted account's old token reads data | denied (401) | HTTP 401 | PASS |
| the deleted account's old token uploads a photo | denied (401) | HTTP 401 | PASS |
| the deleted account signs in again | denied | error: Invalid login credentials | PASS |
| a moderator bans Ben; his existing token reads data | denied (401) at once | ban HTTP 200; read HTTP 401 | PASS |

## 10. Public by design: still works

| Check | Expected | Got | |
| --- | --- | --- | --- |
| B (any signed-in user) sees A's public post | 1 row | 1 row(s) | PASS |
| B sees A's public profile | 1 row | 1 row(s) | PASS |
| B sees A's collection (collections show on profiles) | 1 row | 1 row(s) | PASS |
| …but never her email (not a profile column) | error (no such column) | error: column users.email does not exist | PASS |

## 11. Everyday features still work after the hardening

| Check | Expected | Got | |
| --- | --- | --- | --- |
| A tags Dana in her post | ok | ok | PASS |
| …Dana gets a "tagged you" notification | 1 | 1 tag notification(s) | PASS |
| …and everyone can see who is tagged | Dana listed | 1 row(s) | PASS |
| …but B can't tag himself (or anyone) on A's post | denied | error: new row violates row-level security policy for table "post_tags" | PASS |
| Dana removes herself from the tag | 1 row | 1 row(s) | PASS |
| A adds #greek #healthy to her post | ok | ok | PASS |
| …B finds it by searching #greek | 1 row | 1 row(s) | PASS |
| …but B can't change A's hashtags | denied (0 rows changed) | 0 row(s) | PASS |
| a hashtag that isn't on the list is refused | denied | error: Pick hashtags from the list. | PASS |
| more than 5 hashtags are refused | denied | error: A post can have up to 5 hashtags. | PASS |
| B can't add his own tag to the list | denied | error: permission denied for table hashtags | PASS |
| signed out, searching a hashtag finds nothing | none | 0 row(s) | PASS |
| A marks her dish $ (cost to make) | ok | ok | PASS |
| …B finds it filtering by $ and #greek together | 1 row | 1 row(s) | PASS |
| …but B can't change what A's dish cost | denied (0 rows changed) | 0 row(s) | PASS |
| a price of $$$$ (4) is refused | denied | error: new row for relation "posts" violates check constraint "posts_price_level_range" | PASS |
| the old #budget hashtag is refused (price has its own place now) | denied | error: Pick hashtags from the list. | PASS |
| B likes A's post | ok | ok | PASS |
| …A gets a like notification | from B | checked | PASS |
| …and a push for it goes to Alice's phone | a push to Alice | "Bob liked your post" | PASS |
| B comments on A's post | ok | ok | PASS |
| A replies to the comment | ok | ok | PASS |
| A likes B's comment | ok | ok | PASS |
| B follows A | ok | ok | PASS |
| …A gets a follow notification | from B | checked | PASS |
| B reposts A's post | ok | ok | PASS |
| B shares A's post | ok | ok | PASS |
| B saves A's post | ok | ok | PASS |
| A saves a recipe card with nutrition on her post | ok | ok | PASS |
| …and others see the card | 1 card | 1 row(s) | PASS |
| Format recipe makes a card | a card | "Garlic chicken", 2 ingredients | PASS |
| Estimate nutrition works | USDA numbers | source usda, 150 kcal | PASS |
| B edits his profile with a new avatar | ok | ok | PASS |
| Dana replies in the DM | ok | ok | PASS |
| …Alice gets a push with the message | 1 push to Alice | 1 push to ExponentPushToken[alice-phone]: "got it, thanks!" | PASS |
| A reacts to Dana's message | ok | ok | PASS |
| Eli posts in the group | ok | ok | PASS |
| A names the group | 1 row | 1 row(s) | PASS |
| Eli leaves the group, and can no longer read it | ok; 0 rows | ok; 0 row(s) after | PASS |
| A's streak counted her post | at least 1 | {"current_streak":1} | PASS |
| Dana reports a post | ok | ok | PASS |
| Dana sends feedback | ok | ok | PASS |
| Dana posts, then deletes her own post | ok; 1 deleted | ok; 1 row(s) deleted | PASS |
| A blocks B, and B no longer sees her posts | ok; 0 rows | ok; B sees 0 row(s) | PASS |

## 13. Analytics: recorded as the app does it, private to everyone else

| Check | Expected | Got | |
| --- | --- | --- | --- |
| A opens the app: one visit recorded for A | ok; 1 | ok; 1 | PASS |
| Dana sees A's post: recorded once, however often she sees it | 1, then 0 | 1, then 0 | PASS |
| A seeing her own post isn't a view | 0 | 0 | PASS |
| B, whom A blocked, seeing her post isn't recorded | 0 | 0 | PASS |
| an event the app doesn't have is refused | refused | error: Unknown event | PASS |
| B can't record anything for A (server-only call) | refused | error: permission denied for function log_server_event | PASS |
| signed out, nothing can be recorded | refused | error: permission denied for function log_event | PASS |
| the analytics schema isn't reachable through the API | refused | error: The schema must be one of the following: public | PASS |
| B shares an invite | ok | ok | PASS |
| Gina signs up with Bob's handle as her invite code: Bob gets the referral, once | ok, then already; source referral | ok, then already; source referral | PASS |

## 12. Password reset, through the real email

| Check | Expected | Got | |
| --- | --- | --- | --- |
| the app asks for a reset email | ok | ok | PASS |
| …the email arrives (the production template), linking to niblgo.com/auth/reset with the code after the # | https://niblgo.com/auth/reset#token_hash=…&type=recovery | https://niblgo.com/auth/reset#token_hash=…&type=recovery | PASS |
| …and nothing in the email can use the reset up just by being opened (no Supabase link in it) | no Supabase link | no Supabase link | PASS |
| …tapping the button swaps the code for a session | HTTP 200 with a session | HTTP 200 | PASS |
| …the app signs in with it | ok | ok | PASS |
| …and sets the new password | ok | ok | PASS |
| …choosing the password she already has is refused as the same password (the app says so) | same_password | same_password: New password should be different from the old password. | PASS |
| Riley signs in with the new password | ok | ok | PASS |
| …and the old one no longer works | refused | error: Invalid login credentials | PASS |
| the same code a second time is refused (one use) | refused | HTTP 403 | PASS |
| a reset asked to go to another site still links only to niblgo.com | niblgo.com link, no other site | niblgo.com link | PASS |
| after a newer email, the older one is refused (use the newest email) | refused | HTTP 403 | PASS |
| …and the newest one works | HTTP 200 | HTTP 200 | PASS |
| a made-up code does nothing | refused | HTTP 403 | PASS |
| asking for an email that has no account looks the same (no way to tell who has one) | ok, same as a real account | ok | PASS |
