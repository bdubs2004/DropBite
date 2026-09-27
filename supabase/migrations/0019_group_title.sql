-- Let a group thread be given a name. NULL means "no custom name" — the app
-- falls back to listing the members. Any member may set it: the existing
-- "touch own conversations" UPDATE policy (members only) already covers this
-- column, so no new policy is needed.
alter table public.conversations add column if not exists title text;

do $$
begin
  alter table public.conversations
    add constraint conversations_title_len
    check (title is null or char_length(title) <= 60);
exception
  when duplicate_object then null;
end $$;
