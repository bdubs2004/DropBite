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

-- Uploaded photos, and the bucket itself. schema.sql recreates the bucket with
-- the right size and MIME limits.
delete from storage.objects where bucket_id = 'photos';
delete from storage.buckets where id = 'photos';

drop policy if exists "photos public read" on storage.objects;
drop policy if exists "upload own photos" on storage.objects;
drop policy if exists "delete own photos" on storage.objects;
