-- Reactions on DMs: double-tap a message for a heart, or long-press to pick
-- an emoji. One reaction per person per message; picking another replaces it.
--
-- Only people in the thread can see or add them (the messages policy already
-- limits which messages you can see, and these checks lean on it), and nobody
-- can react across a block.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  emoji text not null constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "message reactions readable in own threads" on public.message_reactions;
create policy "message reactions readable in own threads" on public.message_reactions
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_id)
  );
drop policy if exists "react to messages as self" on public.message_reactions;
create policy "react to messages as self" on public.message_reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
        and not public.conversation_has_block(m.conversation_id, auth.uid())
    )
  );
drop policy if exists "change own message reaction" on public.message_reactions;
create policy "change own message reaction" on public.message_reactions
  for update to authenticated using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
        and not public.conversation_has_block(m.conversation_id, auth.uid())
    )
  );
drop policy if exists "remove own message reaction" on public.message_reactions;
create policy "remove own message reaction" on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());
