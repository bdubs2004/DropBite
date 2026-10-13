-- 0033: Signing out, deleting your account or being banned locks the old token
-- out of the API straight away.
--
-- A Supabase access token is a signed JWT that stays valid until it expires (an
-- hour by default). The API (PostgREST) only checks the signature, so after
-- sign-out, account deletion or a ban, a copy of the token kept reading public
-- data and calling RPCs for up to an hour. The edge functions were already
-- safe: they ask Supabase Auth, which knows the session is gone.
--
-- PostgREST can run a function before every request (pgrst.db_pre_request).
-- check_request() looks up the session the token names (its session_id claim)
-- and refuses with a 401 unless that session still exists, belongs to the
-- token's user, hasn't passed its time limit, and the account isn't deleted or
-- banned. Signed-out visitors (anon) and the server (service_role) pass
-- straight through. It's two primary-key lookups per request.
--
-- Kill switch, if it ever misbehaves (run in the SQL Editor):
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
--
-- Safe to run more than once. Already folded into schema.sql.

create or replace function public.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  uid uuid;
  sid uuid;
  sess jsonb;
  usr jsonb;
begin
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;

  begin
    uid := (claims ->> 'sub')::uuid;
    sid := (claims ->> 'session_id')::uuid;
  exception when others then
    uid := null;
  end;

  if uid is not null and sid is not null then
    -- to_jsonb so a column Supabase Auth adds or drops never breaks requests.
    select to_jsonb(s) into sess from auth.sessions s where s.id = sid;
    select to_jsonb(u) into usr from auth.users u where u.id = uid;
  end if;

  if sess is null
     or usr is null
     or (sess ->> 'user_id')::uuid is distinct from uid
     or coalesce((sess ->> 'not_after')::timestamptz > now(), true) is not true
     or (usr ->> 'deleted_at') is not null
     or coalesce((usr ->> 'banned_until')::timestamptz <= now(), true) is not true then
    raise sqlstate 'PGRST' using
      message = '{"code":"session_ended","message":"Your session has ended. Please sign in again.","details":null,"hint":null}',
      detail = '{"status":401,"headers":{}}';
  end if;
end;
$$;
revoke all on function public.check_request() from public;
grant execute on function public.check_request() to anon, authenticated, service_role;

-- Turn it on, but only once it's been shown to work here: if this database
-- won't let the function read auth.sessions, switching it on would refuse
-- every signed-in request. verify.sql reports whether it's on.
do $$
begin
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.users limit 1;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.check_request';
    perform pg_notify('pgrst', 'reload config');
  end if;
exception when others then
  raise warning 'Session check NOT switched on (%). Signed-out tokens still work until they expire.', sqlerrm;
end
$$;
