-- Start (or reuse) a 1:1 DM thread in one server-side call.
--
-- The client used to INSERT into `conversations`, then add members. But the
-- creator is not a member yet at insert time, so RLS blocked the insert on
-- databases missing the permissive insert policy, and even where the insert
-- succeeded the follow-up `.select()` could not return the new row (the SELECT
-- policy is members-only). This SECURITY DEFINER function does the whole thing
-- atomically and enforces the same rules the policies do:
--   * you may only open a thread with someone you follow (opt-in DMs); and
--   * not with anyone in a block relationship.
-- Direct-table RLS still guards every other access path.
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

  -- Reuse an existing shared 1:1 thread rather than stacking duplicates.
  select m1.conversation_id into conv
  from public.conversation_members m1
  join public.conversation_members m2
    on m2.conversation_id = m1.conversation_id
  where m1.user_id = me and m2.user_id = target
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

-- Belt-and-braces: ensure the base insert policy is present too, in case an
-- earlier migration did not land on this database.
alter table public.conversations enable row level security;
drop policy if exists "create conversations" on public.conversations;
create policy "create conversations" on public.conversations
  for insert to authenticated with check (true);
