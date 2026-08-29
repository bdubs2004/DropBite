-- NiblGo: in-app notifications for post interactions
--
-- Run this if your database predates notifications. A fresh `schema.sql`
-- already includes them. Safe to run more than once.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  actor_id uuid not null references public.users (id) on delete cascade,
  type text not null,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications
  drop constraint if exists notifications_type_allowed,
  add  constraint notifications_type_allowed check (type in ('like', 'comment', 'repost', 'share'));

alter table public.notifications
  drop constraint if exists notifications_no_self,
  add  constraint notifications_no_self check (user_id <> actor_id);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Unliking and re-liking must not stack a second notification. Comments are
-- excluded because each comment is its own event.
create unique index if not exists notifications_one_per_interaction
  on public.notifications (user_id, actor_id, type, post_id)
  where comment_id is null;

create or replace function public.notify_post_interaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select p.user_id into owner from public.posts p where p.id = new.post_id;
  if owner is null or owner = new.user_id then
    return new;
  end if;
  if public.is_blocked_pair(owner, new.user_id) then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, post_id)
  values (owner, new.user_id, tg_argv[0], new.post_id)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select p.user_id into owner from public.posts p where p.id = new.post_id;
  if owner is null or owner = new.user_id then
    return new;
  end if;
  if public.is_blocked_pair(owner, new.user_id) then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
  values (owner, new.user_id, 'comment', new.post_id, new.id);
  return new;
end;
$$;

drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify after insert on public.reactions
  for each row execute function public.notify_post_interaction('like');

drop trigger if exists reposts_notify on public.reposts;
create trigger reposts_notify after insert on public.reposts
  for each row execute function public.notify_post_interaction('repost');

drop trigger if exists shares_notify on public.shares;
create trigger shares_notify after insert on public.shares
  for each row execute function public.notify_post_interaction('share');

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

alter table public.notifications enable row level security;

-- No insert policy on purpose: the SECURITY DEFINER triggers above are the
-- only thing that may create a notification.
drop policy if exists "read own notifications" on public.notifications;
-- The block test is here rather than in the app so that blocking someone
-- retroactively hides the notifications they already caused, and so the
-- unread count and the list can never disagree.
create policy "read own notifications" on public.notifications
  for select to authenticated using (
    user_id = auth.uid() and not public.is_blocked_pair(user_id, actor_id)
  );

drop policy if exists "mark own notifications read" on public.notifications;
create policy "mark own notifications read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
