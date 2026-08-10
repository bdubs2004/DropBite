-- nibl: direct messages
--
-- Run this if your database predates DMs. A fresh `schema.sql` already
-- includes it. Safe to run more than once.
--
-- DM rows are the most private data in the app: every policy below is
-- members-only, and nothing is readable outside the thread.

-- -------------------------------------------------------- direct messages
-- 1:1 threads today; the members table means group DMs need no migration.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Bumped on every message so the inbox can sort without a join.
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- When this member last opened the thread; drives the unread badge.
  last_read_at timestamptz not null default 'epoch',
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 2000),
  -- A shared post. SET NULL so deleting the post doesn't delete the message;
  -- the thread still reads sensibly, the attachment just goes away.
  shared_post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A message must carry something.
  check (char_length(text) > 0 or shared_post_id is not null)
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- Membership test used by every DM policy. SECURITY DEFINER with a pinned
-- empty search_path: without it, the policy on conversation_members would
-- need to query conversation_members, which recurses.
create or replace function public.is_conversation_member(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = who
  );
$$;

revoke all on function public.is_conversation_member(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

-- True only while a conversation has no members at all, i.e. the instant
-- after it is created. Used to let the creator add themselves without also
-- letting anyone add themselves to an existing thread.
create or replace function public.conversation_is_empty(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.conversation_members m where m.conversation_id = conv
  );
$$;

revoke all on function public.conversation_is_empty(uuid) from public;
grant execute on function public.conversation_is_empty(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "read own conversations" on public.conversations;
create policy "read own conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id, auth.uid()));
drop policy if exists "create conversations" on public.conversations;
create policy "create conversations" on public.conversations
  for insert to authenticated with check (true);
drop policy if exists "touch own conversations" on public.conversations;
create policy "touch own conversations" on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

drop policy if exists "read members of own conversations" on public.conversation_members;
create policy "read members of own conversations" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "join conversations" on public.conversation_members;
-- Two ways in, and no third:
--   * you are already a member, so you may add someone else; or
--   * the conversation is brand new and empty, so you may add yourself.
-- A bare `user_id = auth.uid()` is NOT enough: that would let anyone add
-- themselves to a stranger's existing thread and read the whole history.
create policy "join conversations" on public.conversation_members
  for insert to authenticated with check (
    public.is_conversation_member(conversation_id, auth.uid())
    or (user_id = auth.uid() and public.conversation_is_empty(conversation_id))
  );
drop policy if exists "update own membership" on public.conversation_members;
create policy "update own membership" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "leave conversations" on public.conversation_members;
create policy "leave conversations" on public.conversation_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read messages in own conversations" on public.messages;
create policy "read messages in own conversations" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "send messages as self" on public.messages;
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid())
  );
drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages
  for delete to authenticated using (sender_id = auth.uid());
