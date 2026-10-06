-- Leave a group chat, and tell the people still in it.
--
-- Leaving posts a small "Dan left the chat" line into the thread (a message
-- with kind = 'left', shown centred like the day labels), then removes you.
-- Both happen in one server-side call so the line can't be faked or lost:
-- clients may only ever send ordinary messages.
--
-- Also remembers which threads are groups. Until now a thread was a "group"
-- only while it had 3+ members, so a group that dropped to two people would
-- have turned into (and been reused as) a 1:1 chat.
--
-- Safe to run more than once.

-- 1. Which threads are groups -------------------------------------------------
alter table public.conversations
  add column if not exists is_group boolean not null default false;

-- Existing threads: anything with a custom name or 3+ members is a group.
update public.conversations c
set is_group = true
where not c.is_group
  and (
    c.title is not null
    or (select count(*) from public.conversation_members m where m.conversation_id = c.id) > 2
  );

-- 2. System lines in a thread ----------------------------------------------------
alter table public.messages
  add column if not exists kind text not null default 'message';
alter table public.messages drop constraint if exists messages_kind_valid;
alter table public.messages
  add constraint messages_kind_valid check (kind in ('message', 'left'));

-- A "left" line carries no text or attachment; everything else still must.
create or replace function public.message_not_empty()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'message'
     and char_length(new.text) = 0
     and new.shared_post_id is null
     and new.image_url is null
     and new.shared_user_id is null then
    raise exception 'A message must carry something' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.message_not_empty() from public, anon, authenticated;

-- Clients send ordinary messages only; "left" lines come from leave_conversation.
drop policy if exists "send messages as self" on public.messages;
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and kind = 'message'
    and public.is_conversation_member(conversation_id, auth.uid())
    and not public.conversation_has_block(conversation_id, auth.uid())
  );

-- 3. Starting threads respects group-ness ---------------------------------------
-- A 1:1 is reused only if it was never a group; a group is reused only if it
-- is one. Otherwise these match the existing functions exactly.
create or replace function public.start_conversation(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  conv uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if target = me then raise exception 'You cannot message yourself.'; end if;
  if not exists (select 1 from public.users where id = target) then
    raise exception 'That account no longer exists.';
  end if;
  if not exists (
    select 1 from public.follows where follower_id = me and followee_id = target
  ) then
    raise exception 'You can only message people you follow. Follow them first.';
  end if;
  if public.is_blocked_pair(me, target) then
    raise exception 'You cannot message this person.';
  end if;

  -- Reuse only a strictly 1:1 thread (exactly the two of us), never a group,
  -- not even one that has dwindled to the two of us.
  select mc.conversation_id into conv
  from public.conversation_members mc
  join public.conversations c on c.id = mc.conversation_id and not c.is_group
  group by mc.conversation_id
  having array_agg(mc.user_id order by mc.user_id) = (
    select array_agg(u order by u) from (select me as u union select target) s
  )
  limit 1;
  if conv is not null then return conv; end if;

  insert into public.conversations default values returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
    values (conv, me, now());
  insert into public.conversation_members (conversation_id, user_id)
    values (conv, target);
  return conv;
end;
$$;

create or replace function public.start_group_conversation(targets uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  t uuid;
  wanted uuid[];
  grp boolean;
  conv uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;

  foreach t in array coalesce(targets, '{}'::uuid[]) loop
    if t is null or t = me then continue; end if;
    if not exists (select 1 from public.users where id = t) then
      raise exception 'One of those accounts no longer exists.';
    end if;
    if not exists (
      select 1 from public.follows where follower_id = me and followee_id = t
    ) then
      raise exception 'You can only message people you follow. Follow them first.';
    end if;
    if public.is_blocked_pair(me, t) then
      raise exception 'You cannot message one of those people.';
    end if;
  end loop;

  select array_agg(u order by u) into wanted
  from (
    select distinct unnest(array_append(coalesce(targets, '{}'::uuid[]), me)) as u
  ) s
  where u is not null;

  if array_length(wanted, 1) is null or array_length(wanted, 1) < 2 then
    raise exception 'Pick at least one person to message.';
  end if;
  grp := array_length(wanted, 1) > 2;

  select mc.conversation_id into conv
  from public.conversation_members mc
  join public.conversations c on c.id = mc.conversation_id and c.is_group = grp
  group by mc.conversation_id
  having array_agg(mc.user_id order by mc.user_id) = wanted
  limit 1;
  if conv is not null then return conv; end if;

  insert into public.conversations (is_group) values (grp) returning id into conv;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
    values (conv, me, now());
  foreach t in array wanted loop
    if t <> me then
      insert into public.conversation_members (conversation_id, user_id)
        values (conv, t);
    end if;
  end loop;
  return conv;
end;
$$;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;
revoke all on function public.start_group_conversation(uuid[]) from public, anon;
grant execute on function public.start_group_conversation(uuid[]) to authenticated;

-- 4. Leaving ---------------------------------------------------------------------
-- Leave a thread. In a group, first posts "<you> left the chat" for the people
-- still in it (and bumps the thread so they see it). In a 1:1 it just takes the
-- thread out of your inbox, as deleting one always has; nobody is told.
create or replace function public.leave_conversation(conv uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  grp boolean;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not public.is_conversation_member(conv, me) then return; end if;

  select c.is_group into grp from public.conversations c where c.id = conv;
  if coalesce(grp, false) then
    insert into public.messages (conversation_id, sender_id, text, kind)
      values (conv, me, '', 'left');
    update public.conversations set updated_at = now() where id = conv;
  end if;

  delete from public.conversation_members
  where conversation_id = conv and user_id = me;
end;
$$;

revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;
