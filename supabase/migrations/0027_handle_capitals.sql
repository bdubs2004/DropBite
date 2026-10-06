-- Keep capitals in handles.
--
-- "JoeMama" now stays "JoeMama" instead of becoming "joemama". Two handles
-- that differ only in capitals are still the same handle, so nobody can sign
-- up as "joemama" once "JoeMama" exists (or pass as someone by changing the
-- case). Searching already ignores capitals.
--
-- Every existing handle is lowercase, so the new rule can't clash with them.
-- Safe to run more than once.

alter table public.users drop constraint if exists users_handle_format;
alter table public.users
  add constraint users_handle_format check (handle ~ '^[A-Za-z0-9_]{2,30}$');

create unique index if not exists users_handle_lower_key on public.users (lower(handle));
