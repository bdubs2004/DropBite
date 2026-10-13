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
  -- Capitals are kept as typed ("JoeMama"); uniqueness ignores them, see
  -- users_handle_lower_key below.
  handle text unique not null constraint users_handle_format check (handle ~ '^[A-Za-z0-9_]{2,30}$'),
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
-- For databases from before handles kept their capitals.
alter table public.users drop constraint if exists users_handle_format;
alter table public.users
  add constraint users_handle_format check (handle ~ '^[A-Za-z0-9_]{2,30}$');
-- JoeMama and joemama are the same handle: only one of them can exist.
create unique index if not exists users_handle_lower_key on public.users (lower(handle));

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
  -- Who a reply is answering (checked against the thread in notify_comment).
  reply_to_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A comment must carry something: a caption, a photo, or both.
  constraint comments_not_empty check (char_length(text) > 0 or image_url is not null)
);
create index if not exists comments_post_created_idx on public.comments (post_id, created_at);
create index if not exists comments_parent_idx on public.comments (parent_id);
-- For databases from before replies remembered who they answer.
alter table public.comments
  add column if not exists reply_to_user_id uuid references public.users (id) on delete set null;

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
--
-- It only answers about the caller: signed-in users can execute it (policies
-- need that), and without the first line anyone could ask "did Alice block
-- Eve?". auth.uid() is null only for trusted callers (dashboard, service role,
-- server-side triggers).
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or auth.uid() = a or auth.uid() = b)
    and exists (
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
-- A DM photo, by its path in the private dm-photos bucket
-- (<conversation id>/<random>.jpg). image_url is only for photos sent before
-- DM photos went private (0031); new messages can't set it.
alter table public.messages add column if not exists image_path text;
-- When notify-message pushed it (0032): each message is pushed once.
alter table public.messages add column if not exists pushed_at timestamptz;
alter table public.messages drop constraint if exists messages_image_path_format;
alter table public.messages
  add constraint messages_image_path_format check (
    image_path is null
    or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.jpg$'
  );
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
     and new.image_path is null
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
  -- Only about the caller, like is_blocked_pair.
  select (auth.uid() is null or auth.uid() = who)
    and exists (
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
  -- Only about the caller, like is_blocked_pair.
  select (auth.uid() is null or auth.uid() = who)
    and exists (
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

-- Start (or reuse) a group thread with several people at once (at most 32,
-- you included). Same opt-in
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
    check (type in ('like', 'comment', 'repost', 'share', 'tag',
                    'follow', 'follow_back', 'comment_like', 'reply')),
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at timestamptz,
  -- When it was pushed to the person's phone (notify-activity sends each once).
  pushed_at timestamptz,
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

-- For databases from before follows, comment likes and replies were in Activity.
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

-- recipes follow their post: readable wherever the post is (so not across a
-- block), written by the post's owner
drop policy if exists "recipes readable" on public.recipes;
create policy "recipes readable" on public.recipes
  for select to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id)
  );
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

-- reactions. Interactions below all need the post to be visible to you: the
-- subqueries run under your own RLS, so a post hidden by a block isn't there.
-- And what a blocked person likes is hidden from the person they blocked.
drop policy if exists "reactions readable" on public.reactions;
create policy "reactions readable" on public.reactions
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "react as self" on public.reactions;
-- Not on your own post: the heart there shows who liked it instead.
create policy "react as self" on public.reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id <> auth.uid())
  );
-- Likes people gave their own posts before that rule.
delete from public.reactions r
using public.posts p
where p.id = r.post_id and p.user_id = r.user_id;
drop policy if exists "unreact as self" on public.reactions;
create policy "unreact as self" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- comments: all signed-in users read; you write/delete your own
-- Can the caller reply under this comment? It has to be a top-level comment
-- on the same post, by someone the caller isn't blocked with. A function
-- because a policy on comments can't query comments itself (Postgres refuses
-- the recursion).
create or replace function public.can_reply_under(parent uuid, post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
    where c.id = parent
      and c.post_id = post
      and c.parent_id is null
      and not public.is_blocked_pair(c.user_id, auth.uid())
  );
$$;
revoke all on function public.can_reply_under(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_reply_under(uuid, uuid) to authenticated;

drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "comment as self" on public.comments;
create policy "comment as self" on public.comments
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
    -- A reply sits under a top-level comment on the same post.
    and (parent_id is null or public.can_reply_under(parent_id, post_id))
  );
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
-- No insert policy: a chat only starts through start_conversation() or
-- start_group_conversation(), which check follows and blocks.
drop policy if exists "create conversations" on public.conversations;
-- Members may rename a thread and bump it when they send, nothing else (the
-- column grants at the end of this file), and updated_at is always the
-- server's clock (stamp_conversation_activity).
drop policy if exists "touch own conversations" on public.conversations;
create policy "touch own conversations" on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

drop policy if exists "read members of own conversations" on public.conversation_members;
create policy "read members of own conversations" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
-- No insert policy: members are only ever added by start_conversation() and
-- start_group_conversation(). An earlier policy let a member add people
-- directly, and before that let anyone add themselves to a thread.
drop policy if exists "join conversations" on public.conversation_members;
-- Mute and last-read only (column grants at the end of this file). Without
-- that, a member could move their own row into any other thread
-- (update ... set conversation_id = ...) and read its history.
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
    -- A shared post must be one you can see.
    and (shared_post_id is null or exists (select 1 from public.posts p where p.id = shared_post_id))
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
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "like comment as self" on public.comment_reactions;
create policy "like comment as self" on public.comment_reactions
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.comments c where c.id = comment_id)
  );
drop policy if exists "unlike comment as self" on public.comment_reactions;
create policy "unlike comment as self" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

-- reposts
drop policy if exists "reposts readable" on public.reposts;
create policy "reposts readable" on public.reposts
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "repost as self" on public.reposts;
create policy "repost as self" on public.reposts
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "unrepost as self" on public.reposts;
create policy "unrepost as self" on public.reposts
  for delete to authenticated using (user_id = auth.uid());

-- shares
drop policy if exists "shares readable" on public.shares;
create policy "shares readable" on public.shares
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "share as self" on public.shares;
create policy "share as self" on public.shares
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "update own share" on public.shares;
create policy "update own share" on public.shares
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- saved_posts: private to the owner (only you read/write your bookmarks)
drop policy if exists "read own saves" on public.saved_posts;
create policy "read own saves" on public.saved_posts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "save as self" on public.saved_posts;
create policy "save as self" on public.saved_posts
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );
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

-- streaks: readable by everyone (the leaderboard), written only by the
-- database (bump_streak, on every post). When the app wrote them, anyone could
-- give themselves a 999-day streak and top the leaderboard.
drop policy if exists "streaks readable" on public.streaks;
create policy "streaks readable" on public.streaks
  for select to authenticated using (true);
drop policy if exists "upsert own streak" on public.streaks;
drop policy if exists "update own streak" on public.streaks;
revoke insert, update, delete on public.streaks from anon, authenticated;

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
-- Every photo the app makes is a JPEG, and upload-photo checks the bytes too.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos', 'photos', true,
  10485760,                                        -- 10 MB
  array['image/jpeg']
)
-- Re-running repairs the limits on a bucket that already exists, including one
-- created by hand through the dashboard without them.
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The bucket is public, so photos load by URL with no policy at all. This one
-- only controls listing and reading through the API, which the app needs just
-- for its own files (deleting a photo looks it up first). It used to allow
-- everyone, signed in or not, to list every file, DM photos included.
drop policy if exists "photos public read" on storage.objects;
drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- No client uploads at all: only the upload-photo edge function (service
-- role) writes files, after checking they're real JPEGs and stripping
-- metadata, with a folder and random name it picks itself.
drop policy if exists "upload own photos" on storage.objects;
drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DM photos: a PRIVATE bucket, one folder per conversation. Only people in
-- that chat can read a photo (and so get a short-lived signed link to it).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm-photos', 'dm-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "read photos in own chats" on storage.objects;
create policy "read photos in own chats" on storage.objects
  for select to authenticated using (
    bucket_id = 'dm-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid())
      else false
    end
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

-- Per person per day, per person per minute, and for the whole app per day
-- (0034): the ceiling on what any number of accounts can spend together.
-- Refused calls aren't counted. SECURITY DEFINER with a pinned search_path;
-- only the server (service role) may call it.
alter table public.ai_usage add column if not exists minute_start timestamptz;
alter table public.ai_usage add column if not exists minute_count integer not null default 0;

create table if not exists public.ai_usage_global (
  day date primary key,
  count integer not null default 0
);
alter table public.ai_usage_global enable row level security;
revoke all on table public.ai_usage_global from anon, authenticated;

drop function if exists public.consume_ai_quota(uuid, integer);
create or replace function public.consume_ai_quota(
  target uuid,
  daily_limit integer,
  per_minute integer default 6,
  global_daily integer default 2000
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  this_minute timestamptz := date_trunc('minute', now());
  used integer;
  burst integer;
  started timestamptz;
  everyone integer;
begin
  if global_daily < 1 then return false; end if;

  -- One row per person per day, locked so parallel calls count one at a time.
  insert into public.ai_usage (user_id, day, count, minute_start, minute_count)
  values (target, today, 0, this_minute, 0)
  on conflict (user_id, day) do nothing;
  select u.count, u.minute_start, u.minute_count into used, started, burst
  from public.ai_usage u
  where u.user_id = target and u.day = today
  for update;
  if started is distinct from this_minute then burst := 0; end if;

  -- Refused calls cost nothing, so they don't use up the allowance either.
  if used >= daily_limit or burst >= per_minute then
    return false;
  end if;

  -- The app-wide ceiling: counted only when there's room.
  insert into public.ai_usage_global as g (day, count) values (today, 1)
  on conflict (day) do update set count = g.count + 1
    where g.count < global_daily
  returning g.count into everyone;
  if everyone is null then return false; end if;

  update public.ai_usage u
  set count = used + 1, minute_start = this_minute, minute_count = burst + 1
  where u.user_id = target and u.day = today;
  return true;
end;
$$;
revoke all on function public.consume_ai_quota(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer, integer, integer) to service_role;

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
-- The three policy helpers genuinely need `authenticated`: an RLS policy
-- expression runs as the caller, so the caller must be able to execute what the
-- policy calls (and they only answer about the caller). Everything else gets
-- nothing.
revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

-- No policy uses these two any more (members are only added by the start
-- functions), so nobody gets to call them.
revoke all on function public.conversation_is_empty(uuid) from public, anon, authenticated;

revoke all on function public.conversation_has_block(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conversation_has_block(uuid, uuid) to authenticated;

revoke all on function public.is_following(uuid, uuid) from public, anon, authenticated;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- Called directly by the app. Follower counts are public by design.
revoke all on function public.follow_counts(uuid) from public, anon, authenticated;
grant execute on function public.follow_counts(uuid) to authenticated;

-- Only the format-recipe edge function calls this, and it uses the service
-- role key. No client should ever be able to move another user's meter.
revoke all on function public.consume_ai_quota(uuid, integer, integer, integer) from public, anon, authenticated;

-- Trigger functions. Postgres does not check EXECUTE on a trigger function when
-- the trigger fires — only when the trigger is created — so revoking here costs
-- nothing and removes two more entry points.
revoke all on function public.notify_post_interaction() from public, anon, authenticated;
revoke all on function public.notify_comment() from public, anon, authenticated;


-- ======================================== values the server owns (0030)
-- What a client must not be able to choose: dates, streaks, the facts in a
-- report, and any column the app has no reason to change. Each was proven
-- possible with a normal account by supabase/tests/rls_attack_test.sql.

-- 3. The server's clock ------------------------------------------------------------
-- For the app's own requests only: the dashboard, the service role and
-- server-side functions keep whatever they set. The column is named by the
-- trigger's argument (created_at unless said otherwise).
create or replace function public.stamp_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text := coalesce(tg_argv[0], 'created_at');
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new := jsonb_populate_record(new, jsonb_build_object(col, now()));
    else
      new := jsonb_populate_record(new, jsonb_build_object(col, to_jsonb(old) -> col));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_created_at() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'follows', 'posts', 'recipes', 'reactions', 'comments', 'reposts',
    'shares', 'saved_posts', 'blocks', 'conversations', 'collections', 'messages',
    'comment_reactions', 'reports', 'feedback', 'post_tags', 'message_reactions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp_created_at', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.stamp_created_at()',
      t || '_stamp_created_at', t);
  end loop;
end $$;
drop trigger if exists collection_posts_stamp_added_at on public.collection_posts;
create trigger collection_posts_stamp_added_at before insert or update on public.collection_posts
  for each row execute function public.stamp_created_at('added_at');

-- A thread's "last activity" is always now, so nobody can pin a thread to
-- the top of someone else's inbox.
create or replace function public.stamp_conversation_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_conversation_activity() from public, anon, authenticated;
drop trigger if exists conversations_stamp_activity on public.conversations;
create trigger conversations_stamp_activity before update on public.conversations
  for each row execute function public.stamp_conversation_activity();

-- 4. Streaks are kept by the database ------------------------------------------------
-- One more day when you post on the day after your last posting day, in your
-- own timezone; back to 1 after a gap; unchanged for a second post the same day.
create or replace function public.bump_streak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  today date;
  s public.streaks%rowtype;
begin
  select u.timezone into tz from public.users u where u.id = new.user_id;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then
    tz := 'UTC';
  end if;
  today := (now() at time zone tz)::date;

  select * into s from public.streaks where user_id = new.user_id for update;
  if not found then
    insert into public.streaks (user_id, current_streak, longest_streak, last_post_date)
    values (new.user_id, 1, 1, today)
    on conflict (user_id) do nothing;
  elsif s.last_post_date is null or s.last_post_date < today - 1 then
    update public.streaks
      set current_streak = 1, longest_streak = greatest(longest_streak, 1), last_post_date = today
      where user_id = new.user_id;
  elsif s.last_post_date = today - 1 then
    update public.streaks
      set current_streak = current_streak + 1,
          longest_streak = greatest(longest_streak, current_streak + 1),
          last_post_date = today
      where user_id = new.user_id;
  end if;
  -- Same day (or a date ahead of today): nothing to add.
  return new;
end;
$$;
revoke all on function public.bump_streak() from public, anon, authenticated;
drop trigger if exists posts_bump_streak on public.posts;
create trigger posts_bump_streak after insert on public.posts
  for each row execute function public.bump_streak();

-- 6. Reports and feedback: the database fills in the facts ------------------------------
-- SECURITY INVOKER on purpose: it reads the reported post / comment / message
-- with the reporter's own RLS, so you can only report what you can see, and a
-- report can't be used to read a DM you are not in.
create or replace function public.prepare_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.status := 'open';
  new.reviewed_at := null;
  new.reviewer_notes := null;
  new.post_blurb_snapshot := null;
  new.post_photo_url_snapshot := null;
  new.message_text_snapshot := null;
  new.message_image_url_snapshot := null;
  new.comment_text_snapshot := null;

  if (new.post_id is not null)::int + (new.comment_id is not null)::int
     + (new.message_id is not null)::int > 1 then
    raise exception 'Report one thing at a time.' using errcode = '22023';
  end if;

  if new.post_id is not null then
    select p.user_id, p.blurb, p.photo_url
      into new.reported_user_id, new.post_blurb_snapshot, new.post_photo_url_snapshot
      from public.posts p where p.id = new.post_id;
    if not found then
      raise exception 'That post is not available to report.' using errcode = '42501';
    end if;
  elsif new.comment_id is not null then
    select c.user_id, nullif(c.text, '')
      into new.reported_user_id, new.comment_text_snapshot
      from public.comments c where c.id = new.comment_id;
    if not found then
      raise exception 'That comment is not available to report.' using errcode = '42501';
    end if;
  elsif new.message_id is not null then
    select m.sender_id, nullif(m.text, ''),
           coalesce(m.image_url, 'dm-photos/' || m.image_path)
      into new.reported_user_id, new.message_text_snapshot, new.message_image_url_snapshot
      from public.messages m where m.id = new.message_id;
    if not found then
      raise exception 'That message is not available to report.' using errcode = '42501';
    end if;
  end if;
  -- An account report names the person directly; it has to be a real one.
  if new.reported_user_id is null
     or not exists (select 1 from public.users u where u.id = new.reported_user_id) then
    raise exception 'Nothing to report.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_report() from public, anon, authenticated;
drop trigger if exists reports_prepare on public.reports;
create trigger reports_prepare before insert on public.reports
  for each row execute function public.prepare_report();

create or replace function public.prepare_feedback()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := 'new';
    new.reviewed_at := null;
    new.reviewer_notes := null;
    new.handle_snapshot := (select u.handle from public.users u where u.id = auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_feedback() from public, anon, authenticated;
drop trigger if exists feedback_prepare on public.feedback;
create trigger feedback_prepare before insert on public.feedback
  for each row execute function public.prepare_feedback();

-- 7. Only the columns the app edits -----------------------------------------------------
revoke update on public.users from anon, authenticated;
grant update (display_name, bio, avatar_emoji, avatar_url, follows_private)
  on public.users to authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- DMs: members change only these columns. Everything else about a membership
-- (which thread, whose) is fixed.
revoke update on public.conversation_members from anon, authenticated;
grant update (last_read_at, muted) on public.conversation_members to authenticated;
revoke update on public.conversations from anon, authenticated;
grant update (title, updated_at) on public.conversations to authenticated;


-- ===================================================== photo storage (0031)
-- Settings the database needs to know about this project -----------------------------
-- Only public values belong here (signed-in users can read them). The storage
-- origin is recorded by upload-photo the first time it stores a photo.
create table if not exists public.app_config (
  key text primary key constraint app_config_key_len check (char_length(key) <= 64),
  value text not null constraint app_config_value_len check (char_length(value) <= 500)
);
alter table public.app_config enable row level security;
drop policy if exists "settings readable" on public.app_config;
create policy "settings readable" on public.app_config
  for select to authenticated using (true);
revoke insert, update, delete on public.app_config from anon, authenticated;

-- 3. Photo links must be real uploads, in your own space --------------------------------
-- SECURITY INVOKER on purpose: it looks the file up with the caller's own
-- storage access (their own folder; for DM photos, chats they're in).
create or replace function public.check_photo_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prefix text;
  link text;
  prev text;
  rest text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'messages' then
    -- New DM photos travel by private path, never as a public link.
    if tg_op = 'INSERT' and new.image_url is not null then
      raise exception 'Send photos with the app.' using errcode = '42501';
    end if;
    if new.image_path is not null
       and (tg_op = 'INSERT' or new.image_path is distinct from old.image_path) then
      if split_part(new.image_path, '/', 1) <> new.conversation_id::text
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'dm-photos' and o.name = new.image_path
         ) then
        raise exception 'That photo is not in this chat.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'posts' then
    link := new.photo_url;
    if tg_op = 'UPDATE' then prev := old.photo_url; end if;
  elsif tg_table_name = 'users' then
    link := new.avatar_url;
    if tg_op = 'UPDATE' then prev := old.avatar_url; end if;
  elsif tg_table_name = 'comments' then
    link := new.image_url;
    if tg_op = 'UPDATE' then prev := old.image_url; end if;
  end if;

  -- Unchanged links (older posts being edited) are left alone.
  if link is null or (tg_op = 'UPDATE' and link is not distinct from prev) then
    return new;
  end if;

  prefix := (select c.value from public.app_config c where c.key = 'storage_origin')
            || '/storage/v1/object/public/photos/' || auth.uid()::text || '/';
  rest := case when prefix is not null and left(link, length(prefix)) = prefix
               then substr(link, length(prefix) + 1) end;
  if rest is null
     or rest !~ '^[0-9a-f]{32}\.jpg$'
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'photos' and o.name = auth.uid()::text || '/' || rest
     ) then
    raise exception 'Upload photos with the app.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.check_photo_links() from public, anon, authenticated;

drop trigger if exists posts_check_photo_links on public.posts;
create trigger posts_check_photo_links before insert or update on public.posts
  for each row execute function public.check_photo_links();
drop trigger if exists users_check_photo_links on public.users;
create trigger users_check_photo_links before insert or update on public.users
  for each row execute function public.check_photo_links();
drop trigger if exists comments_check_photo_links on public.comments;
create trigger comments_check_photo_links before insert or update on public.comments
  for each row execute function public.check_photo_links();
drop trigger if exists messages_check_photo_links on public.messages;
create trigger messages_check_photo_links before insert or update on public.messages
  for each row execute function public.check_photo_links();

-- 4. Orphaned files ------------------------------------------------------------------------
-- Files in either bucket that nothing points at any more and are older than
-- `grace` (so a photo uploaded a moment before its post is saved isn't
-- caught). Evidence in an open report counts as in use. Server only: the
-- sweep-storage function calls it, then deletes through the Storage API
-- (deleting rows here would leave the actual files behind).
create or replace function public.storage_orphans(grace interval, only_bucket text default null)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with photo_links(u) as (
    select photo_url from public.posts
    union all select avatar_url from public.users
    union all select image_url from public.comments
    union all select image_url from public.messages
    union all select post_photo_url_snapshot from public.reports where status in ('open', 'reviewing')
    union all select message_image_url_snapshot from public.reports where status in ('open', 'reviewing')
  ),
  used(bucket, name) as (
    select 'photos', substring(u from '/storage/v1/object/public/photos/(.+)$')
      from photo_links where u is not null
    union all
    select 'dm-photos', image_path from public.messages where image_path is not null
    union all
    select 'dm-photos', substring(message_image_url_snapshot from '^dm-photos/(.+)$')
      from public.reports
      where status in ('open', 'reviewing') and message_image_url_snapshot like 'dm-photos/%'
  )
  select o.bucket_id || '/' || o.name
  from storage.objects o
  where o.bucket_id in ('photos', 'dm-photos')
    and (only_bucket is null or o.bucket_id = only_bucket)
    and o.created_at < now() - grace
    and o.name not like '%.emptyFolderPlaceholder'
    and not exists (select 1 from used x where x.bucket = o.bucket_id and x.name = o.name)
  order by 1;
$$;
revoke all on function public.storage_orphans(interval, text) from public, anon, authenticated;
grant execute on function public.storage_orphans(interval, text) to service_role;

-- 5. Upload cap -----------------------------------------------------------------------------
create table if not exists public.upload_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  hour timestamptz not null,
  count integer not null default 0,
  primary key (user_id, hour)
);
alter table public.upload_usage enable row level security;
revoke all on table public.upload_usage from anon, authenticated;

create or replace function public.consume_upload_quota(target uuid, hourly_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  insert into public.upload_usage (user_id, hour, count)
  values (target, date_trunc('hour', now()), 1)
  on conflict (user_id, hour)
    do update set count = public.upload_usage.count + 1
  returning count into used;
  -- Old hours are no use to anyone.
  delete from public.upload_usage
  where user_id = target and hour < date_trunc('hour', now()) - interval '1 day';
  return used <= hourly_limit;
end;
$$;
revoke all on function public.consume_upload_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_upload_quota(uuid, integer) to service_role;

-- Live Activity for the in-app banner (migration 0029): send new notifications
-- rows to the app as they happen. RLS still decides who receives what.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;


-- ====================================================== chat hardening (0032)
-- Message pushes: notify-message (service role) claims each message once, and
-- only a fresh one, sent by the caller, in the thread named, while they're
-- still in it. Calling it again sends nothing.
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


-- Push tokens: one account per phone. Saving a token moves it off any other
-- account, so a phone that switched accounts stops showing the old account's
-- DMs. Tokens must look like Expo's; an account keeps at most 10.
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


-- ======================================================= session checks (0033)
-- PostgREST runs check_request() before every API request. A signed-in token
-- is refused (401) unless the session it names still exists, belongs to it,
-- hasn't passed its time limit, and the account isn't deleted or banned. So
-- signing out, deleting the account or a ban locks the old token out at once
-- instead of when it expires. Kill switch:
--   alter role authenticator reset pgrst.db_pre_request;
--   notify pgrst, 'reload config';
create or replace function public.check_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  uid uuid;
  sid uuid;
  sess jsonb;
  usr jsonb;
begin
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;

  begin
    uid := (claims ->> 'sub')::uuid;
    sid := (claims ->> 'session_id')::uuid;
  exception when others then
    uid := null;
  end;

  if uid is not null and sid is not null then
    -- to_jsonb so a column Supabase Auth adds or drops never breaks requests.
    select to_jsonb(s) into sess from auth.sessions s where s.id = sid;
    select to_jsonb(u) into usr from auth.users u where u.id = uid;
  end if;

  if sess is null
     or usr is null
     or (sess ->> 'user_id')::uuid is distinct from uid
     or coalesce((sess ->> 'not_after')::timestamptz > now(), true) is not true
     or (usr ->> 'deleted_at') is not null
     or coalesce((usr ->> 'banned_until')::timestamptz <= now(), true) is not true then
    raise sqlstate 'PGRST' using
      message = '{"code":"session_ended","message":"Your session has ended. Please sign in again.","details":null,"hint":null}',
      detail = '{"status":401,"headers":{}}';
  end if;
end;
$$;
revoke all on function public.check_request() from public;
grant execute on function public.check_request() to anon, authenticated, service_role;

-- Turn it on, but only once it's been shown to work here: if this database
-- won't let the function read auth.sessions, switching it on would refuse
-- every signed-in request. verify.sql reports whether it's on.
do $$
begin
  perform 1 from auth.sessions limit 1;
  perform 1 from auth.users limit 1;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.check_request';
    perform pg_notify('pgrst', 'reload config');
  end if;
exception when others then
  raise warning 'Session check NOT switched on (%). Signed-out tokens still work until they expire.', sqlerrm;
end
$$;


-- ===================================================== recipe JSON shape (0034)
-- Everyone who opens a post draws its recipe card, and an object where text
-- belongs crashes the screen drawing it. So ingredients, steps and nutrition
-- must be the documented shape, not just under a size limit.
-- Nutrition: an object of non-negative numbers (totals, so generous bounds).
create or replace function public.recipe_nutrition_ok(n jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select n is null
      or jsonb_typeof(n) = 'null'
      or (jsonb_typeof(n) = 'object'
          and not exists (
            select 1 from jsonb_each(n) e
            where jsonb_typeof(e.value) <> 'number'
               or (e.value)::text::numeric < 0
               or (e.value)::text::numeric > 100000000));
$$;

-- Ingredients: objects whose item is text and whose quantity and unit are text
-- or a number (older cards have "quantity": 1), capped like the app's fields,
-- and whose weight, USDA id and nutrition are numbers.
create or replace function public.recipe_ingredients_ok(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(j) e(v)
       where jsonb_typeof(v) <> 'object'
          or jsonb_typeof(v -> 'item') is distinct from 'string'
          or char_length(v ->> 'item') > 120
          or coalesce(jsonb_typeof(v -> 'quantity'), 'null') not in ('string', 'number', 'null')
          or char_length(coalesce(v ->> 'quantity', '')) > 32
          or coalesce(jsonb_typeof(v -> 'unit'), 'null') not in ('string', 'number', 'null')
          or char_length(coalesce(v ->> 'unit', '')) > 32
          or coalesce(jsonb_typeof(v -> 'grams'), 'null') not in ('number', 'null')
          or (jsonb_typeof(v -> 'grams') = 'number'
              and ((v ->> 'grams')::numeric < 0 or (v ->> 'grams')::numeric > 20000))
          or coalesce(jsonb_typeof(v -> 'fdc_id'), 'null') not in ('number', 'null')
          or not public.recipe_nutrition_ok(v -> 'nutrition'));
$$;

-- Steps: text, at most 500 characters each.
create or replace function public.recipe_steps_ok(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(j) e(v)
       where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500);
$$;

-- The checks run as whoever saves the card, so signed-in users need to be
-- able to call them. They're pure: they read nothing but their argument.
revoke all on function public.recipe_nutrition_ok(jsonb) from public, anon;
revoke all on function public.recipe_ingredients_ok(jsonb) from public, anon;
revoke all on function public.recipe_steps_ok(jsonb) from public, anon;
grant execute on function public.recipe_nutrition_ok(jsonb) to authenticated, service_role;
grant execute on function public.recipe_ingredients_ok(jsonb) to authenticated, service_role;
grant execute on function public.recipe_steps_ok(jsonb) to authenticated, service_role;

-- NOT VALID: new and edited cards are checked from now on. Cards saved before
-- are then checked too, if they all pass; if any don't, the app's own reader
-- (cleanRecipe) still draws them safely, and verify.sql says how many.
alter table public.recipes drop constraint if exists recipes_ingredients_shape;
alter table public.recipes
  add constraint recipes_ingredients_shape check (public.recipe_ingredients_ok(ingredients)) not valid;
alter table public.recipes drop constraint if exists recipes_steps_shape;
alter table public.recipes
  add constraint recipes_steps_shape check (public.recipe_steps_ok(steps)) not valid;
alter table public.recipes drop constraint if exists recipes_nutrition_shape;
alter table public.recipes
  add constraint recipes_nutrition_shape check (public.recipe_nutrition_ok(nutrition)) not valid;

do $$
begin
  alter table public.recipes validate constraint recipes_ingredients_shape;
  alter table public.recipes validate constraint recipes_steps_shape;
  alter table public.recipes validate constraint recipes_nutrition_shape;
exception when check_violation then
  raise warning 'Some recipe cards saved before 0034 are malformed; new ones are checked. verify.sql lists them.';
end
$$;


-- ================================================ spam, duplicates, text (0035)
-- Per-person rate limits on everything people create (app requests only),
-- duplicate guards for a double-tapped post or comment, no direction-flipping
-- or control characters in names and text, no staff-looking handles from the
-- app, and a bounded push-token platform.
-- 1. Rate limits ---------------------------------------------------------------------------
create table if not exists public.action_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);
alter table public.action_usage enable row level security;
revoke all on table public.action_usage from anon, authenticated;

-- Trigger arguments: action name, how many, per what interval.
create or replace function public.limit_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  who uuid;
  act text := tg_argv[0];
  max_n integer := tg_argv[1]::integer;
  win interval := tg_argv[2]::interval;
  started timestamptz;
  n integer;
begin
  -- Only requests from the app. The server and the dashboard pass.
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  begin
    who := (claims ->> 'sub')::uuid;
  exception when others then
    return new;
  end;
  if who is null or not exists (select 1 from public.users where id = who) then
    return new;
  end if;

  started := date_bin(win, now(), timestamptz '2000-01-01 00:00:00+00');
  insert into public.action_usage as a (user_id, action, window_start, count)
  values (who, act, started, 1)
  on conflict (user_id, action, window_start) do update set count = a.count + 1
  returning a.count into n;
  if n > max_n then
    raise exception 'You''re doing that too fast. Try again in a little while.'
      using errcode = 'P0001', hint = 'rate_limited:' || act;
  end if;
  -- Old windows are no use to anyone (cheap: same person and action).
  if n = 1 then
    delete from public.action_usage
    where user_id = who and action = act and window_start < now() - interval '2 days';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_rate() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('posts',             'post',          30,  '1 hour'),
      ('comments',          'comment',       20,  '5 minutes'),
      ('messages',          'message',       30,  '1 minute'),
      ('conversations',     'new_chat',      30,  '1 hour'),
      ('follows',           'follow',        60,  '1 hour'),
      ('reactions',         'like',          300, '1 hour'),
      ('comment_reactions', 'comment_like',  300, '1 hour'),
      ('message_reactions', 'message_react', 300, '1 hour'),
      ('reposts',           'repost',        100, '1 hour'),
      ('shares',            'share',         100, '1 hour'),
      ('post_tags',         'tag',           100, '1 hour'),
      ('collections',       'collection',    50,  '1 hour'),
      ('reports',           'report',        20,  '1 day'),
      ('feedback',          'feedback',      10,  '1 day')
    ) v(tbl, act, n, win)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_limit_rate', r.tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.limit_rate(%L, %L, %L)',
      r.tbl || '_limit_rate', r.tbl, r.act, r.n::text, r.win);
  end loop;
end
$$;

-- 2. Duplicates -----------------------------------------------------------------------------
create index if not exists posts_photo_url_idx on public.posts (photo_url);

create or replace function public.refuse_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'posts' then
    -- Every upload has its own random name, so a photo is posted once.
    if exists (select 1 from public.posts p where p.photo_url = new.photo_url) then
      raise exception 'That photo is already posted.' using errcode = '23505';
    end if;
  elsif tg_table_name = 'comments' then
    if exists (
      select 1 from public.comments c
      where c.user_id = new.user_id and c.post_id = new.post_id
        and c.text = new.text
        and c.image_url is not distinct from new.image_url
        and c.created_at > now() - interval '1 minute'
    ) then
      raise exception 'You just posted that comment.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_duplicate() from public, anon, authenticated;

drop trigger if exists posts_refuse_duplicate on public.posts;
create trigger posts_refuse_duplicate before insert on public.posts
  for each row execute function public.refuse_duplicate();
drop trigger if exists comments_refuse_duplicate on public.comments;
create trigger comments_refuse_duplicate before insert on public.comments
  for each row execute function public.refuse_duplicate();

-- 3. Text that can't disguise who wrote it --------------------------------------------------
-- No control characters (bar line breaks and tabs where text may have lines)
-- and no direction overrides or isolates (U+202A-202E, U+2066-2069).
create or replace function public.plain_text_ok(t text, multiline boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t is null
      or (t !~ '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]'
          and (multiline or t !~ '[\n\r\t]'));
$$;
-- The checks run as whoever saves the row, so signed-in users can call it. It
-- reads nothing but its arguments.
revoke all on function public.plain_text_ok(text, boolean) from public, anon;
grant execute on function public.plain_text_ok(text, boolean) to authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('users',         'display_name', false),
      ('users',         'bio',          true),
      ('posts',         'blurb',        true),
      ('comments',      'text',         true),
      ('messages',      'text',         true),
      ('collections',   'name',         false),
      ('conversations', 'title',        false),
      ('recipes',       'title',        false)
    ) v(tbl, col, multi)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.tbl || '_' || r.col || '_plain');
    -- NOT VALID: new and edited text is checked; anything older stays as it is.
    execute format('alter table public.%I add constraint %I check (public.plain_text_ok(%I, %L)) not valid',
      r.tbl, r.tbl || '_' || r.col || '_plain', r.col, r.multi);
  end loop;
end
$$;

-- 4. Staff-looking handles ------------------------------------------------------------------
create or replace function public.handle_reserved(h text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(h) like '%niblgo%'
      or lower(h) in (
        'admin', 'admins', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
        'contact', 'official', 'moderator', 'moderators', 'mod', 'mods', 'staff', 'team',
        'security', 'safety', 'trust', 'abuse', 'legal', 'privacy', 'terms', 'api', 'www',
        'app', 'auth', 'login', 'signup', 'settings', 'about', 'null', 'undefined',
        'anonymous', 'everyone', 'here', 'feed', 'inbox', 'discover', 'search', 'streaks',
        'notifications', 'activity', 'post', 'posts', 'me', 'u');
$$;
revoke all on function public.handle_reserved(text) from public, anon, authenticated;

create or replace function public.refuse_reserved_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  -- From the app only: the team can still make an official account by hand.
  if coalesce(claims ->> 'role', '') = 'authenticated' and public.handle_reserved(new.handle) then
    -- 23505 (taken) so the app's sign-up picks a free variant, as it does for
    -- a handle someone else already has.
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_reserved_handle() from public, anon, authenticated;

drop trigger if exists users_refuse_reserved_handle on public.users;
create trigger users_refuse_reserved_handle before insert or update of handle on public.users
  for each row execute function public.refuse_reserved_handle();

-- 5. push_tokens.platform ---------------------------------------------------------------------
alter table public.push_tokens drop constraint if exists push_tokens_platform_valid;
alter table public.push_tokens
  add constraint push_tokens_platform_valid
  check (platform is null or platform in ('ios', 'android', 'web')) not valid;
