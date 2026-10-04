-- Two small features.
--
-- 1. Share a profile in a DM ("Share profile" in a profile's ··· menu): a
--    message can carry a person, shown as a tappable profile card. SET NULL so
--    deleting that account doesn't delete the message.
alter table public.messages
  add column if not exists shared_user_id uuid references public.users (id) on delete set null;
-- "A message must carry something" is checked when a message is SENT, not
-- forever after. As a CHECK constraint it also ran when a shared post or
-- profile was deleted and ON DELETE SET NULL emptied the message, which made
-- that delete fail. So deleting a post that had been sent in a DM with no
-- text failed, and so did deleting an account whose posts had been sent
-- that way. The app now shows such a message as "No longer available".
alter table public.messages drop constraint if exists messages_not_empty;

create or replace function public.message_not_empty()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if char_length(new.text) = 0
     and new.shared_post_id is null
     and new.image_url is null
     and new.shared_user_id is null then
    raise exception 'A message must carry something' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.message_not_empty() from public, anon, authenticated;

drop trigger if exists messages_not_empty on public.messages;
create trigger messages_not_empty before insert on public.messages
  for each row execute function public.message_not_empty();

-- 2. Tag people in a post. Only the post's author tags, nobody tags
--    themselves, nobody tags across a block, and a tagged person can untag
--    themselves. Being tagged sends them a notification.
create table if not exists public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_tags_user_idx on public.post_tags (user_id, created_at desc);

alter table public.post_tags enable row level security;

-- Visible wherever the post is (the posts policy already hides blocked
-- authors' posts).
drop policy if exists "post tags readable" on public.post_tags;
create policy "post tags readable" on public.post_tags
  for select to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "author tags people" on public.post_tags;
create policy "author tags people" on public.post_tags
  for insert to authenticated with check (
    user_id <> auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
    and not public.is_blocked_pair(user_id, auth.uid())
  );
drop policy if exists "author or tagged person removes a tag" on public.post_tags;
create policy "author or tagged person removes a tag" on public.post_tags
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

alter table public.notifications
  drop constraint if exists notifications_type_allowed,
  add  constraint notifications_type_allowed
    check (type in ('like', 'comment', 'repost', 'share', 'tag'));

-- "X tagged you in a post": to the tagged person, from the post's author.
-- One per post (untag + retag doesn't stack, thanks to the unique index).
create or replace function public.notify_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  select p.user_id into author from public.posts p where p.id = new.post_id;
  if author is null or author = new.user_id then
    return new;
  end if;
  if public.is_blocked_pair(author, new.user_id) then
    return new;
  end if;
  insert into public.notifications (user_id, actor_id, type, post_id)
  values (new.user_id, author, 'tag', new.post_id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.notify_tag() from public, anon, authenticated;

drop trigger if exists post_tags_notify on public.post_tags;
create trigger post_tags_notify after insert on public.post_tags
  for each row execute function public.notify_tag();
