-- Security test: can one signed-in user read, change or delete another's data?
--
-- Six separate accounts, each "signed in" with its own token the way the API
-- does it (see supabase_sim.sql). Mallory is the attacker throughout: she has a
-- normal account, follows Alice, and has her own posts and a DM with Alice, so
-- every attack runs from a realistic foothold rather than as a stranger.
--
--   alice    the victim: posts, a recipe, saves, a collection, DMs, a group
--   bob      Alice's friend: in her DM and group chat
--   carol    in the group chat
--   mallory  the attacker
--   eve      blocked by Alice
--   dave     keeps his follower list private
--
-- Every attempt runs in its own subtransaction and is rolled back, so tests
-- can't lean on each other. Each one says what must happen:
--   rows:N   the statement ran and touched/returned exactly N rows
--   denied   an error, or nothing touched (RLS hides rows rather than erroring)
--   error    the database refused outright
--
-- Run: supabase_sim.sql, then schema.sql, then this file, on an empty database.
-- It prints every check and ends with an error if any failed.

\set ON_ERROR_STOP 1
\pset pager off

-- ------------------------------------------------------------- framework
drop schema if exists qa cascade;
create schema qa;
create table qa.people (name text primary key, id uuid not null);
create table qa.results (
  n serial primary key, area text, name text, who text, want text, got text, passed boolean
);

insert into qa.people values
  ('alice',   'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bob',     'bbbbbbbb-0000-4000-8000-000000000002'),
  ('carol',   'cccccccc-0000-4000-8000-000000000003'),
  ('mallory', 'dddddddd-0000-4000-8000-000000000004'),
  ('eve',     'eeeeeeee-0000-4000-8000-000000000005'),
  ('dave',    'ffffffff-0000-4000-8000-000000000006');

-- Run `sql` as `who` ('anon' for signed out) and roll it back. A select must
-- produce one number (a count); an insert/update/delete is counted by the rows
-- it changed. Returns 'rows:N' or 'error:<message>'.
create function qa.attempt(who text, sql text) returns text language plpgsql as $$
declare
  n bigint;
  uid uuid := (select id from qa.people p where p.name = who);
begin
  begin
    perform set_config('request.jwt.claims',
      case when uid is null then '{"role":"anon"}'
           else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', case when uid is null then 'anon' else 'authenticated' end);
    -- A plain insert/update/delete reports how many rows it really changed,
    -- with no RETURNING: that's how an attacker sends it (Prefer:
    -- return=minimal), and RETURNING would add a read check that can make a
    -- write that succeeds look refused.
    if sql ~* '^\s*(insert|update|delete)\M' then
      execute sql;
      get diagnostics n = row_count;
    else
      execute sql into n;
    end if;
    raise exception using errcode = 'QA001', message = 'rows:' || coalesce(n, 0);
  exception
    when sqlstate 'QA001' then return sqlerrm;
    when others then return 'error:' || sqlerrm;
  end;
end $$;

create function qa.check(area text, name text, who text, sql text, want text) returns void
language plpgsql as $$
declare
  got text := qa.attempt(who, sql);
  ok boolean := case
    when want = 'denied' then got like 'error:%' or got = 'rows:0'
    when want = 'error' then got like 'error:%'
    -- 'error:<start of message>': refused, and for the stated reason
    when want like 'error:%' then got like want || '%'
    else got = want
  end;
begin
  insert into qa.results (area, name, who, want, got, passed) values (area, name, who, want, got, ok);
end $$;

-- How many people are in a thread, counted as the owner (so a test can check
-- what an attempt did even where RLS would hide it from the attacker).
create function qa.members(conv uuid) returns bigint language sql security definer
set search_path = '' as $$
  select count(*) from public.conversation_members where conversation_id = conv;
$$;
-- Post as yourself, then read back your streak (two statements, so the second
-- sees what the first's triggers did).
-- Save a push token as yourself (the way the app does), then count how many
-- accounts it now belongs to, counted as the owner.
create function qa.token_owners(tok text) returns bigint language sql security definer
set search_path = '' as $$
  select count(*) from public.push_tokens where token = tok;
$$;
create function qa.save_token_then_count_owners(tok text) returns bigint language plpgsql as $$
begin
  insert into public.push_tokens (user_id, token, platform) values (auth.uid(), tok, 'ios')
  on conflict (user_id, token) do update set updated_at = now();
  return qa.token_owners(tok);
end $$;
-- One API request the way PostgREST makes it: the token's role and claims,
-- then the per-request check. 'ok', 'refused' (PostgREST answers 401), or the
-- error.
create function qa.request(as_role text, claims jsonb) returns text language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims', claims::text, true);
    execute format('set local role %I', as_role);
    perform public.check_request();
    raise exception using errcode = 'QA001', message = 'ok';
  exception
    when sqlstate 'QA001' then return 'ok';
    when sqlstate 'PGRST' then return 'refused';
    when others then return 'error:' || sqlerrm;
  end;
end $$;
-- Ask for AI allowance n times in a row for one person (as the server does);
-- 't' for each allowed call, 'f' for each refused. Global ceiling is given
-- relative to what has already been used today, so tests don't depend on order.
create function qa.ai_calls(who uuid, n int, daily int, per_min int, global_headroom int) returns text
language plpgsql as $$
declare out text := ''; used int;
begin
  select coalesce((select count from public.ai_usage_global where day = (now() at time zone 'utc')::date), 0) into used;
  for i in 1..n loop
    out := out || case when public.consume_ai_quota(who, daily, per_min, used + global_headroom) then 't' else 'f' end;
  end loop;
  return out;
exception when others then return 'error:' || sqlerrm;
end $$;
-- Run a statement up to n times in a row (each with its number, as %s), and
-- say how many went through before the first refusal.
create function qa.repeat(template text, n int) returns int language plpgsql as $$
declare done int := 0;
begin
  for i in 1..n loop
    begin
      execute format(template, i);
      done := done + 1;
    exception when others then
      return done;
    end;
  end loop;
  return done;
end $$;
-- Every row anywhere in public that still points at this account, by the
-- foreign keys to users, as 'table.column:count', or '(none)'.
create function qa.rows_pointing_at(who uuid) returns text language plpgsql as $$
declare r record; n bigint; out text := '';
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
    order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using who;
    if n > 0 then out := out || r.tbl || '.' || r.col || ':' || n || ' '; end if;
  end loop;
  return coalesce(nullif(trim(out), ''), '(none)');
end $$;
create function qa.post_and_read_streak() returns bigint language plpgsql as $$
begin
  insert into public.posts (user_id, meal_slot, photo_url)
  values (auth.uid(), 'dinner',
          'https://x.supabase.co/storage/v1/object/public/photos/' || auth.uid() || '/f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0.jpg');
  return (select current_streak from public.streaks where user_id = auth.uid());
end $$;
grant usage on schema qa to anon, authenticated;
grant execute on all functions in schema qa to anon, authenticated;

-- A fact about the database itself (checked as the owner, no sign-in).
create function qa.fact(area text, name text, sql text, want text) returns void
language plpgsql as $$
declare got text;
begin
  begin
    execute sql into got;
  exception when others then got := 'error:' || sqlerrm;
  end;
  insert into qa.results (area, name, who, want, got, passed)
  values (area, name, '(schema)', want, coalesce(got, '(none)'), coalesce(got, '(none)') = want);
end $$;

-- ------------------------------------------------------------- test data
-- Written as the owner, so it doesn't depend on the rules being tested.
insert into auth.users (id) select id from qa.people;
insert into public.users (id, handle, display_name, follows_private, timezone)
select id, name, initcap(name), name = 'dave', 'America/Chicago' from qa.people;

-- Someone who has just signed up and has no profile yet.
insert into qa.people values ('newbie', '12121212-0000-4000-8000-000000000012');
insert into auth.users (id) values ('12121212-0000-4000-8000-000000000012');

insert into public.follows (follower_id, followee_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000004'),
  -- Eve followed Alice before Alice blocked her.
  ('eeeeeeee-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ffffffff-0000-4000-8000-000000000006'),
  ('ffffffff-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.blocks (blocker_id, blocked_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000005');

insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('10000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'dinner', 'https://x.supabase.co/a.jpg', 'alice dinner'),
  ('10000000-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000002', 'lunch',  'https://x.supabase.co/b.jpg', 'bob lunch'),
  ('10000000-0000-4000-8000-0000000000d4', 'dddddddd-0000-4000-8000-000000000004', 'snack',  'https://x.supabase.co/m.jpg', 'mallory snack');
insert into public.recipes (id, post_id, title, ingredients) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 'Hotdish', '[{"item":"tots","quantity":1,"unit":"bag"}]'),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000d4', 'Chips', '[]');
insert into public.comments (id, post_id, user_id, text) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-000000000002', 'looks good'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000001', 'yum');
insert into public.reactions (post_id, user_id) values
  ('10000000-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.reposts (post_id, user_id) values
  ('10000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.saved_posts (post_id, user_id) values
  ('10000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.comment_reactions (comment_id, user_id) values
  ('40000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.collections (id, user_id, name) values
  ('50000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Dinners'),
  ('50000000-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000004', 'Mine');
insert into public.collection_posts (collection_id, post_id) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1');
insert into public.post_tags (post_id, user_id) values
  ('10000000-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-000000000002');

-- DMs: Alice+Bob, the group (Alice, Bob, Carol), Mallory's own thread with
-- Alice, and an old group Mallory has already left.
insert into public.conversations (id, is_group) values
  ('20000000-0000-4000-8000-000000000001', false),
  ('20000000-0000-4000-8000-000000000002', true),
  ('20000000-0000-4000-8000-000000000003', false),
  ('20000000-0000-4000-8000-000000000004', true);
insert into public.conversation_members (conversation_id, user_id) values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004'),
  ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.messages (id, conversation_id, sender_id, text) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'private to bob'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'group chat'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004', 'hi alice'),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'said after mallory left'),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000004', 'said before mallory left');
insert into public.message_reactions (message_id, user_id, emoji) values
  ('30000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', '❤️');

insert into public.push_tokens (user_id, token) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ExponentPushToken[alice]');
insert into public.streaks (user_id, current_streak, longest_streak, last_post_date) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 3, 5, (now() at time zone 'America/Chicago')::date)
on conflict (user_id) do update set
  current_streak = excluded.current_streak, longest_streak = excluded.longest_streak,
  last_post_date = excluded.last_post_date;
insert into public.reports (reporter_id, post_id, reported_user_id, reason) values
  ('bbbbbbbb-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000d4', 'dddddddd-0000-4000-8000-000000000004', 'spam');
insert into public.feedback (user_id, kind, message) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bug', 'alice found a bug');
insert into storage.objects (bucket_id, name, owner) values
  ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/1700000000000.jpg', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('photos', 'bbbbbbbb-0000-4000-8000-000000000002/dm-photo.jpg', 'bbbbbbbb-0000-4000-8000-000000000002');

-- Files the server-side upload function would have written: 32-hex random
-- names. Some are in use, some are orphans (old and unreferenced), one is too
-- new to call an orphan, one is evidence in an open report.
insert into storage.objects (bucket_id, name, owner, created_at) values
  ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now()),
  ('photos', 'dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg', 'dddddddd-0000-4000-8000-000000000004', now()),
  ('photos', 'bbbbbbbb-0000-4000-8000-000000000002/b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5.jpg', 'bbbbbbbb-0000-4000-8000-000000000002', now() - interval '2 days'),
  -- Fresh uploads Alice and Bob post with in the streak checks.
  ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now()),
  ('photos', 'bbbbbbbb-0000-4000-8000-000000000002/f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0.jpg', 'bbbbbbbb-0000-4000-8000-000000000002', now());
insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('10000000-0000-4000-8000-0000000000a9', 'aaaaaaaa-0000-4000-8000-000000000001', 'lunch',
   'https://x.supabase.co/storage/v1/object/public/photos/aaaaaaaa-0000-4000-8000-000000000001/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.jpg', 'alice lunch');
insert into public.reports (reporter_id, reported_user_id, reason, post_photo_url_snapshot) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'sexual',
   'https://x.supabase.co/storage/v1/object/public/photos/bbbbbbbb-0000-4000-8000-000000000002/b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5.jpg');
-- DM photos and the storage origin only exist once storage is hardened, so
-- they're added only where the database has them (the checks then fail on an
-- older schema, as they should).
do $$
begin
  if exists (select 1 from storage.buckets where id = 'dm-photos') then
    insert into storage.objects (bucket_id, name, owner, created_at) values
      ('dm-photos', '20000000-0000-4000-8000-000000000001/c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days'),
      ('dm-photos', '20000000-0000-4000-8000-000000000001/c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days'),
      ('dm-photos', '20000000-0000-4000-8000-000000000003/d8d8d8d8d8d8d8d8d8d8d8d8d8d8d8d8.jpg', 'dddddddd-0000-4000-8000-000000000004', now()),
      -- Sent in the old group, before and after Mallory left.
      ('dm-photos', '20000000-0000-4000-8000-000000000004/e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days');
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'messages' and column_name = 'image_path') then
    execute $x$insert into public.messages (conversation_id, sender_id, image_path) values
      ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001/c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6.jpg'),
      ('20000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000004/e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9.jpg')$x$;
  end if;
  if to_regclass('public.app_config') is not null then
    execute $x$insert into public.app_config (key, value) values ('storage_origin', 'https://x.supabase.co')
      on conflict (key) do update set value = excluded.value$x$;
  end if;
end $$;

-- Sign-in sessions: Alice's phone is signed in; Dave's session has run past
-- its time limit; Zed is banned; Yan deleted his account (which deletes his
-- sessions too) and Xia's account is soft-deleted.
insert into auth.sessions (id, user_id, not_after) values
  ('5e550000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', null),
  ('5e550000-0000-4000-8000-000000000006', 'ffffffff-0000-4000-8000-000000000006', now() - interval '1 minute');
insert into auth.users (id, banned_until, deleted_at) values
  ('99999999-0000-4000-8000-000000000009', now() + interval '7 days', null),
  ('88888888-0000-4000-8000-000000000008', null, null),
  ('77777777-0000-4000-8000-000000000007', null, now());
insert into auth.sessions (id, user_id) values
  ('5e550000-0000-4000-8000-000000000009', '99999999-0000-4000-8000-000000000009'),
  ('5e550000-0000-4000-8000-000000000008', '88888888-0000-4000-8000-000000000008'),
  ('5e550000-0000-4000-8000-000000000007', '77777777-0000-4000-8000-000000000007');
delete from auth.users where id = '88888888-0000-4000-8000-000000000008';

-- Short names for the ids, used in the checks below.
\set alice    '''aaaaaaaa-0000-4000-8000-000000000001'''
\set bob      '''bbbbbbbb-0000-4000-8000-000000000002'''
\set carol    '''cccccccc-0000-4000-8000-000000000003'''
\set mallory  '''dddddddd-0000-4000-8000-000000000004'''
\set eve      '''eeeeeeee-0000-4000-8000-000000000005'''
\set dave     '''ffffffff-0000-4000-8000-000000000006'''

-- =======================================================================
-- 1. The database as a whole
-- =======================================================================
select qa.fact('schema', 'RLS is on for every table in public',
  $q$select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$q$, '0');
select qa.fact('schema', 'no views in public (a view can skip RLS)',
  $q$select count(*)::text from pg_views where schemaname = 'public'$q$, '0');
select qa.fact('schema', 'no policy applies to signed-out users (anon / public)',
  $q$select count(*)::text from pg_policies
     where schemaname in ('public', 'storage') and roles && array['public', 'anon']::name[]$q$, '0');
select qa.fact('schema', 'every SECURITY DEFINER function pins its search_path',
  $q$select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$q$, '0');
-- check_request is the per-request session check PostgREST runs as the
-- caller (0033); it reads nothing back and only ever refuses. The recipe_*_ok
-- shape checks (0034) and plain_text_ok (0035) are pure functions that CHECK
-- constraints call as the writer.
select qa.fact('schema', 'signed out, only the share-link preview (and the session check) are callable',
  $q$select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')$q$, 'check_request,get_post_preview');
select qa.fact('schema', 'signed in, only the functions the app needs are callable',
  $q$select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute')$q$,
  'can_reply_under,check_request,conversation_has_block,follow_counts,get_post_preview,is_blocked_pair,is_conversation_member,leave_conversation,plain_text_ok,recipe_ingredients_ok,recipe_nutrition_ok,recipe_steps_ok,start_conversation,start_group_conversation');

-- =======================================================================
-- 2. Profiles
-- =======================================================================
select qa.check('profiles', 'read other people''s public profiles', 'mallory',
  $q$select count(*) from public.users$q$, 'rows:6');
select qa.check('profiles', 'change someone else''s name', 'mallory',
  format($q$update public.users set display_name = 'pwned' where id = %L$q$, :alice), 'denied');
select qa.check('profiles', 'delete someone else''s profile', 'mallory',
  format($q$delete from public.users where id = %L$q$, :alice), 'denied');
select qa.check('profiles', 'create a profile with someone else''s id', 'mallory',
  $q$insert into public.users (id, handle, display_name) values (gen_random_uuid(), 'fake', 'Fake')$q$, 'denied');
select qa.check('profiles', 'take over another account by changing your own id', 'mallory',
  format($q$update public.users set id = %L where id = %L$q$, :alice, :mallory), 'denied');
select qa.check('profiles', 'backdate your own account (created_at)', 'mallory',
  format($q$with x as (update public.users set created_at = '2001-01-01' where id = %L returning created_at)
           select count(*) from x where created_at < '2020-01-01'$q$, :mallory), 'denied');
select qa.check('profiles', 'edit your own profile still works', 'mallory',
  format($q$update public.users set display_name = 'M', bio = 'hi', follows_private = true where id = %L$q$, :mallory), 'rows:1');

-- =======================================================================
-- 3. Posts and recipes
-- =======================================================================
select qa.check('posts', 'edit someone else''s post', 'mallory',
  $q$update public.posts set blurb = 'pwned' where id = '10000000-0000-4000-8000-0000000000a1'$q$, 'denied');
select qa.check('posts', 'delete someone else''s post', 'mallory',
  $q$delete from public.posts where id = '10000000-0000-4000-8000-0000000000a1'$q$, 'denied');
select qa.check('posts', 'post as someone else', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://x.supabase.co/z.jpg')$q$, :alice), 'denied');
select qa.check('posts', 'hand your post to someone else', 'mallory',
  format($q$update public.posts set user_id = %L where id = '10000000-0000-4000-8000-0000000000d4'$q$, :alice), 'denied');
select qa.check('posts', 'pin a post to the top of everyone''s feed with a future date', 'mallory',
  format($q$with x as (insert into public.posts (user_id, meal_slot, photo_url, created_at) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg', '2099-01-01') returning created_at)
           select count(*) from x where created_at > now() + interval '1 minute'$q$, :mallory), 'rows:0');
select qa.check('posts', 'move your old post to the top later (update created_at)', 'mallory',
  $q$with x as (update public.posts set created_at = '2099-01-01' where id = '10000000-0000-4000-8000-0000000000d4' returning created_at)
     select count(*) from x where created_at > now() + interval '1 minute'$q$, 'rows:0');
select qa.check('posts', 'posting your own still works', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url, blurb) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg', 'mine')$q$, :mallory), 'rows:1');
select qa.check('posts', 'a blocked person cannot see the blocker''s posts', 'eve',
  $q$select count(*) from public.posts where id = '10000000-0000-4000-8000-0000000000a1'$q$, 'rows:0');

select qa.check('recipes', 'edit someone else''s recipe', 'mallory',
  $q$update public.recipes set title = 'pwned' where id = '60000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('recipes', 'delete someone else''s recipe', 'mallory',
  $q$delete from public.recipes where id = '60000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('recipes', 'add a recipe to someone else''s post', 'mallory',
  $q$insert into public.recipes (post_id, title) values ('10000000-0000-4000-8000-0000000000b2', 'pwned')$q$, 'denied');
select qa.check('recipes', 'move your recipe onto someone else''s post', 'mallory',
  $q$update public.recipes set post_id = '10000000-0000-4000-8000-0000000000b2' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipes', 'a blocked person cannot read the blocker''s recipes by id', 'eve',
  $q$select count(*) from public.recipes where id = '60000000-0000-4000-8000-000000000001'$q$, 'rows:0');

-- =======================================================================
-- 4. Comments
-- =======================================================================
select qa.check('comments', 'delete someone else''s comment on someone else''s post', 'mallory',
  $q$delete from public.comments where id = '40000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('comments', 'edit a comment (nobody can, not even the author)', 'bob',
  $q$update public.comments set text = 'edited' where id = '40000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('comments', 'comment as someone else', 'mallory',
  format($q$insert into public.comments (post_id, user_id, text) values ('10000000-0000-4000-8000-0000000000a1', %L, 'fake')$q$, :bob), 'denied');
select qa.check('comments', 'a blocked person keeps commenting on the blocker''s post', 'eve',
  format($q$insert into public.comments (post_id, user_id, text) values ('10000000-0000-4000-8000-0000000000a1', %L, 'still here')$q$, :eve), 'denied');
select qa.check('comments', 'reply under a comment from a different post', 'mallory',
  format($q$insert into public.comments (post_id, user_id, text, parent_id) values ('10000000-0000-4000-8000-0000000000d4', %L, 'x', '40000000-0000-4000-8000-000000000001')$q$, :mallory), 'denied');
select qa.check('comments', 'backdate a comment', 'mallory',
  format($q$with x as (insert into public.comments (post_id, user_id, text, created_at) values ('10000000-0000-4000-8000-0000000000d4', %L, 'x', '2001-01-01') returning created_at) select count(*) from x where created_at < now() - interval '1 minute'$q$, :mallory), 'rows:0');
select qa.check('comments', 'commenting and replying normally still work', 'mallory',
  format($q$insert into public.comments (post_id, user_id, text, parent_id) values ('10000000-0000-4000-8000-0000000000a1', %L, 'nice', '40000000-0000-4000-8000-000000000001')$q$, :mallory), 'rows:1');
select qa.check('comments', 'the post owner can remove a comment on their post', 'alice',
  $q$delete from public.comments where id = '40000000-0000-4000-8000-000000000001'$q$, 'rows:1');

-- =======================================================================
-- 5. Likes, reposts, shares, comment likes
-- =======================================================================
select qa.check('likes', 'like as someone else', 'mallory',
  format($q$insert into public.reactions (post_id, user_id) values ('10000000-0000-4000-8000-0000000000b2', %L)$q$, :carol), 'denied');
select qa.check('likes', 'remove someone else''s like', 'mallory',
  $q$delete from public.reactions where post_id = '10000000-0000-4000-8000-0000000000a1'$q$, 'denied');
select qa.check('likes', 'like your own post', 'mallory',
  format($q$insert into public.reactions (post_id, user_id) values ('10000000-0000-4000-8000-0000000000d4', %L)$q$, :mallory), 'denied');
select qa.check('likes', 'a blocked person likes the blocker''s post', 'eve',
  format($q$insert into public.reactions (post_id, user_id) values ('10000000-0000-4000-8000-0000000000a1', %L)$q$, :eve), 'denied');
select qa.check('likes', 'a blocked person reads what the blocker likes', 'eve',
  format($q$select count(*) from public.reactions where user_id = %L$q$, :alice), 'rows:0');
select qa.check('likes', 'liking normally still works', 'mallory',
  format($q$insert into public.reactions (post_id, user_id) values ('10000000-0000-4000-8000-0000000000a1', %L)$q$, :mallory), 'rows:1');
select qa.check('likes', 'repost as someone else', 'mallory',
  format($q$insert into public.reposts (post_id, user_id) values ('10000000-0000-4000-8000-0000000000b2', %L)$q$, :carol), 'denied');
select qa.check('likes', 'undo someone else''s repost', 'mallory',
  $q$delete from public.reposts where post_id = '10000000-0000-4000-8000-0000000000b2'$q$, 'denied');
select qa.check('likes', 'share as someone else', 'mallory',
  format($q$insert into public.shares (post_id, user_id) values ('10000000-0000-4000-8000-0000000000b2', %L)$q$, :carol), 'denied');
select qa.check('likes', 'like a comment as someone else', 'mallory',
  format($q$insert into public.comment_reactions (comment_id, user_id) values ('40000000-0000-4000-8000-000000000002', %L)$q$, :carol), 'denied');
select qa.check('likes', 'remove someone else''s comment like', 'mallory',
  $q$delete from public.comment_reactions where comment_id = '40000000-0000-4000-8000-000000000002'$q$, 'denied');

-- =======================================================================
-- 6. Saved posts (private bookmarks)
-- =======================================================================
select qa.check('saves', 'read someone else''s saves', 'mallory',
  format($q$select count(*) from public.saved_posts where user_id = %L$q$, :alice), 'rows:0');
select qa.check('saves', 'save into someone else''s list', 'mallory',
  format($q$insert into public.saved_posts (post_id, user_id) values ('10000000-0000-4000-8000-0000000000a1', %L)$q$, :alice), 'denied');
select qa.check('saves', 'remove someone else''s save', 'mallory',
  $q$delete from public.saved_posts where post_id = '10000000-0000-4000-8000-0000000000b2'$q$, 'denied');
select qa.check('saves', 'you still see your own saves', 'alice',
  $q$select count(*) from public.saved_posts$q$, 'rows:1');

-- =======================================================================
-- 7. Collections
-- =======================================================================
select qa.check('collections', 'rename someone else''s collection', 'mallory',
  $q$update public.collections set name = 'pwned' where id = '50000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('collections', 'delete someone else''s collection', 'mallory',
  $q$delete from public.collections where id = '50000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('collections', 'take over a collection (change its owner)', 'mallory',
  format($q$update public.collections set user_id = %L where id = '50000000-0000-4000-8000-000000000004'$q$, :alice), 'denied');
select qa.check('collections', 'put your post in someone else''s collection', 'mallory',
  $q$insert into public.collection_posts (collection_id, post_id) values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000d4')$q$, 'denied');
select qa.check('collections', 'put someone else''s post in your collection', 'mallory',
  $q$insert into public.collection_posts (collection_id, post_id) values ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000a1')$q$, 'denied');
select qa.check('collections', 'take a post out of someone else''s collection', 'mallory',
  $q$delete from public.collection_posts where collection_id = '50000000-0000-4000-8000-000000000001'$q$, 'denied');

-- =======================================================================
-- 8. DMs and group chats
-- =======================================================================
select qa.check('dms', 'read a thread you are not in', 'mallory',
  $q$select count(*) from public.messages where conversation_id = '20000000-0000-4000-8000-000000000001'$q$, 'rows:0');
select qa.check('dms', 'see who is in a thread you are not in', 'mallory',
  $q$select count(*) from public.conversation_members where conversation_id = '20000000-0000-4000-8000-000000000001'$q$, 'rows:0');
select qa.check('dms', 'see a thread you are not in', 'mallory',
  $q$select count(*) from public.conversations where id = '20000000-0000-4000-8000-000000000001'$q$, 'rows:0');
select qa.check('dms', 'post into a thread you are not in', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000001', %L, 'hi')$q$, :mallory), 'denied');
select qa.check('dms', 'add yourself to someone else''s thread', 'mallory',
  format($q$insert into public.conversation_members (conversation_id, user_id) values ('20000000-0000-4000-8000-000000000001', %L)$q$, :mallory), 'denied');
select qa.check('dms', 'slip into a thread by moving your own membership to it', 'mallory',
  format($q$update public.conversation_members set conversation_id = '20000000-0000-4000-8000-000000000001'
           where conversation_id = '20000000-0000-4000-8000-000000000003' and user_id = %L$q$, :mallory), 'denied');
select qa.check('dms', 'slip into a thread by moving your only membership (no filter)', 'mallory',
  $q$update public.conversation_members set conversation_id = '20000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('dms', 'rejoin a group you left by moving a membership', 'mallory',
  format($q$update public.conversation_members set conversation_id = '20000000-0000-4000-8000-000000000004'
           where conversation_id = '20000000-0000-4000-8000-000000000003' and user_id = %L$q$, :mallory), 'denied');
select qa.check('dms', 'make a raw conversation row (skipping the start-a-chat rules)', 'mallory',
  $q$insert into public.conversations default values$q$, 'denied');
select qa.check('dms', 'add someone to your own thread directly', 'mallory',
  $q$insert into public.conversation_members (conversation_id, user_id) values ('20000000-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000003')$q$, 'denied');
select qa.check('dms', 'send a message as someone else', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000003', %L, 'fake')$q$, :alice), 'denied');
select qa.check('dms', 'write a fake "X left the chat" line', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, text, kind) values ('20000000-0000-4000-8000-000000000003', %L, '', 'left')$q$, :mallory), 'denied');
select qa.check('dms', 'delete someone else''s message', 'mallory',
  $q$delete from public.messages where sender_id <> 'dddddddd-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('dms', 'rename a group you are not in', 'mallory',
  $q$update public.conversations set title = 'pwned' where id = '20000000-0000-4000-8000-000000000002'$q$, 'denied');
select qa.check('dms', 'turn a 1:1 into a "group"', 'mallory',
  $q$update public.conversations set is_group = true where id = '20000000-0000-4000-8000-000000000003'$q$, 'denied');
select qa.check('dms', 'pin your thread to the top of their inbox with a future time', 'mallory',
  $q$with x as (update public.conversations set updated_at = '2099-01-01' where id = '20000000-0000-4000-8000-000000000003' returning updated_at)
     select count(*) from x where updated_at > now() + interval '1 minute'$q$, 'rows:0');
select qa.check('dms', 'backdate or future-date a message', 'mallory',
  format($q$with x as (insert into public.messages (conversation_id, sender_id, text, created_at) values ('20000000-0000-4000-8000-000000000003', %L, 'from the future', '2099-01-01') returning created_at)
           select count(*) from x where created_at > now() + interval '1 minute'$q$, :mallory), 'rows:0');
select qa.check('dms', 'mute or mark read someone else''s membership', 'mallory',
  $q$update public.conversation_members set muted = true where conversation_id = '20000000-0000-4000-8000-000000000003' and user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('dms', 'react to a message in a thread you are not in', 'mallory',
  format($q$insert into public.message_reactions (message_id, user_id, emoji) values ('30000000-0000-4000-8000-000000000001', %L, 'x')$q$, :mallory), 'denied');
select qa.check('dms', 'read reactions in a thread you are not in', 'mallory',
  $q$select count(*) from public.message_reactions where message_id = '30000000-0000-4000-8000-000000000001'$q$, 'rows:0');
select qa.check('dms', 'start a chat with someone you don''t follow', 'mallory',
  format($q$select count(*) from public.start_conversation(%L)$q$, :bob), 'error');
select qa.check('dms', 'start a group with someone you don''t follow', 'mallory',
  format($q$select count(*) from public.start_group_conversation(array[%L, %L]::uuid[])$q$, :alice, :bob), 'error');
select qa.check('dms', 'a blocked person starts a chat with the blocker', 'eve',
  format($q$select count(*) from public.start_conversation(%L)$q$, :alice), 'error');
select qa.check('dms', 'leave_conversation can''t remove anyone from a thread you are not in', 'mallory',
  $q$select qa.members('20000000-0000-4000-8000-000000000001') from (select public.leave_conversation('20000000-0000-4000-8000-000000000001')) s$q$, 'rows:2');
-- What must keep working.
select qa.check('dms', 'members read their thread (a message and a photo)', 'bob',
  $q$select count(*) from public.messages where conversation_id = '20000000-0000-4000-8000-000000000001'$q$, 'rows:2');
select qa.check('dms', 'group members read the group', 'carol',
  $q$select count(*) from public.messages where conversation_id = '20000000-0000-4000-8000-000000000002'$q$, 'rows:1');
select qa.check('dms', 'someone who left a group can''t read it any more', 'mallory',
  $q$select count(*) from public.messages where conversation_id = '20000000-0000-4000-8000-000000000004'$q$, 'rows:0');
select qa.check('dms', 'sending a message still works', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000003', %L, 'hey')$q$, :mallory), 'rows:1');
select qa.check('dms', 'muting and marking read your own still work', 'mallory',
  format($q$update public.conversation_members set muted = true, last_read_at = now() where conversation_id = '20000000-0000-4000-8000-000000000003' and user_id = %L$q$, :mallory), 'rows:1');
select qa.check('dms', 'renaming your group and bumping it still work', 'carol',
  $q$update public.conversations set title = 'Supper club', updated_at = now() where id = '20000000-0000-4000-8000-000000000002'$q$, 'rows:1');
select qa.check('dms', 'starting a chat with someone you follow still works', 'alice',
  format($q$select count(*) from public.start_conversation(%L)$q$, :carol), 'rows:1');
select qa.check('dms', 'starting a group still works', 'alice',
  format($q$select count(*) from public.start_group_conversation(array[%L, %L]::uuid[])$q$, :bob, :carol), 'rows:1');
select qa.check('dms', 'reacting in your own thread still works', 'alice',
  format($q$insert into public.message_reactions (message_id, user_id, emoji, created_at) values ('30000000-0000-4000-8000-000000000001', %L, '😂', now())
           on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = excluded.created_at$q$, :alice), 'rows:1');

-- =======================================================================
-- 9. Follows and blocks
-- =======================================================================
select qa.check('follows', 'make someone else follow a person', 'mallory',
  format($q$insert into public.follows (follower_id, followee_id) values (%L, %L)$q$, :carol, :mallory), 'denied');
select qa.check('follows', 'remove someone else''s follow', 'mallory',
  format($q$delete from public.follows where follower_id = %L$q$, :bob), 'denied');
select qa.check('follows', 'read a private account''s follower list', 'mallory',
  format($q$select count(*) from public.follows where follower_id = %L or followee_id = %L$q$, :dave, :dave), 'rows:0');
select qa.check('follows', 'read a private follow graph through is_following()', 'mallory',
  format($q$select count(*) from (select 1 where public.is_following(%L, %L)) s$q$, :dave, :bob), 'denied');
select qa.check('blocks', 'read someone else''s block list', 'mallory',
  format($q$select count(*) from public.blocks where blocker_id = %L$q$, :alice), 'rows:0');
select qa.check('blocks', 'undo someone else''s block', 'eve',
  format($q$delete from public.blocks where blocker_id = %L$q$, :alice), 'denied');
select qa.check('blocks', 'ask whether two other people blocked each other', 'mallory',
  format($q$select count(*) from (select 1 where public.is_blocked_pair(%L, %L)) s$q$, :alice, :eve), 'rows:0');
select qa.check('blocks', 'ask whether two other people share a thread', 'mallory',
  format($q$select count(*) from (select 1 where public.is_conversation_member('20000000-0000-4000-8000-000000000001', %L)) s$q$, :alice), 'rows:0');
select qa.check('blocks', 'probe another thread for blocks', 'mallory',
  format($q$select count(*) from (select 1 where public.conversation_has_block('20000000-0000-4000-8000-000000000001', %L)) s$q$, :eve), 'rows:0');

-- =======================================================================
-- 10. Notifications, reports, feedback, streaks, push tokens, tags
-- =======================================================================
select qa.check('notifications', 'read someone else''s notifications', 'mallory',
  format($q$select count(*) from public.notifications where user_id = %L$q$, :alice), 'rows:0');
select qa.check('notifications', 'forge a notification', 'mallory',
  format($q$insert into public.notifications (user_id, actor_id, type) values (%L, %L, 'follow')$q$, :alice, :bob), 'denied');
select qa.check('notifications', 'clear someone else''s notifications', 'mallory',
  format($q$delete from public.notifications where user_id = %L$q$, :alice), 'denied');
select qa.check('notifications', 'rewrite one of your own (who did it)', 'alice',
  format($q$update public.notifications set actor_id = %L$q$, :carol), 'denied');
select qa.check('notifications', 'marking your own read still works', 'alice',
  $q$update public.notifications set read_at = now() where read_at is null$q$, 'rows:5');

select qa.check('reports', 'read reports filed by others', 'mallory',
  $q$select count(*) from public.reports$q$, 'rows:0');
select qa.check('reports', 'delete a report against you', 'mallory',
  $q$delete from public.reports$q$, 'denied');
select qa.check('reports', 'file a report already marked "actioned"', 'mallory',
  format($q$with x as (insert into public.reports (reporter_id, post_id, reason, status, reviewer_notes) values (%L, '10000000-0000-4000-8000-0000000000b2', 'spam', 'actioned', 'banned') returning status) select count(*) from x where status <> 'open'$q$, :mallory), 'rows:0');
select qa.check('reports', 'file a report with made-up evidence (snapshot)', 'mallory',
  format($q$with x as (insert into public.reports (reporter_id, post_id, reason, post_blurb_snapshot) values (%L, '10000000-0000-4000-8000-0000000000b2', 'harassment', 'something bob never wrote') returning post_blurb_snapshot) select count(*) from x where post_blurb_snapshot = 'something bob never wrote'$q$, :mallory), 'rows:0');
select qa.check('reports', 'pin a report on someone who didn''t write the post', 'mallory',
  format($q$with x as (insert into public.reports (reporter_id, post_id, reported_user_id, reason) values (%L, '10000000-0000-4000-8000-0000000000b2', %L, 'spam') returning reported_user_id) select count(*) from x where reported_user_id = %L$q$, :mallory, :carol, :carol), 'rows:0');
select qa.check('reports', 'read a DM you are not in by reporting it', 'mallory',
  format($q$with x as (insert into public.reports (reporter_id, message_id, reason) values (%L, '30000000-0000-4000-8000-000000000001', 'spam') returning message_text_snapshot) select count(*) from x where message_text_snapshot is not null$q$, :mallory), 'denied');
select qa.check('reports', 'reporting a post still works and records what it said', 'mallory',
  format($q$with x as (insert into public.reports (reporter_id, post_id, reason) values (%L, '10000000-0000-4000-8000-0000000000b2', 'spam') returning post_blurb_snapshot, reported_user_id, status)
           select count(*) from x where post_blurb_snapshot = 'bob lunch' and reported_user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and status = 'open'$q$, :mallory), 'rows:1');
select qa.check('reports', 'reporting a message in your own thread still works', 'alice',
  format($q$with x as (insert into public.reports (reporter_id, message_id, reason) values (%L, '30000000-0000-4000-8000-000000000003', 'harassment') returning message_text_snapshot, reported_user_id)
           select count(*) from x where message_text_snapshot = 'hi alice' and reported_user_id = 'dddddddd-0000-4000-8000-000000000004'$q$, :alice), 'rows:1');

select qa.check('feedback', 'read someone else''s feedback', 'mallory',
  $q$select count(*) from public.feedback$q$, 'rows:0');
select qa.check('feedback', 'file feedback already marked resolved', 'mallory',
  format($q$with x as (insert into public.feedback (user_id, message, status) values (%L, 'x', 'resolved') returning status) select count(*) from x where status <> 'new'$q$, :mallory), 'rows:0');
select qa.check('feedback', 'file feedback under someone else''s handle', 'mallory',
  format($q$with x as (insert into public.feedback (user_id, message, handle_snapshot) values (%L, 'x', 'alice') returning handle_snapshot) select count(*) from x where handle_snapshot = 'alice'$q$, :mallory), 'rows:0');

select qa.check('streaks', 'give yourself a 999-day streak to top the leaderboard', 'mallory',
  format($q$insert into public.streaks (user_id, current_streak, longest_streak, last_post_date) values (%L, 999, 999, current_date)$q$, :mallory), 'denied');
select qa.check('streaks', 'edit someone else''s streak', 'mallory',
  format($q$update public.streaks set current_streak = 0 where user_id = %L$q$, :alice), 'denied');
select qa.check('streaks', 'inflate your own existing streak', 'alice',
  format($q$update public.streaks set current_streak = 500, longest_streak = 500 where user_id = %L$q$, :alice), 'denied');
select qa.check('streaks', 'posting still starts your streak (kept by the database now)', 'bob',
  $q$select qa.post_and_read_streak()$q$, 'rows:1');
select qa.check('streaks', 'posting again the same day keeps it, not doubles it', 'alice',
  $q$select qa.post_and_read_streak()$q$, 'rows:3');

select qa.check('push', 'read someone else''s push tokens', 'mallory',
  $q$select count(*) from public.push_tokens$q$, 'rows:0');
select qa.check('push', 'add a push token to someone else''s account', 'mallory',
  format($q$insert into public.push_tokens (user_id, token) values (%L, 'ExponentPushToken[mallory]')$q$, :alice), 'denied');

select qa.check('tags', 'tag people on someone else''s post', 'mallory',
  format($q$insert into public.post_tags (post_id, user_id) values ('10000000-0000-4000-8000-0000000000a1', %L)$q$, :mallory), 'denied');
select qa.check('tags', 'remove a tag you are not part of', 'mallory',
  $q$delete from public.post_tags where post_id = '10000000-0000-4000-8000-0000000000a1'$q$, 'denied');

-- =======================================================================
-- 11. Server-only functions and tables
-- =======================================================================
select qa.check('server-only', 'burn someone''s AI allowance (consume_ai_quota)', 'mallory',
  format($q$select count(*) from (select public.consume_ai_quota(%L, 1)) s$q$, :alice), 'error');
select qa.check('server-only', 'read the AI usage ledger', 'mallory',
  $q$select count(*) from public.ai_usage$q$, 'error');
select qa.check('server-only', 'write to the nutrition cache', 'mallory',
  $q$insert into public.nutrition_cache (term, per_100g) values ('x', '{}')$q$, 'error');
select qa.check('server-only', 'call a trigger function directly', 'mallory',
  $q$select count(*) from (select public.notify_follow()) s$q$, 'error');

-- =======================================================================
-- 12. Signed out (the public anon key)
-- =======================================================================
select qa.check('signed out', 'read profiles', 'anon', $q$select count(*) from public.users$q$, 'denied');
select qa.check('signed out', 'read posts', 'anon', $q$select count(*) from public.posts$q$, 'denied');
select qa.check('signed out', 'read messages', 'anon', $q$select count(*) from public.messages$q$, 'denied');
select qa.check('signed out', 'read push tokens', 'anon', $q$select count(*) from public.push_tokens$q$, 'denied');
select qa.check('signed out', 'write a post', 'anon',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://x.supabase.co/z.jpg')$q$, :alice), 'denied');
select qa.check('signed out', 'call start_conversation', 'anon',
  format($q$select count(*) from public.start_conversation(%L)$q$, :alice), 'error');
select qa.check('signed out', 'read follower counts', 'anon',
  format($q$select count(*) from public.follow_counts(%L)$q$, :alice), 'error');
select qa.check('signed out', 'a shared post link still previews', 'anon',
  $q$select count(*) from public.get_post_preview('10000000-0000-4000-8000-0000000000a1')$q$, 'rows:1');

-- =======================================================================
-- 13. Photo storage
-- =======================================================================
select qa.check('storage', 'list everyone''s photos signed out', 'anon',
  $q$select count(*) from storage.objects where bucket_id = 'photos'$q$, 'rows:0');
select qa.check('storage', 'list other people''s photos', 'mallory',
  $q$select count(*) from storage.objects where bucket_id = 'photos' and name not like 'dddddddd-0000-4000-8000-000000000004/%'$q$, 'rows:0');
select qa.check('storage', 'upload into someone else''s folder', 'mallory',
  format($q$insert into storage.objects (bucket_id, name) values ('photos', %L || '/evil.jpg')$q$, :alice), 'denied');
select qa.check('storage', 'overwrite someone else''s photo', 'mallory',
  $q$update storage.objects set name = name where bucket_id = 'photos'$q$, 'denied');
select qa.check('storage', 'delete someone else''s photo', 'mallory',
  $q$delete from storage.objects where bucket_id = 'photos' and name not like 'dddddddd-0000-4000-8000-000000000004/%'$q$, 'denied');
select qa.check('storage', 'upload straight into storage, skipping the server''s checks', 'mallory',
  format($q$insert into storage.objects (bucket_id, name) values ('photos', %L || '/mine.jpg')$q$, :mallory), 'denied');
select qa.check('storage', 'upload straight into a DM folder', 'mallory',
  $q$insert into storage.objects (bucket_id, name) values ('dm-photos', '20000000-0000-4000-8000-000000000003/x.jpg')$q$, 'denied');
select qa.check('storage', 'you can still see (and so delete) your own photos', 'alice',
  $q$select count(*) from storage.objects where bucket_id = 'photos'$q$, 'rows:5');

-- =======================================================================
-- 14. Private DM photos
-- =======================================================================
select qa.fact('dm photos', 'DM photos have their own bucket, and it is private',
  $q$select coalesce((select (not public)::text from storage.buckets where id = 'dm-photos'), 'missing')$q$, 'true');
select qa.fact('dm photos', 'both buckets take only JPEG, at most 10 MB',
  $q$select string_agg(id || ':' || array_to_string(allowed_mime_types, ',') || ':' || file_size_limit, ' ' order by id)
     from storage.buckets where id in ('photos', 'dm-photos')$q$,
  'dm-photos:image/jpeg:10485760 photos:image/jpeg:10485760');
select qa.check('dm photos', 'people in the chat can open its photos', 'bob',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos' and name like '20000000-0000-4000-8000-000000000001/%'$q$, 'rows:2');
select qa.check('dm photos', 'someone outside the chat can''t, even with the path', 'mallory',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos' and name = '20000000-0000-4000-8000-000000000001/c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6.jpg'$q$, 'rows:0');
select qa.check('dm photos', 'a friend in a different chat can''t either', 'carol',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos'$q$, 'rows:0');
select qa.check('dm photos', 'signed out, nothing', 'anon',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos'$q$, 'rows:0');
select qa.check('dm photos', 'delete a photo from someone else''s chat', 'mallory',
  $q$delete from storage.objects where bucket_id = 'dm-photos'$q$, 'denied');
select qa.check('dm photos', 'replace a photo in someone else''s chat', 'mallory',
  $q$update storage.objects set name = name where bucket_id = 'dm-photos'$q$, 'denied');

-- =======================================================================
-- 15. Photo links must be real uploads, in your own space
-- =======================================================================
select qa.check('photo links', 'post a photo hosted on an outside server (logs viewers'' IPs)', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://evil.example/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'post someone else''s photo by copying its link', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/aaaaaaaa-0000-4000-8000-000000000001/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'post a photo that was never uploaded', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'posting your own uploaded photo still works', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg')$q$, :mallory), 'rows:1');
select qa.check('photo links', 'editing an older post (photo from before this) still works', 'alice',
  $q$update public.posts set blurb = 'edited' where id = '10000000-0000-4000-8000-0000000000a1'$q$, 'rows:1');
select qa.check('photo links', 'use someone else''s photo as your avatar', 'mallory',
  format($q$update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/photos/aaaaaaaa-0000-4000-8000-000000000001/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.jpg' where id = %L$q$, :mallory), 'denied');
select qa.check('photo links', 'use an outside server for your avatar', 'mallory',
  format($q$update public.users set avatar_url = 'https://evil.example/me.jpg' where id = %L$q$, :mallory), 'denied');
select qa.check('photo links', 'setting your own uploaded avatar still works', 'mallory',
  format($q$update public.users set avatar_url = 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg' where id = %L$q$, :mallory), 'rows:1');
select qa.check('photo links', 'comment with a photo from an outside server', 'mallory',
  format($q$insert into public.comments (post_id, user_id, image_url) values ('10000000-0000-4000-8000-0000000000a1', %L, 'https://evil.example/x.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'send a DM photo as a public link (DM photos must be private)', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, image_url) values ('20000000-0000-4000-8000-000000000003', %L, 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'send a photo that belongs to a different chat', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, image_path) values ('20000000-0000-4000-8000-000000000003', %L, '20000000-0000-4000-8000-000000000001/c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'send a photo that was never uploaded', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, image_path) values ('20000000-0000-4000-8000-000000000003', %L, '20000000-0000-4000-8000-000000000003/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg')$q$, :mallory), 'denied');
select qa.check('photo links', 'sending your own uploaded DM photo still works', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, image_path) values ('20000000-0000-4000-8000-000000000003', %L, '20000000-0000-4000-8000-000000000003/d8d8d8d8d8d8d8d8d8d8d8d8d8d8d8d8.jpg')$q$, :mallory), 'rows:1');

-- =======================================================================
-- 16. Orphaned files
-- =======================================================================
select qa.fact('orphans', 'finds files nothing uses any more (older than a day), and only those',
  $q$select string_agg(o, ',' order by o) from public.storage_orphans(interval '1 day') o$q$,
  'dm-photos/20000000-0000-4000-8000-000000000001/c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7.jpg,photos/aaaaaaaa-0000-4000-8000-000000000001/a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2.jpg');
select qa.check('orphans', 'only the server can run the orphan search', 'mallory',
  $q$select count(*) from public.storage_orphans(interval '0')$q$, 'error');

-- =======================================================================
-- 17. Chats: leaving, pushes, live updates
-- =======================================================================
-- Policy: leaving a chat ends your access to all of it, old and new. Mallory
-- left the old group (…0004); she keeps nothing.
select qa.check('left chat', 'read the old group''s photos after leaving', 'mallory',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos' and name like '20000000-0000-4000-8000-000000000004/%'$q$, 'rows:0');
select qa.check('left chat', 'read the old group''s members after leaving', 'mallory',
  $q$select count(*) from public.conversation_members where conversation_id = '20000000-0000-4000-8000-000000000004'$q$, 'rows:0');
select qa.check('left chat', 'read the old group itself after leaving', 'mallory',
  $q$select count(*) from public.conversations where id = '20000000-0000-4000-8000-000000000004'$q$, 'rows:0');
select qa.check('left chat', 'send into the old group after leaving', 'mallory',
  format($q$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000004', %L, 'still here')$q$, :mallory), 'denied');
select qa.check('left chat', 'react in the old group after leaving', 'mallory',
  format($q$insert into public.message_reactions (message_id, user_id, emoji) values ('30000000-0000-4000-8000-000000000004', %L, 'x')$q$, :mallory), 'denied');
select qa.check('left chat', 'rename the old group after leaving', 'mallory',
  $q$update public.conversations set title = 'back' where id = '20000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('left chat', 'the people still in it see its photos', 'bob',
  $q$select count(*) from storage.objects where bucket_id = 'dm-photos' and name like '20000000-0000-4000-8000-000000000004/%'$q$, 'rows:1');

select qa.check('chat ids', 'moving your reaction to another of your own threads is fine', 'bob',
  $q$update public.message_reactions set message_id = '30000000-0000-4000-8000-000000000002' where message_id = '30000000-0000-4000-8000-000000000001'$q$, 'rows:1');
select qa.check('chat ids', 'move your reaction into a thread you are not in', 'bob',
  $q$update public.message_reactions set message_id = '30000000-0000-4000-8000-000000000003' where message_id = '30000000-0000-4000-8000-000000000001'$q$, 'denied');
select qa.check('chat ids', 'take over someone else''s reaction', 'mallory',
  format($q$update public.message_reactions set user_id = %L$q$, :mallory), 'denied');
select qa.check('chat ids', 'start a group with more people than a group can hold', 'mallory',
  $q$select count(*) from public.start_group_conversation(array(select gen_random_uuid() from generate_series(1, 40)))$q$,
  'error:A group chat can have at most 32 people');

select qa.fact('live updates', 'only Activity is broadcast live (chats are not)',
  $q$select coalesce(string_agg(schemaname || '.' || tablename, ',' order by tablename), '(none)')
     from pg_publication_tables where pubname = 'supabase_realtime'$q$, 'public.notifications');

select qa.check('push', 'only the server can mark a message as pushed', 'mallory',
  $q$select count(*) from (select public.claim_message_push('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004')) s$q$, 'error');
select qa.fact('push', 'a message is pushed once, then never again',
  $q$select public.claim_message_push('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004')::text
     || ',' || public.claim_message_push('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004')::text$q$,
  'true,false');
select qa.fact('push', 'pushing a message into a different thread than it was sent in',
  $q$select public.claim_message_push('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001')::text$q$, 'false');
select qa.fact('push', 'pushing someone else''s message as yours',
  $q$select public.claim_message_push('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002')::text$q$, 'false');
select qa.fact('push', 'pushing a message to a thread you have left',
  $q$select public.claim_message_push('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000004')::text$q$, 'false');
select qa.check('push', 'a junk push token is refused', 'mallory',
  format($q$insert into public.push_tokens (user_id, token) values (%L, 'https://evil.example/hook')$q$, :mallory), 'denied');
select qa.check('push', 'a phone signed into a new account stops getting the old account''s messages', 'bob',
  $q$select qa.save_token_then_count_owners('ExponentPushToken[alice]')$q$, 'rows:1');
select qa.check('push', 'saving your own token still works', 'mallory',
  $q$select qa.save_token_then_count_owners('ExponentPushToken[mallory-phone]')$q$, 'rows:1');

-- =======================================================================
-- 18. Sessions: signed out, deleted or banned means locked out now
-- =======================================================================
-- A token stays cryptographically valid until it expires (an hour), so on its
-- own the API would keep honouring it after sign-out or account deletion. The
-- per-request check (public.check_request, run by PostgREST before every
-- request) refuses any token whose session is gone.
select qa.fact('sessions', 'a signed-in phone works',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000001","session_id":"5e550000-0000-4000-8000-000000000001"}')$q$, 'ok');
select qa.fact('sessions', 'after signing out, the old token is refused',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000001","session_id":"5e550000-0000-4000-8000-0000000000ff"}')$q$, 'refused');
select qa.fact('sessions', 'someone else''s session id doesn''t help',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"dddddddd-0000-4000-8000-000000000004","session_id":"5e550000-0000-4000-8000-000000000001"}')$q$, 'refused');
select qa.fact('sessions', 'after deleting the account, the old token is refused',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"88888888-0000-4000-8000-000000000008","session_id":"5e550000-0000-4000-8000-000000000008"}')$q$, 'refused');
select qa.fact('sessions', 'a soft-deleted account is refused',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"77777777-0000-4000-8000-000000000007","session_id":"5e550000-0000-4000-8000-000000000007"}')$q$, 'refused');
select qa.fact('sessions', 'a banned account is refused straight away',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"99999999-0000-4000-8000-000000000009","session_id":"5e550000-0000-4000-8000-000000000009"}')$q$, 'refused');
select qa.fact('sessions', 'a session past its time limit is refused',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"ffffffff-0000-4000-8000-000000000006","session_id":"5e550000-0000-4000-8000-000000000006"}')$q$, 'refused');
select qa.fact('sessions', 'a signed-in token that names no session is refused',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000001"}')$q$, 'refused');
select qa.fact('sessions', 'a session id that isn''t an id is refused (no error leak)',
  $q$select qa.request('authenticated', '{"role":"authenticated","sub":"aaaaaaaa-0000-4000-8000-000000000001","session_id":"x'' or 1=1"}')$q$, 'refused');
select qa.fact('sessions', 'signed-out visitors are unaffected',
  $q$select qa.request('anon', '{"role":"anon"}')$q$, 'ok');
select qa.fact('sessions', 'the server is unaffected',
  $q$select qa.request('service_role', '{"role":"service_role"}')$q$, 'ok');
select qa.fact('sessions', 'every API request runs the check',
  $q$select (coalesce((select array_to_string(setconfig, ',') from pg_db_role_setting
                       where setrole = 'authenticator'::regrole and setdatabase = 0), '')
             like '%pgrst.db_pre_request=public.check_request%')::text$q$, 'true');

-- =======================================================================
-- 19. AI allowance and recipe data
-- =======================================================================
-- Every recipe card and nutrition estimate costs money. Three meters: per
-- person per day, per person per minute, and the whole app per day (the
-- ceiling on what many accounts together can spend).
select qa.fact('ai', 'a person gets their daily allowance, then no more',
  $q$select qa.ai_calls('aaaaaaaa-0000-4000-8000-000000000001', 5, 3, 100, 1000)$q$, 'tttff');
select qa.fact('ai', 'bursts are capped per minute',
  $q$select qa.ai_calls('bbbbbbbb-0000-4000-8000-000000000002', 8, 100, 6, 1000)$q$, 'ttttttff');
select qa.fact('ai', 'one person hitting their limit doesn''t affect another',
  $q$select qa.ai_calls('cccccccc-0000-4000-8000-000000000003', 2, 3, 6, 1000)$q$, 'tt');
select qa.fact('ai', 'the whole app stops at its daily ceiling, however many accounts ask',
  $q$select qa.ai_calls('ffffffff-0000-4000-8000-000000000006', 3, 100, 100, 2)
     || qa.ai_calls('eeeeeeee-0000-4000-8000-000000000005', 1, 100, 100, 0)$q$, 'ttff');
select qa.check('ai', 'read the app-wide AI meter', 'mallory',
  $q$select count(*) from public.ai_usage_global$q$, 'denied');
select qa.check('ai', 'spend the app-wide AI allowance (consume_ai_quota)', 'mallory',
  format($q$select count(*) from (select public.consume_ai_quota(%L, 1000, 1000, 100000)) s$q$, :mallory), 'error');

-- Recipe cards are rendered for everyone who sees the post, so their JSON must
-- be the documented shape: one malformed card must not break other people's
-- apps (an object where text belongs crashes the screen that draws it).
select qa.check('recipe data', 'an ingredient that is an object, not text', 'mallory',
  $q$update public.recipes set ingredients = '[{"item":{"x":1},"quantity":"","unit":""}]' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'an ingredient that is null', 'mallory',
  $q$update public.recipes set ingredients = '[null]' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'an ingredient that is a bare string', 'mallory',
  $q$update public.recipes set ingredients = '["salt"]' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'an ingredient name 5,000 characters long', 'mallory',
  format($q$update public.recipes set ingredients = jsonb_build_array(jsonb_build_object('item', %L, 'quantity', '', 'unit', '')) where id = '60000000-0000-4000-8000-000000000004'$q$, repeat('x', 5000)), 'denied');
select qa.check('recipe data', 'a step that is an object', 'mallory',
  $q$update public.recipes set steps = '["Chop.", {"evil": true}]' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'nutrition that is text', 'mallory',
  $q$update public.recipes set nutrition = '{"calories":"lots"}' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'negative nutrition', 'mallory',
  $q$update public.recipes set nutrition = '{"calories":-500}' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'nutrition inside an ingredient that is malformed', 'mallory',
  $q$update public.recipes set ingredients = '[{"item":"salt","quantity":"1","unit":"tsp","grams":"x"}]' where id = '60000000-0000-4000-8000-000000000004'$q$, 'denied');
select qa.check('recipe data', 'a well-formed card still saves', 'mallory',
  $q$update public.recipes set ingredients = '[{"item":"potatoes","quantity":"2","unit":""},{"item":"salt","quantity":"","unit":"","grams":1.5,"fdc_id":123,"nutrition":{"calories":0,"sodium_mg":580}}]',
       steps = '["Slice.","Fry."]', nutrition = '{"calories":320.5,"protein_g":4,"carbs_g":40,"fat_g":17,"fiber_g":3,"sugar_g":0,"sodium_mg":580}', servings = 2
     where id = '60000000-0000-4000-8000-000000000004'$q$, 'rows:1');

-- =======================================================================
-- 20. Spam, duplicates, impersonation
-- =======================================================================
-- Rate limits apply to app requests (a signed-in token), per person.
select qa.check('spam', 'flood a DM: 30 a minute go through, then it stops', 'mallory',
  $q$select qa.repeat($r$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004', 'spam %s')$r$, 40)$q$, 'rows:30');
select qa.check('spam', 'flood a post with comments: 20 in five minutes, then it stops', 'mallory',
  $q$select qa.repeat($r$insert into public.comments (post_id, user_id, text) values ('10000000-0000-4000-8000-0000000000a1', 'dddddddd-0000-4000-8000-000000000004', 'spam %s')$r$, 30)$q$, 'rows:20');
select qa.check('spam', 'flood the feedback inbox: 10 a day, then it stops', 'mallory',
  $q$select qa.repeat($r$insert into public.feedback (user_id, kind, message) values ('dddddddd-0000-4000-8000-000000000004', 'bug', 'spam %s')$r$, 15)$q$, 'rows:10');
select qa.check('spam', 'one person''s limit doesn''t touch anyone else''s', 'alice',
  $q$select qa.repeat($r$insert into public.messages (conversation_id, sender_id, text) values ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'hi %s')$r$, 5)$q$, 'rows:5');
select qa.fact('spam', 'everything people can create is rate limited',
  $q$select string_agg(c.relname || ':' || t.tgname, ',' order by c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgfoid = 'public.limit_rate()'::regprocedure and not t.tgisinternal$q$,
  'collections:collections_limit_rate,comment_reactions:comment_reactions_limit_rate,comments:comments_limit_rate,conversations:conversations_limit_rate,feedback:feedback_limit_rate,follows:follows_limit_rate,message_reactions:message_reactions_limit_rate,messages:messages_limit_rate,post_tags:post_tags_limit_rate,posts:posts_limit_rate,reactions:reactions_limit_rate,reports:reports_limit_rate,reposts:reposts_limit_rate,shares:shares_limit_rate');
select qa.check('spam', 'read or reset anyone''s rate-limit counters', 'mallory',
  $q$select count(*) from public.action_usage$q$, 'denied');

select qa.check('duplicates', 'post the same photo twice (a double tap)', 'mallory',
  $q$select qa.repeat($r$insert into public.posts (user_id, meal_slot, photo_url) values ('dddddddd-0000-4000-8000-000000000004', 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg')$r$, 2)$q$, 'rows:1');
select qa.check('duplicates', 'the same comment twice in a row', 'mallory',
  $q$select qa.repeat($r$insert into public.comments (post_id, user_id, text) values ('10000000-0000-4000-8000-0000000000a1', 'dddddddd-0000-4000-8000-000000000004', 'yum')$r$, 2)$q$, 'rows:1');

select qa.check('impersonation', 'a display name with direction-flipping characters (disguises the name)', 'mallory',
  format($q$update public.users set display_name = E'Alice‮ecila' where id = %L$q$, :mallory), 'denied');
select qa.check('impersonation', 'a display name on two lines (fakes a second line, like a badge)', 'mallory',
  format($q$update public.users set display_name = E'Alice\nOfficial' where id = %L$q$, :mallory), 'denied');
select qa.check('impersonation', 'hidden control characters in a comment', 'mallory',
  $q$insert into public.comments (post_id, user_id, text) values ('10000000-0000-4000-8000-0000000000a1', 'dddddddd-0000-4000-8000-000000000004', E'hi\u0007‮there')$q$, 'denied');
select qa.check('impersonation', 'emoji (joined ones too) still fine in a name, and a bio can have lines', 'mallory',
  format($q$update public.users set display_name = E'Mallory \U0001F468‍\U0001F373', bio = E'line one\nline two' where id = %L$q$, :mallory), 'rows:1');
select qa.check('impersonation', 'sign up with a staff-looking handle', 'newbie',
  $q$insert into public.users (id, handle, display_name) values ('12121212-0000-4000-8000-000000000012', 'NiblGo_Support', 'Support')$q$, 'error:That handle is taken');
select qa.check('impersonation', 'sign up as admin', 'newbie',
  $q$insert into public.users (id, handle, display_name) values ('12121212-0000-4000-8000-000000000012', 'admin', 'Admin')$q$, 'error:That handle is taken');
select qa.check('impersonation', 'sign up with an ordinary handle still works', 'newbie',
  $q$insert into public.users (id, handle, display_name) values ('12121212-0000-4000-8000-000000000012', 'newbie', 'Newbie')$q$, 'rows:1');
select qa.check('impersonation', 'make a profile for someone else''s account', 'newbie',
  $q$insert into public.users (id, handle, display_name) values ('eeeeeeee-0000-4000-8000-000000000099', 'ghost', 'Ghost')$q$, 'denied');
select qa.check('push', 'a push token with a huge platform name', 'mallory',
  format($q$insert into public.push_tokens (user_id, token, platform) values (%L, 'ExponentPushToken[m2]', repeat('x', 5000))$q$, :mallory), 'denied');

-- =======================================================================
-- 21. Deleting an account
-- =======================================================================
-- Zed has a bit of everything: a post, a comment on Alice's post, a like, a
-- follow both ways, a DM, a push token, feedback, a report he filed, and a
-- report Alice filed about his comment. Then the account is deleted the way
-- delete-account does it (the auth user goes, everything cascades).
insert into auth.users (id) values ('2e2e2e2e-0000-4000-8000-000000000021');
insert into public.users (id, handle, display_name) values ('2e2e2e2e-0000-4000-8000-000000000021', 'zed', 'Zed');
insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('10000000-0000-4000-8000-0000000000e1', '2e2e2e2e-0000-4000-8000-000000000021', 'lunch', 'https://x.supabase.co/z.jpg', 'zed lunch');
insert into public.comments (id, post_id, user_id, text) values
  ('40000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000a1', '2e2e2e2e-0000-4000-8000-000000000021', 'zed was here');
insert into public.reactions (post_id, user_id) values ('10000000-0000-4000-8000-0000000000a1', '2e2e2e2e-0000-4000-8000-000000000021');
insert into public.follows (follower_id, followee_id) values
  ('2e2e2e2e-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '2e2e2e2e-0000-4000-8000-000000000021');
insert into public.conversations (id, is_group) values ('20000000-0000-4000-8000-0000000000e1', false);
insert into public.conversation_members (conversation_id, user_id) values
  ('20000000-0000-4000-8000-0000000000e1', '2e2e2e2e-0000-4000-8000-000000000021'),
  ('20000000-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.messages (conversation_id, sender_id, text) values
  ('20000000-0000-4000-8000-0000000000e1', '2e2e2e2e-0000-4000-8000-000000000021', 'private zed text');
insert into public.push_tokens (user_id, token) values ('2e2e2e2e-0000-4000-8000-000000000021', 'ExponentPushToken[zed]');
insert into public.feedback (user_id, kind, message, handle_snapshot) values
  ('2e2e2e2e-0000-4000-8000-000000000021', 'bug', 'zed feedback', 'zed');
insert into public.reports (reporter_id, post_id, reported_user_id, reason) values
  ('2e2e2e2e-0000-4000-8000-000000000021', '10000000-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000002', 'spam');
insert into public.reports (id, reporter_id, comment_id, reported_user_id, reason, comment_text_snapshot) values
  ('70000000-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000e1',
   '2e2e2e2e-0000-4000-8000-000000000021', 'harassment', 'zed was here'),
  ('70000000-0000-4000-8000-0000000000e2', 'aaaaaaaa-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000e1',
   '2e2e2e2e-0000-4000-8000-000000000021', 'spam', 'zed was here');
select qa.fact('deletion', 'before: the account has data all over',
  $q$select (qa.rows_pointing_at('2e2e2e2e-0000-4000-8000-000000000021') <> '(none)')::text$q$, 'true');
delete from auth.users where id = '2e2e2e2e-0000-4000-8000-000000000021';

select qa.fact('deletion', 'after: nothing anywhere still points at the account',
  $q$select qa.rows_pointing_at('2e2e2e2e-0000-4000-8000-000000000021')$q$, '(none)');
select qa.fact('deletion', 'their posts, comments and DMs are gone',
  $q$select (select count(*) from public.posts where blurb = 'zed lunch') + (select count(*) from public.comments where text = 'zed was here')
          + (select count(*) from public.messages where text = 'private zed text')$q$, '0');
select qa.fact('deletion', 'feedback they sent is kept for the team, but no longer names them',
  $q$select coalesce(handle_snapshot, '(no name)') || ', ' || coalesce(user_id::text, '(no account)') from public.feedback where message = 'zed feedback'$q$,
  '(no name), (no account)');
select qa.fact('deletion', 'a report they filed stays for moderators, without them',
  $q$select count(*)::text || ', ' || coalesce(max(reporter_id::text), '(no reporter)') from public.reports where post_id = '10000000-0000-4000-8000-0000000000b2' and reason = 'spam' and reporter_id is null$q$,
  '1, (no reporter)');
select qa.fact('deletion', 'a report about them stays open for moderators, without the account',
  $q$select coalesce(reported_user_id::text, '(no account)') || ', ' || coalesce(comment_text_snapshot, '(nothing)') from public.reports where id = '70000000-0000-4000-8000-0000000000e1'$q$,
  '(no account), zed was here');

-- Report copies aren't kept for ever: once a report is closed and old enough
-- (two years by default; 90 days here), what it copied is cleared (the daily
-- sweep runs this).
update public.reports set status = 'dismissed', reviewed_at = now() - interval '100 days'
where id = '70000000-0000-4000-8000-0000000000e1';
update public.reports set created_at = now() - interval '100 days' where id = '70000000-0000-4000-8000-0000000000e2';
select qa.fact('retention', 'the sweep clears closed reports older than 90 days (one here)',
  $q$select public.redact_closed_reports(interval '90 days')::text$q$, '1');
select qa.fact('retention', 'that report no longer holds what they wrote, but is still there',
  $q$select coalesce(comment_text_snapshot, '(cleared)') || ', ' || status from public.reports where id = '70000000-0000-4000-8000-0000000000e1'$q$,
  '(cleared), dismissed');
select qa.fact('retention', 'an open report keeps its copy however old',
  $q$select coalesce(comment_text_snapshot, '(cleared)') from public.reports where id = '70000000-0000-4000-8000-0000000000e2'$q$, 'zed was here');
select qa.check('retention', 'only the server can clear reports', 'mallory',
  $q$select count(*) from (select public.redact_closed_reports(interval '0')) s$q$, 'error');

-- =======================================================================
-- 22. Hashtags
-- =======================================================================
-- Up to 5 per post, only from the list (0039). The list itself is read-only.
select qa.check('hashtags', 'tag your own post from the list', 'mallory',
  $q$update public.posts set hashtags = '{mexican,budget}' where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'rows:1');
select qa.check('hashtags', 'a tag that isn''t on the list', 'mallory',
  $q$update public.posts set hashtags = '{freecrypto}' where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'error:Pick hashtags from the list');
select qa.check('hashtags', 'a slur or a link dressed up as a tag', 'mallory',
  $q$update public.posts set hashtags = array['visit-my-site.com'] where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'error:Pick hashtags from the list');
select qa.check('hashtags', 'more than 5 tags', 'mallory',
  $q$update public.posts set hashtags = '{mexican,budget,spicy,vegan,keto,brunch}' where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'error:A post can have up to 5 hashtags');
select qa.check('hashtags', 'the same tag over and over (to rank higher)', 'mallory',
  $q$update public.posts set hashtags = '{mexican,mexican,mexican}' where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'error:Each hashtag can only be added once');
select qa.check('hashtags', 'a new post with a tag off the list', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url, hashtags) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg', '{freecrypto}')$q$, :mallory),
  'error:Pick hashtags from the list');
select qa.check('hashtags', 'a new post with tags from the list', 'mallory',
  format($q$insert into public.posts (user_id, meal_slot, photo_url, hashtags) values (%L, 'dinner', 'https://x.supabase.co/storage/v1/object/public/photos/dddddddd-0000-4000-8000-000000000004/d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4.jpg', '{chinese,healthy}')$q$, :mallory),
  'rows:1');
select qa.check('hashtags', 'no tags at all (null) just means none', 'mallory',
  $q$update public.posts set hashtags = null where id = '10000000-0000-4000-8000-0000000000d4'$q$, 'rows:1');
select qa.check('hashtags', 'tag someone else''s post', 'mallory',
  $q$update public.posts set hashtags = '{expensive}' where id = '10000000-0000-4000-8000-0000000000a1'$q$, 'denied');
select qa.check('hashtags', 'add your own tag to the list', 'mallory',
  $q$insert into public.hashtags (tag, category) values ('freecrypto', 'vibe')$q$, 'denied');
select qa.check('hashtags', 'take a tag off the list', 'mallory',
  $q$delete from public.hashtags where tag = 'mexican'$q$, 'denied');
select qa.check('hashtags', 'rename a tag on the list', 'mallory',
  $q$update public.hashtags set tag = 'freecrypto' where tag = 'mexican'$q$, 'denied');
select qa.check('hashtags', 'anyone signed in can read the list', 'bob',
  $q$select count(*) from public.hashtags$q$, 'rows:53');
-- Alice tags her dinner; Bob finds it by the tag, Eve (who Alice blocked) doesn't.
update public.posts set hashtags = '{chinese,budget}' where id = '10000000-0000-4000-8000-0000000000a1';
select qa.check('hashtags', 'search a tag and find the post', 'bob',
  $q$select count(*) from public.posts where hashtags && '{chinese}' and id = '10000000-0000-4000-8000-0000000000a1'$q$, 'rows:1');
select qa.check('hashtags', 'someone you blocked can''t find you through a tag', 'eve',
  $q$select count(*) from public.posts where hashtags && '{chinese}' and id = '10000000-0000-4000-8000-0000000000a1'$q$, 'rows:0');
select qa.fact('hashtags', 'tag search uses the index, not a scan of every post',
  $q$select (count(*) > 0)::text from pg_indexes where tablename = 'posts' and indexname = 'posts_hashtags_idx'$q$, 'true');
select qa.fact('hashtags', 'older posts without tags are untouched',
  $q$select count(*)::text from public.posts where hashtags = '{}' and id = '10000000-0000-4000-8000-0000000000b2'$q$, '1');

-- ------------------------------------------------------------- report
\echo
\echo '================ results ================'
select case when passed then 'PASS' else 'FAIL' end as result, area, name, who,
       want, left(got, 90) as got
from qa.results order by n;

select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total
from qa.results;

do $$
declare f int := (select count(*) from qa.results where not passed);
begin
  if f > 0 then raise exception '% security check(s) failed', f; end if;
end $$;
