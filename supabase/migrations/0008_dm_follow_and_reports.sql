-- NiblGo: DMs are follow-gated, and DM messages can be reported
--
-- Run this if your database predates those. A fresh `schema.sql` already
-- includes them. Safe to run more than once.

-- ------------------------------------------------ only DM people you follow
-- SECURITY DEFINER because the policy on public.follows hides rows belonging
-- to private accounts, and a private account must still be able to start a
-- conversation.
create or replace function public.is_following(who uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follows f
    where f.follower_id = who and f.followee_id = target
  );
$$;

revoke all on function public.is_following(uuid, uuid) from public;
grant execute on function public.is_following(uuid, uuid) to authenticated;

-- Gates *starting* a conversation, not replying in one: once a thread exists
-- both members can send, so the person you messaged can answer without having
-- to follow you back.
drop policy if exists "join conversations" on public.conversation_members;
create policy "join conversations" on public.conversation_members
  for insert to authenticated with check (
    (user_id = auth.uid() and public.conversation_is_empty(conversation_id))
    or (
      public.is_conversation_member(conversation_id, auth.uid())
      and (user_id = auth.uid() or public.is_following(auth.uid(), user_id))
    )
  );

-- ------------------------------------------------------- reporting a message
alter table public.reports
  add column if not exists message_id uuid references public.messages (id) on delete set null,
  add column if not exists message_text_snapshot text,
  add column if not exists message_image_url_snapshot text;

alter table public.reports
  drop constraint if exists reports_message_text_snapshot_check,
  add  constraint reports_message_text_snapshot_check check (
    message_text_snapshot is null or char_length(message_text_snapshot) <= 2000
  );

alter table public.reports
  drop constraint if exists reports_message_image_url_snapshot_check,
  add  constraint reports_message_image_url_snapshot_check check (
    message_image_url_snapshot is null or char_length(message_image_url_snapshot) <= 1000
  );
