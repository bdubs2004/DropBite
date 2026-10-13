-- 0032: Direct messages and group chats, hardened for outside testing.
--
-- Reading, sending and membership were already members-only (0030/0031, and
-- supabase/tests/rls_attack_test.sql proves it). What's left is around the
-- edges:
--
--   1. Message pushes. notify-message pushed whatever message id it was handed,
--      as often as it was called, under whatever thread id came with it. Now the
--      server claims each message once (claim_message_push): only a fresh
--      message, sent by the caller, in the thread named, while they're still in
--      it. Calling it again sends nothing.
--   2. Push tokens. A phone that signed out of one account and into another
--      kept getting the first account's DMs on its lock screen, because the
--      token stayed on both accounts. A token now belongs to one account: saving
--      it moves it. Tokens must look like Expo tokens, and an account keeps at
--      most 10 (old phones drop off).
--   3. Group size. A group chat holds at most 32 people.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. Message pushes ------------------------------------------------------------------------
alter table public.messages add column if not exists pushed_at timestamptz;

-- Called by notify-message with the service role. True means: push it now,
-- and nobody will be told to push it again.
create or replace function public.claim_message_push(msg uuid, conv uuid, sender uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messages m
  set pushed_at = now()
  where m.id = msg
    and m.conversation_id = conv
    and m.sender_id = sender
    and m.kind = 'message'
    and m.pushed_at is null
    and m.created_at > now() - interval '5 minutes'
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conv and cm.user_id = sender
    );
  return found;
end;
$$;
revoke all on function public.claim_message_push(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_message_push(uuid, uuid, uuid) to service_role;

-- 2. Push tokens --------------------------------------------------------------------------
create or replace function public.push_token_one_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'Not a push token' using errcode = '22023';
  end if;
  -- The phone is someone else's now (or theirs on another account): it stops
  -- getting the previous account's notifications.
  delete from public.push_tokens
  where token = new.token and user_id <> new.user_id;
  -- Keep the 9 most recent others plus this one.
  delete from public.push_tokens p
  where p.user_id = new.user_id
    and p.token <> new.token
    and p.token not in (
      select q.token from public.push_tokens q
      where q.user_id = new.user_id and q.token <> new.token
      order by q.updated_at desc
      limit 9
    );
  return new;
end;
$$;
revoke all on function public.push_token_one_account() from public, anon, authenticated;

drop trigger if exists push_token_one_account on public.push_tokens;
create trigger push_token_one_account before insert or update of token, user_id on public.push_tokens
  for each row execute function public.push_token_one_account();

-- Tokens that were on more than one account before this: keep the newest.
delete from public.push_tokens p
using public.push_tokens q
where p.token = q.token
  and p.user_id <> q.user_id
  and (p.updated_at, p.user_id::text) < (q.updated_at, q.user_id::text);

-- 3. Group size ---------------------------------------------------------------------------
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

  -- You plus 31 others. Checked first, so a huge list costs nothing.
  if (select count(distinct u) from unnest(coalesce(targets, '{}'::uuid[])) u
      where u is not null and u <> me) > 31 then
    raise exception 'A group chat can have at most 32 people.';
  end if;

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

revoke all on function public.start_group_conversation(uuid[]) from public, anon;
grant execute on function public.start_group_conversation(uuid[]) to authenticated;
