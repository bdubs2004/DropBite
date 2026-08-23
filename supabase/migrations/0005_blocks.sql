-- NiblGo: user blocking
--
-- Required alongside reporting for App Store Guideline 1.2. Run this if your
-- database predates blocking; a fresh schema.sql already includes it.
-- Safe to run more than once.

create table if not exists public.blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

-- Stored one-directionally, symmetric in effect. SECURITY DEFINER because the
-- blocked party cannot read the blocks table but policies still need the
-- answer; the pinned empty search_path stops schema shadowing.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a)
  );
$$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

create or replace function public.conversation_has_block(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv
      and m.user_id <> who
      and public.is_blocked_pair(m.user_id, who)
  );
$$;

revoke all on function public.conversation_has_block(uuid, uuid) from public;
grant execute on function public.conversation_has_block(uuid, uuid) to authenticated;

-- You manage your own list and can only read your own: letting the blocked
-- party read the table would tell them they'd been blocked.
drop policy if exists "read own blocks" on public.blocks;
create policy "read own blocks" on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

drop policy if exists "block as self" on public.blocks;
create policy "block as self" on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());

drop policy if exists "unblock as self" on public.blocks;
create policy "unblock as self" on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- Blocking has to actually hide things, so the read policies get rewritten.
drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
  );

drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
  );

drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows
  for insert to authenticated with check (
    follower_id = auth.uid() and not public.is_blocked_pair(followee_id, auth.uid())
  );

-- Stops a blocked user carrying on through an existing thread.
drop policy if exists "send messages as self" on public.messages;
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
    and not public.conversation_has_block(conversation_id, auth.uid())
  );

-- Existing follows between newly-blocked users should not survive.
delete from public.follows f
where public.is_blocked_pair(f.follower_id, f.followee_id);
