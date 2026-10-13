-- A stand-in for the parts of Supabase that schema.sql builds on, close enough
-- that security tests mean the same thing here as on the real project.
--
-- What matters most, and what the older harness.sql leaves out:
--   * Supabase's default privileges: every table, function and sequence
--     created in `public` is granted to anon, authenticated and service_role.
--     That is how a function "nobody calls" ends up callable over the API, so
--     tests must start from the same grants.
--   * auth.uid() comes from the signed-in user's token (request.jwt.claims),
--     the way PostgREST hands it to Postgres. test.uid still works too, so the
--     older tests keep running.
--   * service_role bypasses RLS, like the real one.
--   * The storage tables, and the realtime publication.
--
-- Run it first, on an empty database, then schema.sql (or the migrations).

-- Supabase keeps extensions out of public, in their own schema.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter database postgres set search_path = "$user", public, extensions;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- The signed-in user's token, as PostgREST passes it.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('test.uid', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select auth.jwt() ->> 'role';
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Storage: the objects table the bucket policies sit on.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- Supabase's defaults for anything created in public from here on.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Realtime publishes through this; migration 0029 adds notifications to it.
do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null; end $$;
