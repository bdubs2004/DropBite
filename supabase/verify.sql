-- NiblGo: is my database set up correctly?
--
-- Paste this into the Supabase SQL Editor and run it. It changes nothing — it
-- only reports. Every row should say OK. Anything else tells you what to fix.
--
-- Run it after `schema.sql`, after any migration, or any time the app behaves
-- as though something is missing.

\pset pager off

-- The second number is how many policies that table should have. Counting
-- catches a policy that went missing on its own, which "does it have any?"
-- would sail straight past. Update these if you change schema.sql.
with expected_tables(name, policies) as (
  values ('blocks', 3), ('comment_reactions', 3), ('comments', 3),
         ('conversation_members', 4), ('conversations', 3), ('follows', 3),
         ('messages', 3), ('notifications', 3), ('posts', 4), ('reactions', 3),
         ('recipes', 4), ('reports', 2), ('reposts', 3), ('saved_posts', 3),
         ('shares', 3), ('streaks', 3), ('users', 4)
  -- ai_usage is checked separately: it deliberately has NO policies, because
  -- only the SECURITY DEFINER quota function is allowed to touch it.
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
)
select
  'table: ' || name as check,
  case
    when not present then 'MISSING — run schema.sql'
    when not rls_on  then 'NO ROW-LEVEL SECURITY — anyone could read this table'
    when policies = 0 then 'NO POLICIES — with RLS on, nothing can read or write it'
    when policies < want then
      'ONLY ' || policies || ' OF ' || want || ' POLICIES — re-run schema.sql'
    when policies > want then
      policies || ' POLICIES, EXPECTED ' || want || ' — check for one added by hand'
    else 'OK (' || policies || ' policies)'
  end as status
from tables
order by (case when not present or not rls_on or policies <> want then 0 else 1 end), name;

-- ai_usage is the one table that should have no policies at all. Grants are
-- revoked and only consume_ai_quota() writes to it, so a policy here would be
-- a way in, not a protection.
select
  'table: ai_usage (locked down)' as check,
  case
    when c.oid is null then 'MISSING — run schema.sql'
    when not c.relrowsecurity then 'NO ROW-LEVEL SECURITY — run schema.sql'
    when (select count(*) from pg_policy p where p.polrelid = c.oid) > 0
      then 'HAS POLICIES — it should have none; only consume_ai_quota() writes here'
    when has_table_privilege('authenticated', c.oid, 'SELECT') then
      'READABLE BY SIGNED-IN USERS — run the revoke in schema.sql'
    else 'OK (no policies, grants revoked — as intended)'
  end as status
from (select 1) x
left join pg_class c
  on c.relname = 'ai_usage' and c.relnamespace = 'public'::regnamespace and c.relkind = 'r';

-- Columns added by later migrations. A table can exist and still be out of
-- date, which `create table if not exists` will not fix — that is what the
-- files in supabase/migrations/ are for.
with expected_columns(tbl, col, fixed_by) as (
  values
    ('users',    'follows_private',            '0006_security_hardening.sql'),
    ('messages', 'image_url',                  '0007_message_images.sql'),
    ('reports',  'message_id',                 '0008_dm_follow_and_reports.sql'),
    ('reports',  'message_text_snapshot',      '0008_dm_follow_and_reports.sql'),
    ('notifications', 'read_at',               '0009_notifications.sql')
)
select
  'column: ' || tbl || '.' || col as check,
  case when exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = tbl and c.column_name = col
  ) then 'OK' else 'MISSING — run ' || fixed_by end as status
from expected_columns
order by 2 desc, 1;

-- Functions the policies call. A missing one breaks every policy that uses it.
with expected_functions(name) as (
  values ('is_blocked_pair'), ('is_conversation_member'), ('conversation_is_empty'),
         ('conversation_has_block'), ('is_following'), ('follow_counts'),
         ('consume_ai_quota'), ('notify_post_interaction'), ('notify_comment')
)
select
  'function: ' || name as check,
  case when exists (
    select 1 from pg_proc p
    where p.proname = name and p.pronamespace = 'public'::regnamespace
  ) then 'OK' else 'MISSING — run schema.sql' end as status
from expected_functions
order by 2 desc, 1;

-- The triggers are the only thing that writes notifications. Without them the
-- Activity screen stays empty forever and nothing tells you why.
with expected_triggers(name, tbl) as (
  values ('reactions_notify', 'reactions'), ('reposts_notify', 'reposts'),
         ('shares_notify', 'shares'), ('comments_notify', 'comments')
)
select
  'trigger: ' || name as check,
  case when exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
    where t.tgname = name and c.relname = tbl and not t.tgisinternal
  ) then 'OK' else 'MISSING — run 0009_notifications.sql' end as status
from expected_triggers
order by 2 desc, 1;

-- Photo storage. The size and MIME limits are the controls that stop someone
-- uploading an HTML file to a public origin on your domain.
select
  'storage bucket: photos' as check,
  case
    when b.id is null then 'MISSING — run schema.sql'
    when not b.public then 'NOT PUBLIC — photos will not load in the app'
    when b.file_size_limit is distinct from 10485760 then
      'SIZE LIMIT IS ' || coalesce(b.file_size_limit::text, 'unset') || ', expected 10485760'
    when b.allowed_mime_types is null then 'NO MIME RESTRICTION — any file type can be uploaded'
    else 'OK'
  end as status
from (select 1) x
left join storage.buckets b on b.id = 'photos';

-- Three by design. There is deliberately no UPDATE policy: uploads always use
-- a fresh path, so nobody needs to overwrite an existing object — and without
-- the policy, nobody can.
with expected_storage_policies(name) as (
  values ('photos public read'), ('upload own photos'), ('delete own photos')
)
select
  'storage policy: ' || e.name as check,
  case when exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and p.polname = e.name
  ) then 'OK' else 'MISSING — run schema.sql' end as status
from expected_storage_policies e
order by 2 desc, 1;
