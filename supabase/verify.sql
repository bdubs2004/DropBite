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
         ('conversation_members', 3), ('conversations', 2), ('follows', 3),
         ('messages', 3), ('notifications', 3), ('posts', 4), ('reactions', 3),
         ('recipes', 4), ('reports', 2), ('reposts', 3), ('saved_posts', 3),
         ('shares', 3), ('streaks', 1), ('users', 4)
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
    ('notifications','read_at',               '0009_notifications.sql'),
    ('recipes',      'servings',              '0012_nutrition.sql'),
    ('recipes',      'nutrition',             '0012_nutrition.sql'),
    ('recipes',      'nutrition_source',      '0012_nutrition.sql'),
    ('reports',      'comment_id',            '0013_report_comments_and_accounts.sql'),
    ('reports',      'comment_text_snapshot', '0013_report_comments_and_accounts.sql'),
    ('comments',     'image_url',             '0015_comment_photos.sql'),
    ('comments',     'parent_id',             '0016_comment_replies.sql')
),

-- Functions the policies call. A missing one breaks every policy that uses it.
expected_functions(name) as (
  values ('is_blocked_pair'), ('is_conversation_member'), ('conversation_is_empty'),
         ('conversation_has_block'), ('is_following'), ('follow_counts'),
         ('consume_ai_quota'), ('notify_post_interaction'), ('notify_comment'),
         ('can_reply_under'), ('stamp_created_at'), ('bump_streak'),
         ('prepare_report'), ('prepare_feedback'),
         ('check_photo_links'), ('storage_orphans'), ('consume_upload_quota')
),

-- The triggers are the only thing that writes notifications. Without them the
-- Activity screen stays empty forever and nothing tells you why.
expected_triggers(name, tbl, fixed_by) as (
  values ('reactions_notify', 'reactions', '0009_notifications.sql'),
         ('reposts_notify', 'reposts', '0009_notifications.sql'),
         ('shares_notify', 'shares', '0009_notifications.sql'),
         ('comments_notify', 'comments', '0009_notifications.sql'),
         -- Server-owned dates, streaks and report facts (0030).
         ('posts_stamp_created_at', 'posts', '0030_rls_hardening.sql'),
         ('messages_stamp_created_at', 'messages', '0030_rls_hardening.sql'),
         ('conversations_stamp_activity', 'conversations', '0030_rls_hardening.sql'),
         ('posts_bump_streak', 'posts', '0030_rls_hardening.sql'),
         ('reports_prepare', 'reports', '0030_rls_hardening.sql'),
         ('feedback_prepare', 'feedback', '0030_rls_hardening.sql'),
         -- Photo links must be real uploads (0031).
         ('posts_check_photo_links', 'posts', '0031_storage_hardening.sql'),
         ('users_check_photo_links', 'users', '0031_storage_hardening.sql'),
         ('comments_check_photo_links', 'comments', '0031_storage_hardening.sql'),
         ('messages_check_photo_links', 'messages', '0031_storage_hardening.sql')
),

-- Three storage policies by design, and deliberately no INSERT or UPDATE
-- policy: only the upload-photo function (service role) writes files, and
-- nothing is ever overwritten. Reading is your own folder in `photos` (public
-- photos load by URL without any policy), and chats you're in for dm-photos.
expected_storage_policies(name) as (
  values ('read own photos'), ('delete own photos'), ('read photos in own chats')
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
    ) then 'OK' else 'MISSING — run ' || fixed_by end
  from expected_triggers

  union all

  -- The bucket's size and MIME limits are the controls that stop someone
  -- uploading an HTML file to a public origin on your own domain.
  select 6, 'storage bucket: ' || want.id,
    case
      when b.id is null then 'MISSING — run 0031_storage_hardening.sql'
      when b.public <> want.public then
        case when want.public then 'NOT PUBLIC — photos will not load in the app'
             else 'PUBLIC — DM photos would be open to anyone with the link' end
      when b.file_size_limit is distinct from 10485760 then
        'SIZE LIMIT IS ' || coalesce(b.file_size_limit::text, 'unset') || ', expected 10485760'
      when b.allowed_mime_types is distinct from array['image/jpeg'] then
        'ACCEPTS ' || coalesce(array_to_string(b.allowed_mime_types, ', '), 'ANY TYPE')
          || ' — expected image/jpeg only; run 0031_storage_hardening.sql'
      else 'OK'
    end
  from (values ('photos', true), ('dm-photos', false)) want(id, public)
  left join storage.buckets b on b.id = want.id

  union all

  select 7, 'storage policy: ' || e.name,
    case when exists (
      select 1 from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects' and p.polname = e.name
    ) then 'OK' else 'MISSING — run schema.sql' end
  from expected_storage_policies e

  union all

  -- The holes 0030 closed. Each is a single privilege, so each is checked
  -- directly: a database can have every policy above and still be open here.
  select 8, 'locked: ' || item,
    case when open then problem || ' — run 0030_rls_hardening.sql' else 'OK' end
  from (values
    ('DM membership can''t be moved',
     has_column_privilege('authenticated', 'public.conversation_members', 'conversation_id', 'UPDATE'),
     'A MEMBER CAN MOVE INTO ANY THREAD AND READ IT'),
    ('streaks are written by the database only',
     has_table_privilege('authenticated', 'public.streaks', 'INSERT')
       or has_table_privilege('authenticated', 'public.streaks', 'UPDATE'),
     'ANYONE CAN SET THEIR OWN STREAK'),
    ('photos can''t be listed by everyone',
     exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname = 'objects' and c.relnamespace = 'storage'::regnamespace
               and p.polname = 'photos public read'),
     'ANYONE CAN LIST EVERY PHOTO, DM PHOTOS INCLUDED'),
    ('follow graph helper is private',
     has_function_privilege('authenticated', 'public.is_following(uuid, uuid)', 'EXECUTE'),
     'ANYONE CAN READ PRIVATE FOLLOW LISTS'),
    ('profiles: only editable fields change',
     has_column_privilege('authenticated', 'public.users', 'created_at', 'UPDATE'),
     'USERS CAN CHANGE PROTECTED PROFILE FIELDS')
  ) v(item, open, problem)

  union all

  -- And the ones 0031 closed.
  select 9, 'locked: ' || item,
    case when open then problem || ' — run 0031_storage_hardening.sql' else 'OK' end
  from (values
    ('nobody uploads straight into storage',
     exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
             where c.relname = 'objects' and c.relnamespace = 'storage'::regnamespace
               and p.polcmd in ('a', '*')),
     'CLIENTS CAN UPLOAD ANY FILE, SKIPPING THE PHOTO CHECKS'),
    ('the orphan finder is server-only',
     has_function_privilege('authenticated', 'public.storage_orphans(interval, text)', 'EXECUTE'),
     'SIGNED-IN USERS CAN LIST EVERY STORED FILE')
  ) v(item, open, problem)

  union all

  -- Not a hole, but photo links can't be saved until it's recorded: deploy
  -- upload-photo and post one photo, and it fills itself in.
  select 10, 'setting: storage origin',
    case when exists (select 1 from public.app_config where key = 'storage_origin')
      then 'OK' else 'NOT SET YET — deploy upload-photo and upload one photo' end
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
