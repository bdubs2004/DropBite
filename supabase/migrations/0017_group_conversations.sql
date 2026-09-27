-- Group DMs. The conversation_members table already allows any number of
-- members, so this is purely a new RPC to create a group in one atomic,
-- RLS-safe call (same pattern and rules as start_conversation), plus a fix so
-- opening a 1:1 never accidentally reuses a group you share with that person.

-- Start (or reuse) a group thread with several people at once. Enforces the
-- same opt-in rules as a 1:1: every target must be someone you follow and not
-- in a block relationship. Reuses an existing thread only when its member set
-- is exactly {you} + targets, so a group and a 1:1 never collide.
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
  conv uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;

  -- Validate each distinct target (skip yourself if you were included).
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

  -- The full member set we want, you included, distinct and sorted.
  select array_agg(u order by u) into wanted
  from (
    select distinct unnest(array_append(coalesce(targets, '{}'::uuid[]), me)) as u
  ) s
  where u is not null;

  if array_length(wanted, 1) is null or array_length(wanted, 1) < 2 then
    raise exception 'Pick at least one person to message.';
  end if;

  -- Reuse a thread whose members are exactly this set (order-independent).
  select mc.conversation_id into conv
  from public.conversation_members mc
  group by mc.conversation_id
  having array_agg(mc.user_id order by mc.user_id) = wanted
  limit 1;
  if conv is not null then return conv; end if;

  insert into public.conversations default values returning id into conv;
  -- You join as read-up-to-now; everyone else starts with the thread unread.
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

revoke all on function public.start_group_conversation(uuid[]) from public, anon;
grant execute on function public.start_group_conversation(uuid[]) to authenticated;

-- Fix 1:1 reuse: only reuse a thread that is exactly the two of you, so a
-- group you're both in is never returned as your private DM.
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

  -- Reuse only a strictly 1:1 thread (exactly the two of us), never a group.
  select mc.conversation_id into conv
  from public.conversation_members mc
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

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;
