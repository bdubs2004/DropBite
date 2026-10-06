-- More in Activity, and push notifications for it.
--
--   * "Dan started following you" / "Dan followed you back"
--   * "Dan liked your comment"
--   * "Dan replied to your comment" (to the person you replied to; the post's
--     owner still gets "commented on your post", but never both for one reply)
--   * pushed_at: when an Activity item was pushed to the person's phone. The
--     notify-activity function sends each one at most once.
--   * You can no longer like your own post (the heart on your own post shows
--     who liked it instead). Likes people gave their own posts are removed.
--
-- Like every notification, these are written only by the triggers below, never
-- by the app, so they can't be forged. Safe to run more than once.

-- 1. New kinds of Activity --------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_allowed;
alter table public.notifications
  add constraint notifications_type_allowed check (
    type in ('like', 'comment', 'repost', 'share', 'tag',
             'follow', 'follow_back', 'comment_like', 'reply')
  );

alter table public.notifications add column if not exists pushed_at timestamptz;

-- One "followed you" per pair: unfollowing and following again doesn't stack.
create unique index if not exists notifications_one_follow
  on public.notifications (user_id, actor_id)
  where type in ('follow', 'follow_back');
-- One "liked your comment" per person per comment, same reason.
create unique index if not exists notifications_one_comment_like
  on public.notifications (user_id, actor_id, comment_id)
  where type = 'comment_like';

-- Who a reply is answering. Replies all sit under the top-level comment, so
-- without this a reply to Dan's reply would only reach the top comment's
-- author. Checked against the thread in notify_comment(), so it can't be used
-- to ping someone who isn't in it.
alter table public.comments
  add column if not exists reply_to_user_id uuid references public.users (id) on delete set null;

-- 2. Follows ----------------------------------------------------------------------
create or replace function public.notify_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  back boolean;
begin
  if public.is_blocked_pair(new.follower_id, new.followee_id) then
    return new;
  end if;
  -- "Followed you back" when they already follow the person they just followed.
  back := exists (
    select 1 from public.follows f
    where f.follower_id = new.followee_id and f.followee_id = new.follower_id
  );
  insert into public.notifications (user_id, actor_id, type)
  values (new.followee_id, new.follower_id, case when back then 'follow_back' else 'follow' end)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.notify_follow() from public, anon, authenticated;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_follow();

-- 3. Comment likes ----------------------------------------------------------------
create or replace function public.notify_comment_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
  pid uuid;
begin
  select c.user_id, c.post_id into author, pid from public.comments c where c.id = new.comment_id;
  if author is null or author = new.user_id then
    return new;
  end if;
  if public.is_blocked_pair(author, new.user_id) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (author, new.user_id, 'comment_like', pid, new.comment_id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.notify_comment_like() from public, anon, authenticated;

drop trigger if exists comment_reactions_notify on public.comment_reactions;
create trigger comment_reactions_notify after insert on public.comment_reactions
  for each row execute function public.notify_comment_like();

-- 4. Comments and replies ----------------------------------------------------------
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  target uuid;
begin
  select p.user_id into owner from public.posts p where p.id = new.post_id;

  -- A reply tells the person it answers: who the app says it's replying to,
  -- if they really have a comment in this thread, otherwise the author of the
  -- comment it sits under.
  if new.parent_id is not null then
    if new.reply_to_user_id is not null and exists (
      select 1 from public.comments c
      where c.user_id = new.reply_to_user_id
        and c.id <> new.id
        and (c.id = new.parent_id or c.parent_id = new.parent_id)
    ) then
      target := new.reply_to_user_id;
    else
      select c.user_id into target from public.comments c where c.id = new.parent_id;
    end if;
    if target is not null and target <> new.user_id
       and not public.is_blocked_pair(target, new.user_id) then
      insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
      values (target, new.user_id, 'reply', new.post_id, new.id);
    end if;
  end if;

  -- The post's owner hears about every comment, unless this one was already a
  -- reply to them (one notification per comment, not two).
  if owner is not null and owner <> new.user_id and owner is distinct from target
     and not public.is_blocked_pair(owner, new.user_id) then
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values (owner, new.user_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_comment() from public, anon, authenticated;

-- 5. No liking your own post -----------------------------------------------------------
drop policy if exists "react as self" on public.reactions;
create policy "react as self" on public.reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and not exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

delete from public.reactions r
using public.posts p
where p.id = r.post_id and p.user_id = r.user_id;
