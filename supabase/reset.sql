-- ⚠️  DESTRUCTIVE — NiblGo: wipe the database and start over
--
-- This DELETES EVERY ACCOUNT, POST, PHOTO RECORD AND MESSAGE. Only run it on a
-- project you are still setting up. There is no undo.
--
-- You almost certainly do NOT need this. `schema.sql` is safe to run more than
-- once, so if you hit an error like:
--
--     ERROR: 42710: type "meal_slot" already exists
--
-- just run `schema.sql` again — it will fill in whatever is missing and leave
-- your data alone. Use this file only when you want a genuinely clean slate.
--
-- Afterwards, run `schema.sql`, then `verify.sql` to confirm.

-- A guard, so this can't wipe a live app by being pasted into the wrong
-- project: it refuses when there are more than 5 accounts, unless you add
-- this line at the very top, in the same run:
--
--     set niblgo.confirm_reset = 'wipe everything';
--
-- It all runs as one transaction, so a refusal changes nothing.
begin;

do $$
declare
  accounts bigint := (select count(*) from auth.users);
begin
  if accounts > 5 and current_setting('niblgo.confirm_reset', true) is distinct from 'wipe everything' then
    raise exception 'Refusing to wipe a database with % accounts. If you really mean to, put  set niblgo.confirm_reset = ''wipe everything'';  at the top and run again.', accounts;
  end if;
end
$$;

-- The API checks every request with public.check_request() (0033), which is
-- about to be dropped. Switch that off first, or every request fails until
-- schema.sql has been run again (schema.sql switches it back on).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator reset pgrst.db_pre_request;
    perform pg_notify('pgrst', 'reload config');
  end if;
exception when others then
  raise warning 'Could not switch off the session check (%); run schema.sql straight after this.', sqlerrm;
end
$$;

-- Everything the app owns lives in `public`, so dropping the schema takes the
-- tables, policies, functions, triggers and the meal_slot type with it.
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;

-- Auth users are separate from public.users and would otherwise be orphaned:
-- sign-up would then fail with a duplicate-email error for an account you can
-- no longer see in the app.
delete from auth.users;

-- Uploaded photos (public and DM), and the buckets themselves. schema.sql
-- recreates them with the right privacy, size and type limits.
delete from storage.objects where bucket_id in ('photos', 'dm-photos');
delete from storage.buckets where id in ('photos', 'dm-photos');

drop policy if exists "photos public read" on storage.objects;
drop policy if exists "read own photos" on storage.objects;
drop policy if exists "read photos in own chats" on storage.objects;
drop policy if exists "upload own photos" on storage.objects;
drop policy if exists "delete own photos" on storage.objects;

commit;
