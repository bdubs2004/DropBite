-- nibl: likes on comments
--
-- Run this if your database predates comment likes. A fresh `schema.sql`
-- already includes it. Safe to run more than once.

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One row per (comment, user) makes the like count idempotent by
  -- construction: double-tapping can never inflate it.
  primary key (comment_id, user_id)
);

create index if not exists comment_reactions_comment_idx
  on public.comment_reactions (comment_id);

alter table public.comment_reactions enable row level security;

-- Counts are public (they're rendered next to each comment); writes are
-- scoped to yourself, so nobody can like on someone else's behalf.
drop policy if exists "comment reactions readable" on public.comment_reactions;
create policy "comment reactions readable" on public.comment_reactions
  for select to authenticated using (true);

drop policy if exists "like comment as self" on public.comment_reactions;
create policy "like comment as self" on public.comment_reactions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "unlike comment as self" on public.comment_reactions;
create policy "unlike comment as self" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());
