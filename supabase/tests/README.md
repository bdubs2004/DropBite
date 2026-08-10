# Database security tests

Run the real `schema.sql` against a throwaway local Postgres and assert the
security properties that matter, so a future schema edit can't quietly undo
them.

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
