-- NiblGo MVP schema (run in Supabase SQL editor, or `supabase db push`)
-- Matches the data model in CLAUDE.md. All timestamps UTC.

-- Postgres has no `create type if not exists`, so this is the guarded form.
-- Everything in this file is written to be safe to run more than once: paste
-- the whole thing again and it will not error on what already exists.
do $$ begin
  create type meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------- users
-- Constraints are named explicitly so this file and the migrations produce
-- identical databases, and future migrations can reference them by name.
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null constraint users_handle_format check (handle ~ '^[a-z0-9_]{2,30}$'),
  display_name text not null
    constraint users_display_name_len check (char_length(display_name) between 1 and 50),
  -- Length is tested separately from the pattern on purpose: Postgres caps
  -- regex repetition counts at 255, so {1,500} inside the pattern is a
  -- runtime error, not a compile-time one.
  avatar_url text constraint users_avatar_url_https check (
    avatar_url is null or (avatar_url ~ '^https://[^\s]+$' and char_length(avatar_url) <= 500)
  ),
  avatar_emoji text
    constraint users_avatar_emoji_len check (avatar_emoji is null or char_length(avatar_emoji) <= 8),
  bio text constraint users_bio_len check (bio is null or char_length(bio) <= 300),
  timezone text not null default 'UTC'
    constraint users_timezone_len check (char_length(timezone) <= 64),
  follows_private boolean not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- follows
create table if not exists public.follows (
  follower_id uuid not null references public.users (id) on delete cascade,
  followee_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- ---------------------------------------------------------------- posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  meal_slot meal_slot not null,
  -- Must be an https URL. Blocks javascript:/data:/file: URIs and stops a
  -- scripted client pointing every viewer's image loader at a host that logs
  -- their IP.
  photo_url text not null constraint posts_photo_url_https check (
    photo_url ~ '^https://[^\s]+$' and char_length(photo_url) <= 1000
  ),
  -- The photo's pixel size, so the feed can draw it whole at its own shape
  -- before it loads. Null on posts from before photos kept their shape.
  photo_width integer,
  photo_height integer,
  constraint posts_photo_size_valid check (
    (photo_width is null and photo_height is null)
    or (
      photo_width is not null and photo_height is not null
      and photo_width between 1 and 10000 and photo_height between 1 and 10000
    )
  ),
  -- verbatim user words, source of truth. Never rewritten by AI.
  blurb text not null default ''
    constraint posts_blurb_len check (char_length(blurb) <= 2000),
  restaurant_place_id text constraint posts_place_id_len
    check (restaurant_place_id is null or char_length(restaurant_place_id) <= 255),
  restaurant_name text constraint posts_restaurant_name_len
    check (restaurant_name is null or char_length(restaurant_name) <= 200),
  lat double precision constraint posts_lat_range check (lat is null or lat between -90 and 90),
  lng double precision constraint posts_lng_range check (lng is null or lng between -180 and 180),
  created_at timestamptz not null default now()
);
-- For databases created before photos kept their shape.
alter table public.posts
  add column if not exists photo_width integer,
  add column if not exists photo_height integer;
alter table public.posts drop constraint if exists posts_photo_size_valid;
alter table public.posts
  add constraint posts_photo_size_valid check (
    (photo_width is null and photo_height is null)
    or (
      photo_width is not null and photo_height is not null
      and photo_width between 1 and 10000 and photo_height between 1 and 10000
    )
  );
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);

-- -------------------------------------------------------------- recipes
-- Structured ingredients {item, quantity, unit} are the long-term data asset.
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid unique not null references public.posts (id) on delete cascade,
  title text not null
    constraint recipes_title_len check (char_length(title) between 1 and 120),
  -- [{item, quantity, unit}] — bounded so a scripted client can't store an
  -- unbounded blob under the guise of a recipe.
  ingredients jsonb not null default '[]'::jsonb constraint recipes_ingredients_bounded check (
    jsonb_typeof(ingredients) = 'array'
    and jsonb_array_length(ingredients) <= 50
    and pg_column_size(ingredients) <= 16384
  ),
  steps jsonb not null default '[]'::jsonb constraint recipes_steps_bounded check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) <= 50
    and pg_column_size(steps) <= 16384
  ),
  cook_time_minutes integer constraint recipes_cook_time_range
    check (cook_time_minutes is null or cook_time_minutes between 0 and 6000),
  ai_generated boolean not null default false,
  user_edited boolean not null default false,      -- tracks AI accuracy over time
  -- Nutrition (migration 0012), inlined so a fresh schema.sql install matches.
  -- Totals for the whole dish; servings is the display divisor the user sets.
  servings integer not null default 1
    constraint recipes_servings_range check (servings between 1 and 100),
  nutrition jsonb constraint recipes_nutrition_bounded check (
    nutrition is null or (jsonb_typeof(nutrition) = 'object' and pg_column_size(nutrition) <= 2048)
  ),
  nutrition_source text constraint recipes_nutrition_source_allowed check (
    nutrition_source is null or nutrition_source in ('usda', 'estimated', 'demo')
  ),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ reactions
create table if not exists public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- MVP ships likes only; constrained so clients can't invent values.
  type text not null default 'like' constraint reactions_type_allowed check (type in ('like')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ------------------------------------------------------------- comments
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 2000),
  -- An attached photo (e.g. "here's the pie I made"), same folder + rules as
  -- post and message photos.
  image_url text constraint comments_image_url_https check (
    image_url is null or (image_url ~ '^https://[^\s]+$' and char_length(image_url) <= 1000)
  ),
  -- A reply points at the top-level comment it sits under; NULL = top-level.
  -- Two levels only: replies to replies still attach to the top-level parent.
  parent_id uuid references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A comment must carry something: a caption, a photo, or both.
  constraint comments_not_empty check (char_length(text) > 0 or image_url is not null)
);
create index if not exists comments_post_created_idx on public.comments (post_id, created_at);
create index if not exists comments_parent_idx on public.comments (parent_id);

-- -------------------------------------------------------------- reposts
create table if not exists public.reposts (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- --------------------------------------------------------------- shares
-- One row per (user, post): keeps the share count honest and idempotent.
create table if not exists public.shares (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------- saved_posts
-- Private bookmarks: a user's saved posts (only they can read their own).
create table if not exists public.saved_posts (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists saved_posts_user_created_idx on public.saved_posts (user_id, created_at desc);

-- --------------------------------------------------------------- blocks
-- Blocking. Required alongside reporting for App Store Guideline 1.2.
--
-- A block is one-directional in storage but symmetric in effect: neither party
-- should see the other's content or be able to message them. Policies and
-- queries below always test both directions.
create table if not exists public.blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- True if either user has blocked the other. SECURITY DEFINER because the
-- blocked party cannot read the blocks table, but policies still need the
-- answer. Pinned empty search_path stops schema shadowing.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a)
  );
$$;


-- -------------------------------------------------------- direct messages
-- 1:1 threads today; the members table means group DMs need no migration.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Bumped on every message so the inbox can sort without a join.
  updated_at timestamptz not null default now(),
  -- Optional custom name for a group thread; null = show the members' names.
  title text constraint conversations_title_len check (title is null or char_length(title) <= 60),
  -- Set when the thread starts as a group, and kept: a group that drops to
  -- two people after someone leaves is still a group, not a 1:1.
  is_group boolean not null default false
);
-- For databases created before leaving groups.
alter table public.conversations
  add column if not exists is_group boolean not null default false;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- When this member last opened the thread; drives the unread badge.
  last_read_at timestamptz not null default 'epoch',
  -- Per-member mute: suppresses this member's DM push for this thread.
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);
-- Databases from before is_group: anything named or with 3+ members is a group.
update public.conversations c
set is_group = true
where not c.is_group
  and (
    c.title is not null
    or (select count(*) from public.conversation_members m where m.conversation_id = c.id) > 2
  );

-- Expo push tokens, so the server can push a DM to a recipient's device. The
-- notify-message edge function reads these with the service role; users manage
-- only their own.
create table if not exists public.push_tokens (
  user_id uuid not null references public.users (id) on delete cascade,
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "manage own push tokens" on public.push_tokens;
create policy "manage own push tokens" on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------- collections
-- Collections: named groups of your own posts ("Crockpot meals", "Desserts")
-- shown on your profile.
--
-- Anyone who can see your posts can see your collections (blocking hides them
-- both ways, same as posts). Only you can create, rename or delete yours, and
-- only your own posts can go in them.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null constraint collections_name_len check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
-- One "Desserts" per person, whatever the capitalisation.
create unique index if not exists collections_user_name_idx
  on public.collections (user_id, lower(btrim(name)));
create index if not exists collections_user_created_idx
  on public.collections (user_id, created_at desc);

create table if not exists public.collection_posts (
  collection_id uuid not null references public.collections (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists collection_posts_post_idx on public.collection_posts (post_id);

alter table public.collections enable row level security;
alter table public.collection_posts enable row level security;

drop policy if exists "collections readable" on public.collections;
create policy "collections readable" on public.collections
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "create own collections" on public.collections;
create policy "create own collections" on public.collections
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "rename own collections" on public.collections;
create policy "rename own collections" on public.collections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own collections" on public.collections;
create policy "delete own collections" on public.collections
  for delete to authenticated using (user_id = auth.uid());

-- Items are visible wherever their collection is (the subquery runs under the
-- collections policy above), and the posts themselves still go through the
-- posts policy when they're loaded.
drop policy if exists "collection items readable" on public.collection_posts;
create policy "collection items readable" on public.collection_posts
  for select to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id)
  );
drop policy if exists "add own posts to own collections" on public.collection_posts;
create policy "add own posts to own collections" on public.collection_posts
  for insert to authenticated with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
drop policy if exists "remove from own collections" on public.collection_posts;
create policy "remove from own collections" on public.collection_posts
  for delete to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  );

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 2000),
  -- A shared post. SET NULL so deleting the post doesn't delete the message;
  -- the thread still reads sensibly, the attachment just goes away.
  shared_post_id uuid references public.posts (id) on delete set null,
  -- A shared profile (Share profile). SET NULL for the same reason.
  shared_user_id uuid references public.users (id) on delete set null,
  -- An attached photo, stored in the same per-user folder as post photos.
  image_url text constraint messages_image_url_https check (
    image_url is null or (image_url ~ '^https://[^\s]+$' and char_length(image_url) <= 1000)
  ),
  created_at timestamptz not null default now()
);
-- For databases created before profile shares.
alter table public.messages
  add column if not exists shared_user_id uuid references public.users (id) on delete set null;
-- 'message' for everything people send; 'left' for the centred "Dan left the
-- chat" line, which only leave_conversation() writes.
alter table public.messages
  add column if not exists kind text not null default 'message';
alter table public.messages drop constraint if exists messages_kind_valid;
alter table public.messages
  add constraint messages_kind_valid check (kind in ('message', 'left'));
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

drop trigger if exists messages_not_empty on public.messages;
create trigger messages_not_empty before insert on public.messages
  for each row execute function public.message_not_empty();

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- Membership test used by every DM policy. SECURITY DEFINER with a pinned
-- empty search_path: without it, the policy on conversation_members would
-- need to query conversation_members, which recurses.
create or replace function public.is_conversation_member(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.user_id = who
  );
$$;


-- True only while a conversation has no members at all, i.e. the instant
-- after it is created. Used to let the creator add themselves without also
-- letting anyone add themselves to an existing thread.
create or replace function public.conversation_is_empty(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.conversation_members m where m.conversation_id = conv
  );
$$;


-- True if `who` follows `target`. SECURITY DEFINER because the policy on
-- public.follows hides rows belonging to private accounts, and a private
-- account must still be able to start a conversation.
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


-- True if anyone in the conversation has blocked (or been blocked by) `who`.
-- Stops a blocked user from continuing to message through an old thread.
create or replace function public.conversation_has_block(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv
      and m.user_id <> who
      and public.is_blocked_pair(m.user_id, who)
  );
$$;


-- Start (or reuse) a 1:1 DM thread in one server-side call. SECURITY DEFINER
-- so it can create the conversation and add both members atomically — the
-- creator is not a member at insert time, so a client-side insert cannot both
-- pass the members-only RLS and read the new row back. Enforces the same rules
-- the policies do: you may only message someone you follow, and never anyone in
-- a block relationship.
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

-- Start (or reuse) a group thread with several people at once. Same opt-in
-- rules as start_conversation, applied to every target; reuses a thread only
-- when its member set is exactly {you} + targets, so a group never collides
-- with a 1:1.
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

revoke all on function public.start_group_conversation(uuid[]) from public, anon;
grant execute on function public.start_group_conversation(uuid[]) to authenticated;

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

-- Public preview for a shared post link. Read (before sign-in) by the web page
-- behind niblgo.com/post/<id> to render a rich preview card. Returns only the
-- card's fields for one post looked up by its unguessable UUID — no listing or
-- enumeration, just the post whose id the share link already handed over.
create or replace function public.get_post_preview(pid uuid)
returns table (
  photo_url text,
  blurb text,
  display_name text,
  handle text,
  meal_slot text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.photo_url, p.blurb, u.display_name, u.handle, p.meal_slot::text
  from public.posts p
  join public.users u on u.id = p.user_id
  where p.id = pid
  limit 1;
$$;

revoke all on function public.get_post_preview(uuid) from public;
grant execute on function public.get_post_preview(uuid) to anon, authenticated;


-- ---------------------------------------------------- comment_reactions
-- Likes on comments. Same shape as post reactions: one row per (comment, user)
-- so the count is inherently idempotent.
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions (comment_id);

-- -------------------------------------------------------------- reports
-- Content reports. This is a legal/compliance record, so it is deliberately
-- more durable than the content it describes:
--
--  * post_id is ON DELETE SET NULL, not CASCADE. If the reported user deletes
--    the post, the report survives — otherwise deleting your post would erase
--    the evidence against you.
--  * The blurb and photo URL are snapshotted at report time for the same
--    reason, so a reviewer can still see what was actually reported.
--  * reported_user_id survives post deletion too, so repeat offenders are
--    still visible in the queue.
--
-- Reviewing happens in the Supabase dashboard for now. See MODERATION.md.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.posts (id) on delete set null,
  reporter_id uuid not null references public.users (id) on delete cascade,
  reported_user_id uuid references public.users (id) on delete set null,
  reason text not null check (
    reason in ('spam', 'harassment', 'sexual', 'violence', 'self_harm',
               'false_info', 'intellectual_property', 'other')
  ),
  detail text check (detail is null or char_length(detail) <= 1000),
  post_blurb_snapshot text check (post_blurb_snapshot is null or char_length(post_blurb_snapshot) <= 2000),
  post_photo_url_snapshot text check (post_photo_url_snapshot is null or char_length(post_photo_url_snapshot) <= 1000),
  -- Reported DM. SET NULL like post_id so the sender deleting the message
  -- doesn't erase the report, which is the whole point of keeping snapshots.
  message_id uuid references public.messages (id) on delete set null,
  message_text_snapshot text check (message_text_snapshot is null or char_length(message_text_snapshot) <= 2000),
  message_image_url_snapshot text check (
    message_image_url_snapshot is null or char_length(message_image_url_snapshot) <= 1000
  ),
  -- Reported comment. SET NULL like the others so deleting the comment doesn't
  -- erase the report; the snapshot keeps what was said. An account report has
  -- none of post_id/message_id/comment_id set — just reported_user_id.
  comment_id uuid references public.comments (id) on delete set null,
  comment_text_snapshot text check (comment_text_snapshot is null or char_length(comment_text_snapshot) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text check (reviewer_notes is null or char_length(reviewer_notes) <= 2000)
);
-- One report per person per post: stops one user spamming the queue to bury
-- a post, while still letting many different people report the same thing.
create unique index if not exists reports_one_per_reporter_idx on public.reports (reporter_id, post_id);
-- The triage view: oldest open reports first.
create index if not exists reports_status_created_idx on public.reports (status, created_at);
create index if not exists reports_reported_user_idx on public.reports (reported_user_id);
create index if not exists reports_comment_idx on public.reports (comment_id);

-- ------------------------------------------------------------- feedback
-- In-app feedback and bug reports, from the Help section of the profile
-- drawer. Deliberately separate from `reports`: that table is a moderation
-- queue about other people's content and carries legal weight, this one is
-- users telling us the app is broken.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: a bug report stays useful after the person who
  -- filed it deletes their account, and losing it would hide the very problem
  -- that made them leave.
  user_id uuid references public.users (id) on delete set null,
  -- Who filed it, kept readable after the account is gone.
  handle_snapshot text
    constraint feedback_handle_len check (handle_snapshot is null or char_length(handle_snapshot) <= 30),
  kind text not null default 'feedback'
    constraint feedback_kind_allowed check (kind in ('feedback', 'bug')),
  message text not null
    constraint feedback_message_len check (char_length(message) between 1 and 2000),
  -- Filled in by the app, not typed by the user: a bug report without the
  -- platform and build is usually not actionable.
  app_version text constraint feedback_version_len check (app_version is null or char_length(app_version) <= 32),
  platform text constraint feedback_platform_len check (platform is null or char_length(platform) <= 32),
  status text not null default 'new'
    constraint feedback_status_allowed check (status in ('new', 'triaged', 'resolved')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text constraint feedback_notes_len check (reviewer_notes is null or char_length(reviewer_notes) <= 2000)
);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);

-- ------------------------------------------------------------- nutrition
-- Recipe nutrition is stored as TOTALS for the whole recipe, never
-- per-serving. Servings is a display divisor the user can change afterwards
-- without anything being recomputed — which is the point: the app cannot know
-- that a pie feeds four unless someone says so.
alter table public.recipes
  add column if not exists servings integer not null default 1,
  add column if not exists nutrition jsonb,
  add column if not exists nutrition_source text;

alter table public.recipes
  drop constraint if exists recipes_servings_range,
  add  constraint recipes_servings_range check (servings between 1 and 100);

-- Where the numbers came from, so the card can say so honestly:
--   usda      — looked up in USDA FoodData Central
--   estimated — the model's guess, used only where USDA had no match
--   demo      — seeded demo-mode data, not a claim about real food
alter table public.recipes
  drop constraint if exists recipes_nutrition_source_allowed,
  add  constraint recipes_nutrition_source_allowed check (
    nutrition_source is null or nutrition_source in ('usda', 'estimated', 'demo')
  );

-- Bounded like the other jsonb columns so a scripted client cannot store a
-- blob here. Totals only; the keys are fixed.
alter table public.recipes
  drop constraint if exists recipes_nutrition_bounded,
  add  constraint recipes_nutrition_bounded check (
    nutrition is null
    or (jsonb_typeof(nutrition) = 'object' and pg_column_size(nutrition) <= 2048)
  );

-- Cache of USDA lookups, keyed by the normalised ingredient term.
-- "chicken breast" is going to be looked up thousands of times; the USDA API
-- is rate limited per key, so not caching would make the feature fail at
-- exactly the moment it became popular.
create table if not exists public.nutrition_cache (
  term text primary key constraint nutrition_cache_term_len check (char_length(term) between 1 and 120),
  fdc_id bigint,
  description text constraint nutrition_cache_desc_len check (description is null or char_length(description) <= 300),
  -- Nutrients per 100 g, exactly as USDA reports them.
  per_100g jsonb not null,
  source text not null default 'usda'
    constraint nutrition_cache_source_allowed check (source in ('usda', 'estimated', 'demo')),
  created_at timestamptz not null default now()
);

alter table public.nutrition_cache enable row level security;
-- No policies and no grants, deliberately: only the lookup edge function
-- touches this, through the service role. Same shape as ai_usage.
revoke all on table public.nutrition_cache from anon, authenticated;

-- ------------------------------------------------------- notifications
-- "Marge liked your post." One row per interaction, addressed to the person
-- who owns the content.
--
-- These rows are written by triggers, never by the app: there is no insert
-- policy below, so a patched client cannot forge a notification, spam someone
-- else's bell, or quietly skip writing one. The triggers are SECURITY DEFINER
-- for the same reason the DM helpers are.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who receives it.
  user_id uuid not null references public.users (id) on delete cascade,
  -- Who caused it.
  actor_id uuid not null references public.users (id) on delete cascade,
  type text not null constraint notifications_type_allowed
    check (type in ('like', 'comment', 'repost', 'share', 'tag')),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- You are never notified about your own activity.
  constraint notifications_no_self check (user_id <> actor_id)
);
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Likes, reposts and shares are one-per-person-per-post, so unliking and
-- re-liking must not stack up a second notification. Comments are excluded
-- (comment_id is set) because each comment is its own event.
create unique index if not exists notifications_one_per_interaction
  on public.notifications (user_id, actor_id, type, post_id)
  where comment_id is null;

-- Shared by the like/repost/share triggers, which all fire on a table with
-- (post_id, user_id). The interaction type comes in as a trigger argument.
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
  -- No post, your own post, or someone you have blocked: nothing to send.
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

-- ------------------------------------------------------------ post tags
-- Tag people in a post. Only the author tags, nobody tags themselves or
-- across a block, and a tagged person can untag themselves.
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

-- -------------------------------------------------------------- streaks
-- Streaks are client-written, so they are only as trustworthy as the client.
-- These constraints reject the obviously-forged values. Making them
-- tamper-proof needs a trigger deriving them from posts; see SECURITY.md.
create table if not exists public.streaks (
  user_id uuid primary key references public.users (id) on delete cascade,
  current_streak integer not null default 0
    constraint streaks_current_range check (current_streak between 0 and 36500),
  longest_streak integer not null default 0
    constraint streaks_longest_range check (longest_streak between 0 and 36500),
  last_post_date date constraint streaks_last_post_not_future
    check (last_post_date is null or last_post_date <= (now() at time zone 'utc')::date + 1),
  constraint streaks_longest_gte_current check (longest_streak >= current_streak)
);

-- ==================================================================== RLS
alter table public.users enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.recipes enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;
alter table public.reposts enable row level security;
alter table public.shares enable row level security;
alter table public.saved_posts enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.reports enable row level security;
alter table public.streaks enable row level security;
alter table public.notifications enable row level security;
alter table public.feedback enable row level security;

-- users: everyone signed-in can read profiles; you manage your own row
drop policy if exists "users readable" on public.users;
create policy "users readable" on public.users
  for select to authenticated using (true);
drop policy if exists "insert own profile" on public.users;
create policy "insert own profile" on public.users
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "update own profile" on public.users;
create policy "update own profile" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "delete own profile" on public.users;
create policy "delete own profile" on public.users
  for delete to authenticated using (id = auth.uid());

-- follows
-- users.follows_private is a real privacy control, not a UI preference. A
-- follow row (A follows B) appears in B's follower list and A's following
-- list, so third parties only see it when NEITHER side is private. Counts stay
-- public via follow_counts() below, which is SECURITY DEFINER.
drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows
  for select to authenticated using (
    follower_id = auth.uid()
    or followee_id = auth.uid()
    or (
      not exists (select 1 from public.users u where u.id = follower_id and u.follows_private)
      and not exists (select 1 from public.users u where u.id = followee_id and u.follows_private)
    )
  );

create or replace function public.follow_counts(target uuid)
returns table (followers bigint, following bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.follows f where f.followee_id = target),
    (select count(*) from public.follows f where f.follower_id = target);
$$;

drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows
  for insert to authenticated with check (
    follower_id = auth.uid() and not public.is_blocked_pair(followee_id, auth.uid())
  );
drop policy if exists "unfollow as self" on public.follows;
create policy "unfollow as self" on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- posts: MVP = all signed-in users can read (feed filters client/server-side)
-- Blocking hides content both ways: neither party sees the other's posts.
drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
  );
drop policy if exists "create own posts" on public.posts;
create policy "create own posts" on public.posts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own posts" on public.posts;
create policy "update own posts" on public.posts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own posts" on public.posts;
create policy "delete own posts" on public.posts
  for delete to authenticated using (user_id = auth.uid());

-- recipes follow their post's owner
drop policy if exists "recipes readable" on public.recipes;
create policy "recipes readable" on public.recipes
  for select to authenticated using (true);
drop policy if exists "create recipes on own posts" on public.recipes;
create policy "create recipes on own posts" on public.recipes
  for insert to authenticated with check (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
drop policy if exists "update recipes on own posts" on public.recipes;
create policy "update recipes on own posts" on public.recipes
  for update to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
drop policy if exists "delete recipes on own posts" on public.recipes;
create policy "delete recipes on own posts" on public.recipes
  for delete to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

-- reactions
drop policy if exists "reactions readable" on public.reactions;
create policy "reactions readable" on public.reactions
  for select to authenticated using (true);
drop policy if exists "react as self" on public.reactions;
create policy "react as self" on public.reactions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unreact as self" on public.reactions;
create policy "unreact as self" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- comments: all signed-in users read; you write/delete your own
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
  );
drop policy if exists "comment as self" on public.comments;
create policy "comment as self" on public.comments
  for insert to authenticated with check (user_id = auth.uid());
-- Deletable by the author OR the owner of the post, so a user can always
-- remove abuse from their own post without waiting on support.
drop policy if exists "delete own comment or on own post" on public.comments;
create policy "delete own comment or on own post" on public.comments
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );


-- blocks: you manage your own list and can only see your own. Someone you
-- blocked must not be able to tell -- reading the table would leak that.
drop policy if exists "read own blocks" on public.blocks;
create policy "read own blocks" on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "block as self" on public.blocks;
create policy "block as self" on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "unblock as self" on public.blocks;
create policy "unblock as self" on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- direct messages: strictly members-only. These are the most private rows in
-- the app — nothing here is readable by anyone outside the thread.
drop policy if exists "read own conversations" on public.conversations;
create policy "read own conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id, auth.uid()));
drop policy if exists "create conversations" on public.conversations;
create policy "create conversations" on public.conversations
  for insert to authenticated with check (true);
-- Bumping updated_at when sending is allowed for members only.
drop policy if exists "touch own conversations" on public.conversations;
create policy "touch own conversations" on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

drop policy if exists "read members of own conversations" on public.conversation_members;
create policy "read members of own conversations" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
-- Two ways in, and no third:
--   * you are already a member, so you may add someone else; or
--   * the conversation is brand new and empty, so you may add yourself.
-- A bare `user_id = auth.uid()` is NOT enough: that would let anyone add
-- themselves to a stranger's existing thread and read the whole history.
-- You may add yourself to a brand-new thread, and you may add someone else to
-- a thread you are already in — but only someone you follow. That is what
-- makes DMs opt-in: a stranger cannot open a thread with you.
--
-- Note this gates *starting* a conversation, not replying in one. Once a
-- thread exists both members can send, so the person you messaged can answer
-- without having to follow you back.
drop policy if exists "join conversations" on public.conversation_members;
create policy "join conversations" on public.conversation_members
  for insert to authenticated with check (
    (user_id = auth.uid() and public.conversation_is_empty(conversation_id))
    or (
      public.is_conversation_member(conversation_id, auth.uid())
      and (user_id = auth.uid() or public.is_following(auth.uid(), user_id))
    )
  );
drop policy if exists "update own membership" on public.conversation_members;
create policy "update own membership" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "leave conversations" on public.conversation_members;
create policy "leave conversations" on public.conversation_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "read messages in own conversations" on public.messages;
create policy "read messages in own conversations" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "send messages as self" on public.messages;
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and kind = 'message'
    and public.is_conversation_member(conversation_id, auth.uid())
    and not public.conversation_has_block(conversation_id, auth.uid())
  );
drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- ---------------------------------------------------- message reactions
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

-- comment reactions: readable by all signed-in users, written as yourself
drop policy if exists "comment reactions readable" on public.comment_reactions;
create policy "comment reactions readable" on public.comment_reactions
  for select to authenticated using (true);
drop policy if exists "like comment as self" on public.comment_reactions;
create policy "like comment as self" on public.comment_reactions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unlike comment as self" on public.comment_reactions;
create policy "unlike comment as self" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

-- reposts
drop policy if exists "reposts readable" on public.reposts;
create policy "reposts readable" on public.reposts
  for select to authenticated using (true);
drop policy if exists "repost as self" on public.reposts;
create policy "repost as self" on public.reposts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unrepost as self" on public.reposts;
create policy "unrepost as self" on public.reposts
  for delete to authenticated using (user_id = auth.uid());

-- shares
drop policy if exists "shares readable" on public.shares;
create policy "shares readable" on public.shares
  for select to authenticated using (true);
drop policy if exists "share as self" on public.shares;
create policy "share as self" on public.shares
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own share" on public.shares;
create policy "update own share" on public.shares
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- saved_posts: private to the owner (only you read/write your bookmarks)
drop policy if exists "read own saves" on public.saved_posts;
create policy "read own saves" on public.saved_posts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "save as self" on public.saved_posts;
create policy "save as self" on public.saved_posts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unsave as self" on public.saved_posts;
create policy "unsave as self" on public.saved_posts
  for delete to authenticated using (user_id = auth.uid());

-- reports: WRITE-ONLY from the client.
--
-- A reporter can file a report and read back only their own (so the UI can say
-- "you already reported this"). There is deliberately no policy letting anyone
-- read reports filed against them or by others: the reported user must never
-- learn who filed, and the queue must not be enumerable. Moderators read this
-- table through the dashboard / service role, which bypasses RLS.
--
-- No UPDATE or DELETE policy either — a reporter cannot retract or edit a
-- report, and a reported user cannot delete one. Only staff can change status.
drop policy if exists "file report as self" on public.reports;
create policy "file report as self" on public.reports
  for insert to authenticated with check (
    reporter_id = auth.uid()
    -- You cannot report your own post; use delete instead.
    and reported_user_id is distinct from auth.uid()
  );
drop policy if exists "read own reports" on public.reports;
create policy "read own reports" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

-- streaks
drop policy if exists "streaks readable" on public.streaks;
create policy "streaks readable" on public.streaks
  for select to authenticated using (true);
drop policy if exists "upsert own streak" on public.streaks;
create policy "upsert own streak" on public.streaks
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own streak" on public.streaks;
create policy "update own streak" on public.streaks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications
-- Yours only, and even you cannot write one: there is deliberately no insert
-- policy, so the only thing that can create a notification is the SECURITY
-- DEFINER trigger above. You can mark yours read, and clear them.
-- The block test is here rather than in the app so that blocking someone
-- retroactively hides the notifications they already caused, and so the
-- unread count and the list can never disagree.
drop policy if exists "read own notifications" on public.notifications;
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

-- feedback: file your own, read your own, and that is all. No update or delete
-- policy on purpose — a filed report should not be editable after the fact,
-- and triage happens through the service role.
drop policy if exists "file feedback as self" on public.feedback;
create policy "file feedback as self" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback
  for select to authenticated using (user_id = auth.uid());

-- ================================================================ storage
-- Photo bucket: public read, users write into their own folder.
-- allowed_mime_types + file_size_limit are the important bits. Without them a
-- signed-in user can upload ANY file to a public CDN origin: an HTML or SVG
-- file becomes stored XSS served from your own domain, and unbounded sizes are
-- a straight bandwidth bill. The client's compress step is UX, not a control.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos', 'photos', true,
  10485760,                                        -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
-- Re-running repairs the limits on a bucket that already exists, including one
-- created by hand through the dashboard without them.
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects
  for select using (bucket_id = 'photos');
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================== rate limits
-- Backs the per-user quota in the format-recipe edge function. Each AI format
-- costs real money, so the call must be attributable and capped. RLS on with
-- no policies denies the client everything; the explicit revoke is
-- belt-and-braces because Supabase grants to anon/authenticated by default.
create table if not exists public.ai_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;

-- Atomically increment today's counter and report whether the caller is still
-- under the cap. SECURITY DEFINER with a pinned empty search_path.
create or replace function public.consume_ai_quota(target uuid, daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (target, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
    do update set count = public.ai_usage.count + 1
  returning count into used;

  return used <= daily_limit;
end;
$$;


-- ------------------------------------------------ function execute grants
-- These have to be explicit. Supabase sets ALTER DEFAULT PRIVILEGES so every
-- new function in `public` is executable by anon and authenticated, and
-- `revoke ... from public` does NOT remove those role grants — PUBLIC and
-- `anon` are different grantees. Without the revokes below, anyone holding the
-- app's anon key (which is public by design) can call these SECURITY DEFINER
-- helpers directly over PostgREST and they answer, bypassing RLS:
--
--   * is_following()      would expose the follow graph of private accounts
--   * is_blocked_pair()   would reveal that someone blocked you, which
--                         SECURITY.md promises is never visible
--   * consume_ai_quota()  would let anyone burn another user's daily AI
--                         allowance and switch their recipe cards off
--
-- The five policy helpers genuinely need `authenticated`: an RLS policy
-- expression runs as the caller, so the caller must be able to execute what the
-- policy calls. Everything else gets nothing.
revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

revoke all on function public.conversation_is_empty(uuid) from public, anon, authenticated;
grant execute on function public.conversation_is_empty(uuid) to authenticated;

revoke all on function public.conversation_has_block(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conversation_has_block(uuid, uuid) to authenticated;

revoke all on function public.is_following(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_following(uuid, uuid) to authenticated;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- Called directly by the app. Follower counts are public by design.
revoke all on function public.follow_counts(uuid) from public, anon, authenticated;
grant execute on function public.follow_counts(uuid) to authenticated;

-- Only the format-recipe edge function calls this, and it uses the service
-- role key. No client should ever be able to move another user's meter.
revoke all on function public.consume_ai_quota(uuid, integer) from public, anon, authenticated;

-- Trigger functions. Postgres does not check EXECUTE on a trigger function when
-- the trigger fires — only when the trigger is created — so revoking here costs
-- nothing and removes two more entry points.
revoke all on function public.notify_post_interaction() from public, anon, authenticated;
revoke all on function public.notify_comment() from public, anon, authenticated;
