-- Expo push tokens, so the server can send a push when you get a DM.
--
-- One row per (user, device token). The app upserts its token on launch; the
-- notify-message edge function reads recipients' tokens with the service role
-- (bypassing RLS) to send the push. Users can only see/manage their own.
create table if not exists public.push_tokens (
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "manage own push tokens" on public.push_tokens;
create policy "manage own push tokens" on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
