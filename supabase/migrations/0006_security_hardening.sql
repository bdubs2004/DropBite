-- nibl security hardening
--
-- Run this if your database predates it; a fresh schema.sql already includes
-- everything here. Safe to run more than once.
--
-- If a constraint fails, you have existing rows that violate the new bound.
-- Find them (e.g. select id from public.users where char_length(bio) > 300),
-- fix or delete them, then re-run.

-- ------------------------------------------------------------ 1. bounds
alter table public.users
  drop constraint if exists users_display_name_len,
  add  constraint users_display_name_len check (char_length(display_name) between 1 and 50),
  drop constraint if exists users_bio_len,
  add  constraint users_bio_len check (bio is null or char_length(bio) <= 300),
  drop constraint if exists users_avatar_emoji_len,
  add  constraint users_avatar_emoji_len check (avatar_emoji is null or char_length(avatar_emoji) <= 8),
  drop constraint if exists users_timezone_len,
  add  constraint users_timezone_len check (char_length(timezone) <= 64),
  -- Length is checked outside the pattern: Postgres caps regex repetition at
  -- 255, so {1,500} inside the pattern fails at runtime.
  drop constraint if exists users_avatar_url_https,
  add  constraint users_avatar_url_https check (
    avatar_url is null or (avatar_url ~ '^https://[^\s]+$' and char_length(avatar_url) <= 500)
  );

alter table public.posts
  drop constraint if exists posts_photo_url_https,
  add  constraint posts_photo_url_https check (
    photo_url ~ '^https://[^\s]+$' and char_length(photo_url) <= 1000
  ),
  drop constraint if exists posts_blurb_len,
  add  constraint posts_blurb_len check (char_length(blurb) <= 2000),
  drop constraint if exists posts_place_id_len,
  add  constraint posts_place_id_len check (restaurant_place_id is null or char_length(restaurant_place_id) <= 255),
  drop constraint if exists posts_restaurant_name_len,
  add  constraint posts_restaurant_name_len check (restaurant_name is null or char_length(restaurant_name) <= 200),
  drop constraint if exists posts_lat_range,
  add  constraint posts_lat_range check (lat is null or lat between -90 and 90),
  drop constraint if exists posts_lng_range,
  add  constraint posts_lng_range check (lng is null or lng between -180 and 180);

alter table public.recipes
  drop constraint if exists recipes_title_len,
  add  constraint recipes_title_len check (char_length(title) between 1 and 120),
  drop constraint if exists recipes_ingredients_bounded,
  add  constraint recipes_ingredients_bounded check (
    jsonb_typeof(ingredients) = 'array'
    and jsonb_array_length(ingredients) <= 50
    and pg_column_size(ingredients) <= 16384
  ),
  drop constraint if exists recipes_steps_bounded,
  add  constraint recipes_steps_bounded check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) <= 50
    and pg_column_size(steps) <= 16384
  ),
  drop constraint if exists recipes_cook_time_range,
  add  constraint recipes_cook_time_range check (cook_time_minutes is null or cook_time_minutes between 0 and 6000);

alter table public.reactions
  drop constraint if exists reactions_type_allowed,
  add  constraint reactions_type_allowed check (type in ('like'));

alter table public.streaks
  drop constraint if exists streaks_current_range,
  add  constraint streaks_current_range check (current_streak between 0 and 36500),
  drop constraint if exists streaks_longest_range,
  add  constraint streaks_longest_range check (longest_streak between 0 and 36500),
  drop constraint if exists streaks_last_post_not_future,
  add  constraint streaks_last_post_not_future check (
    last_post_date is null or last_post_date <= (now() at time zone 'utc')::date + 1
  ),
  drop constraint if exists streaks_longest_gte_current,
  add  constraint streaks_longest_gte_current check (longest_streak >= current_streak);

-- --------------------------------------------- 2. private follower lists
-- Previously `follows` was readable by every signed-in user, so the private
-- follower list setting was cosmetic: anyone could query the table directly.
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

-- Counts stay public (the UI promises "counts visible, names hidden"), so they
-- come from a SECURITY DEFINER function that reads past the policy above.
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

revoke all on function public.follow_counts(uuid) from public;
grant execute on function public.follow_counts(uuid) to authenticated;

-- ------------------------------------- 3. explicit WITH CHECK on UPDATE
-- Validates the NEW row, not just the row being replaced.
drop policy if exists "update own profile" on public.users;
create policy "update own profile" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "update own posts" on public.posts;
create policy "update own posts" on public.posts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "update own share" on public.shares;
create policy "update own share" on public.shares
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "update own streak" on public.streaks;
create policy "update own streak" on public.streaks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --------------------------------------------------- 4. comment moderation
drop policy if exists "delete own comment" on public.comments;
drop policy if exists "delete own comment or on own post" on public.comments;
create policy "delete own comment or on own post" on public.comments
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );

-- ------------------------------------------------------------- 5. storage
-- The photos bucket accepted ANY file type at ANY size. An HTML or SVG upload
-- to a public CDN origin is stored XSS; unbounded size is a bandwidth bill.
update storage.buckets
set file_size_limit = 10485760,                    -- 10 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'photos';

drop policy if exists "update own photos" on storage.objects;
create policy "update own photos" on storage.objects
  for update to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------- 6. AI usage rate limiting
-- Backs the per-user daily cap in the format-recipe edge function. RLS on with
-- no policies denies the client everything; the revoke is belt-and-braces
-- because Supabase grants to anon/authenticated by default.
create table if not exists public.ai_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on table public.ai_usage from anon, authenticated;

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

revoke all on function public.consume_ai_quota(uuid, integer) from public;
