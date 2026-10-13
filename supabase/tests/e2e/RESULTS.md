# End-to-end security verification: last run

Run 2026-10-13 20:13 UTC with `supabase/tests/e2e/run.sh`: Postgres 16 + schema.sql, Supabase Auth v2.177.0, PostgREST 12.2.3, the seven edge functions on Deno, supabase-js as the client. Storage is a stand-in that authorizes through the same storage.objects policies (gateway.mjs).

User A owns the data; User B is a separate, unrelated account; User C is signed out.

**78 of 78 checks passed.**

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
| afterwards A's collection is exactly as it was | owner A, name "Weeknight dinners" | {"id":"742d569a-ada4-4269-bbd3-ac4d0b80599a","user_id":"f9b8e22c-31a4-4a5e-9807-1fef391d4919","name":"Weeknight dinners"} | PASS |
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
| afterwards A's post is untouched | unchanged | {"blurb":"Alice's garlic chicken","user_id":"f9b8e22c-31a4-4a5e-9807-1fef391d4919"} | PASS |
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
