-- NiblGo: is my database set up correctly?
--
-- Paste the whole file into the Supabase SQL Editor and run it. It changes
-- nothing — it only reports.
--
-- Deliberately ONE query, with no psql backslash commands. The SQL Editor
-- shows only the last statement's result and does not understand \pset, so
-- separate SELECTs would hide every check but the last one.
--
-- The first row is a summary. Anything not OK sorts to the top and names the
-- file that fixes it.

with

-- The second number is how many policies that table should have. Counting
-- catches a policy that went missing on its own, which "does it have any?"
-- would sail straight past. Update these if you change schema.sql.
expected_tables(name, policies) as (
  values ('blocks', 3), ('comment_reactions', 3), ('comments', 3),
         ('conversation_members', 4), ('conversations', 3), ('follows', 3),
         ('messages', 3), ('notifications', 3), ('posts', 4), ('reactions', 3),
         ('recipes', 4), ('reports', 2), ('reposts', 3), ('saved_posts', 3),
         ('shares', 3), ('streaks', 3), ('users', 4)
  -- ai_usage is checked separately: it deliberately has NO policies, because
  -- only the SECURITY DEFINER quota function is allowed to touch it.
),

-- Columns added by later migrations. A table can exist and still be out of
-- date, which `create table if not exists` will not fix — that is what the
-- files in supabase/migrations/ are for.
expected_columns(tbl, col, fixed_by) as (
  values
    ('users',        'follows_private',       '0006_security_hardening.sql'),
    ('messages',     'image_url',             '0007_message_images.sql'),
    ('reports',      'message_id',            '0008_dm_follow_and_reports.sql'),
    ('reports',      'message_text_snapshot', '0008_dm_follow_and_reports.sql'),
    ('notifications','read_at',               '0009_notifications.sql')
),

-- Functions the policies call. A missing one breaks every policy that uses it.
expected_functions(name) as (
  values ('is_blocked_pair'), ('is_conversation_member'), ('conversation_is_empty'),
         ('conversation_has_block'), ('is_following'), ('follow_counts'),
         ('consume_ai_quota'), ('notify_post_interaction'), ('notify_comment')
),

-- The triggers are the only thing that writes notifications. Without them the
-- Activity screen stays empty forever and nothing tells you why.
expected_triggers(name, tbl) as (
  values ('reactions_notify', 'reactions'), ('reposts_notify', 'reposts'),
         ('shares_notify', 'shares'), ('comments_notify', 'comments')
),

-- Three storage policies by design. There is deliberately no UPDATE policy:
-- uploads always use a fresh path, so nobody needs to overwrite an existing
-- object — and without the policy, nobody can.
expected_storage_policies(name) as (
  values ('photos public read'), ('upload own photos'), ('delete own photos')
),

tables as (
  select
    e.name,
    e.policies as want,
    c.oid is not null as present,
    coalesce(c.relrowsecurity, false) as rls_on,
    (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
  from expected_tables e
  left join pg_class c
    on c.relname = e.name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
),

checks(grp, item, status) as (

  select 1, 'table: ' || name,
    case
      when not present then 'MISSING — run schema.sql'
      when not rls_on  then 'NO ROW-LEVEL SECURITY — anyone could read this table'
      when policies = 0 then 'NO POLICIES — with RLS on, nothing can read or write it'
      when policies < want then
        'ONLY ' || policies || ' OF ' || want || ' POLICIES — re-run schema.sql'
      when policies > want then
        policies || ' POLICIES, EXPECTED ' || want || ' — check for one added by hand'
      else 'OK (' || policies || ' policies)'
    end
  from tables

  union all

  -- ai_usage is the one table that should have no policies at all. Grants are
  -- revoked and only consume_ai_quota() writes to it, so a policy here would be
  -- a way in, not a protection.
  select 2, 'table: ai_usage (locked down)',
    case
      when c.oid is null then 'MISSING — run schema.sql'
      when not c.relrowsecurity then 'NO ROW-LEVEL SECURITY — run schema.sql'
      when (select count(*) from pg_policy p where p.polrelid = c.oid) > 0
        then 'HAS POLICIES — it should have none; only consume_ai_quota() writes here'
      when has_table_privilege('authenticated', c.oid, 'SELECT')
        then 'READABLE BY SIGNED-IN USERS — run the revoke in schema.sql'
      else 'OK (no policies, grants revoked — as intended)'
    end
  from (select 1) one
  left join pg_class c
    on c.relname = 'ai_usage' and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'

  union all

  select 3, 'column: ' || tbl || '.' || col,
    case when exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = tbl and c.column_name = col
    ) then 'OK' else 'MISSING — run ' || fixed_by end
  from expected_columns

  union all

  select 4, 'function: ' || name,
    case when exists (
      select 1 from pg_proc p
      where p.proname = name and p.pronamespace = 'public'::regnamespace
    ) then 'OK' else 'MISSING — run schema.sql' end
  from expected_functions

  union all

  select 5, 'trigger: ' || name,
    case when exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
      where t.tgname = name and c.relname = tbl and not t.tgisinternal
    ) then 'OK' else 'MISSING — run 0009_notifications.sql' end
  from expected_triggers

  union all

  -- The bucket's size and MIME limits are the controls that stop someone
  -- uploading an HTML file to a public origin on your own domain.
  select 6, 'storage bucket: photos',
    case
      when b.id is null then 'MISSING — run schema.sql'
      when not b.public then 'NOT PUBLIC — photos will not load in the app'
      when b.file_size_limit is distinct from 10485760 then
        'SIZE LIMIT IS ' || coalesce(b.file_size_limit::text, 'unset') || ', expected 10485760'
      when b.allowed_mime_types is null then 'NO MIME RESTRICTION — any file type can be uploaded'
      else 'OK'
    end
  from (select 1) one
  left join storage.buckets b on b.id = 'photos'

  union all

  select 7, 'storage policy: ' || e.name,
    case when exists (
      select 1 from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects' and p.polname = e.name
    ) then 'OK' else 'MISSING — run schema.sql' end
  from expected_storage_policies e
)

-- Summary row first, then any failures, then the rest.
select item as check, status
from (
  select
    -1 as grp,
    'RESULT' as item,
    case when (select count(*) from checks where status not like 'OK%') = 0
      then 'PASS — all ' || (select count(*) from checks) || ' checks OK, your database is ready'
      else 'FAIL — ' || (select count(*) from checks where status not like 'OK%')
           || ' of ' || (select count(*) from checks) || ' checks need attention, see below'
    end as status
  union all
  select grp, item, status from checks
) rows
order by
  case when grp = -1 then 0 else 1 end,
  (status like 'OK%'),
  grp,
  item;
