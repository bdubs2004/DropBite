-- DropBite MVP schema (run in Supabase SQL editor, or `supabase db push`)
-- Matches the data model in CLAUDE.md. All timestamps UTC.

create type meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');

-- ---------------------------------------------------------------- users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_]{2,30}$'),
  display_name text not null,
  avatar_url text,
  avatar_emoji text,
  bio text,
  timezone text not null default 'UTC',
  follows_private boolean not null default false,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- follows
create table public.follows (
  follower_id uuid not null references public.users (id) on delete cascade,
  followee_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- ---------------------------------------------------------------- posts
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  meal_slot meal_slot not null,
  photo_url text not null,
  blurb text not null default '',          -- verbatim user words, source of truth
  restaurant_place_id text,
  restaurant_name text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
create index posts_user_created_idx on public.posts (user_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc);

-- -------------------------------------------------------------- recipes
-- Structured ingredients {item, quantity, unit} are the long-term data asset.
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid unique not null references public.posts (id) on delete cascade,
  title text not null,
  ingredients jsonb not null default '[]'::jsonb,  -- [{item, quantity, unit}]
  steps jsonb not null default '[]'::jsonb,        -- [string]
  cook_time_minutes integer,
  ai_generated boolean not null default false,
  user_edited boolean not null default false,      -- tracks AI accuracy over time
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ reactions
create table public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ------------------------------------------------------------- comments
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index comments_post_created_idx on public.comments (post_id, created_at);

-- -------------------------------------------------------------- reposts
create table public.reposts (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- --------------------------------------------------------------- shares
-- One row per (user, post): keeps the share count honest and idempotent.
create table public.shares (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------- saved_posts
-- Private bookmarks: a user's saved posts (only they can read their own).
create table public.saved_posts (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index saved_posts_user_created_idx on public.saved_posts (user_id, created_at desc);

-- -------------------------------------------------------- direct messages
-- 1:1 threads today; the members table means group DMs need no migration.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Bumped on every message so the inbox can sort without a join.
  updated_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- When this member last opened the thread; drives the unread badge.
  last_read_at timestamptz not null default 'epoch',
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.users (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 2000),
  -- A shared post. SET NULL so deleting the post doesn't delete the message;
  -- the thread still reads sensibly, the attachment just goes away.
  shared_post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A message must carry something.
  check (char_length(text) > 0 or shared_post_id is not null)
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

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

revoke all on function public.is_conversation_member(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

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

revoke all on function public.conversation_is_empty(uuid) from public;
grant execute on function public.conversation_is_empty(uuid) to authenticated;

-- ---------------------------------------------------- comment_reactions
-- Likes on comments. Same shape as post reactions: one row per (comment, user)
-- so the count is inherently idempotent.
create table public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_reactions_comment_idx on public.comment_reactions (comment_id);

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
create table public.reports (
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
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text check (reviewer_notes is null or char_length(reviewer_notes) <= 2000)
);
-- One report per person per post: stops one user spamming the queue to bury
-- a post, while still letting many different people report the same thing.
create unique index reports_one_per_reporter_idx on public.reports (reporter_id, post_id);
-- The triage view: oldest open reports first.
create index reports_status_created_idx on public.reports (status, created_at);
create index reports_reported_user_idx on public.reports (reported_user_id);

-- -------------------------------------------------------------- streaks
create table public.streaks (
  user_id uuid primary key references public.users (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_post_date date
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
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.reports enable row level security;
alter table public.streaks enable row level security;

-- users: everyone signed-in can read profiles; you manage your own row
create policy "users readable" on public.users
  for select to authenticated using (true);
create policy "insert own profile" on public.users
  for insert to authenticated with check (id = auth.uid());
create policy "update own profile" on public.users
  for update to authenticated using (id = auth.uid());
create policy "delete own profile" on public.users
  for delete to authenticated using (id = auth.uid());

-- follows
create policy "follows readable" on public.follows
  for select to authenticated using (true);
create policy "follow as self" on public.follows
  for insert to authenticated with check (follower_id = auth.uid());
create policy "unfollow as self" on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- posts: MVP = all signed-in users can read (feed filters client/server-side)
create policy "posts readable" on public.posts
  for select to authenticated using (true);
create policy "create own posts" on public.posts
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own posts" on public.posts
  for update to authenticated using (user_id = auth.uid());
create policy "delete own posts" on public.posts
  for delete to authenticated using (user_id = auth.uid());

-- recipes follow their post's owner
create policy "recipes readable" on public.recipes
  for select to authenticated using (true);
create policy "create recipes on own posts" on public.recipes
  for insert to authenticated with check (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
create policy "update recipes on own posts" on public.recipes
  for update to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
create policy "delete recipes on own posts" on public.recipes
  for delete to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

-- reactions
create policy "reactions readable" on public.reactions
  for select to authenticated using (true);
create policy "react as self" on public.reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "unreact as self" on public.reactions
  for delete to authenticated using (user_id = auth.uid());

-- comments: all signed-in users read; you write/delete your own
create policy "comments readable" on public.comments
  for select to authenticated using (true);
create policy "comment as self" on public.comments
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own comment" on public.comments
  for delete to authenticated using (user_id = auth.uid());

-- direct messages: strictly members-only. These are the most private rows in
-- the app — nothing here is readable by anyone outside the thread.
create policy "read own conversations" on public.conversations
  for select to authenticated using (public.is_conversation_member(id, auth.uid()));
create policy "create conversations" on public.conversations
  for insert to authenticated with check (true);
-- Bumping updated_at when sending is allowed for members only.
create policy "touch own conversations" on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

create policy "read members of own conversations" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
-- Two ways in, and no third:
--   * you are already a member, so you may add someone else; or
--   * the conversation is brand new and empty, so you may add yourself.
-- A bare `user_id = auth.uid()` is NOT enough: that would let anyone add
-- themselves to a stranger's existing thread and read the whole history.
create policy "join conversations" on public.conversation_members
  for insert to authenticated with check (
    public.is_conversation_member(conversation_id, auth.uid())
    or (user_id = auth.uid() and public.conversation_is_empty(conversation_id))
  );
create policy "update own membership" on public.conversation_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave conversations" on public.conversation_members
  for delete to authenticated using (user_id = auth.uid());

create policy "read messages in own conversations" on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id, auth.uid()));
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid())
  );
create policy "delete own messages" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- comment reactions: readable by all signed-in users, written as yourself
create policy "comment reactions readable" on public.comment_reactions
  for select to authenticated using (true);
create policy "like comment as self" on public.comment_reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "unlike comment as self" on public.comment_reactions
  for delete to authenticated using (user_id = auth.uid());

-- reposts
create policy "reposts readable" on public.reposts
  for select to authenticated using (true);
create policy "repost as self" on public.reposts
  for insert to authenticated with check (user_id = auth.uid());
create policy "unrepost as self" on public.reposts
  for delete to authenticated using (user_id = auth.uid());

-- shares
create policy "shares readable" on public.shares
  for select to authenticated using (true);
create policy "share as self" on public.shares
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own share" on public.shares
  for update to authenticated using (user_id = auth.uid());

-- saved_posts: private to the owner (only you read/write your bookmarks)
create policy "read own saves" on public.saved_posts
  for select to authenticated using (user_id = auth.uid());
create policy "save as self" on public.saved_posts
  for insert to authenticated with check (user_id = auth.uid());
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
create policy "file report as self" on public.reports
  for insert to authenticated with check (
    reporter_id = auth.uid()
    -- You cannot report your own post; use delete instead.
    and reported_user_id is distinct from auth.uid()
  );
create policy "read own reports" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

-- streaks
create policy "streaks readable" on public.streaks
  for select to authenticated using (true);
create policy "upsert own streak" on public.streaks
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own streak" on public.streaks
  for update to authenticated using (user_id = auth.uid());

-- ================================================================ storage
-- Photo bucket: public read, users write into their own folder.
insert into storage.buckets (id, name, public) values ('photos', 'photos', true);

create policy "photos public read" on storage.objects
  for select using (bucket_id = 'photos');
create policy "upload own photos" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "delete own photos" on storage.objects
  for delete to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
