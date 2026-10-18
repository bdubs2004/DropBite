-- 0039: Hashtags on posts.
--
-- A post can carry up to 5 hashtags (#mexican, #vegan, #healthy) so dishes
-- are easy to find in Search. They come from a fixed list, like TikTok's
-- suggested tags, rather than being typed freely: every tag is one people
-- search for, nobody splits one three ways (#bbq, #BBQ, #barbecue), and
-- nothing offensive can be printed under a post.
--
--   1. public.hashtags is the list (tag, group, order). Signed-in users can
--      read it; only migrations change it. The app ships the same list
--      (src/lib/hashtags.ts) and a test checks the two match.
--   2. posts.hashtags holds a post's tags, in the order they were picked.
--      Older posts simply have none.
--   3. A trigger refuses tags that aren't on the list, repeats, and more than
--      5, however the post was written. It only looks at the tags when they
--      change, so taking a tag off the list never blocks editing an old post.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. The list ----------------------------------------------------------------------------------
create table if not exists public.hashtags (
  tag text primary key constraint hashtags_tag_format check (tag ~ '^[a-z0-9]{2,30}$'),
  category text not null constraint hashtags_category_len check (char_length(category) <= 30),
  position integer not null default 0
);
alter table public.hashtags enable row level security;
drop policy if exists "hashtags readable" on public.hashtags;
create policy "hashtags readable" on public.hashtags
  for select to authenticated using (true);
revoke insert, update, delete on public.hashtags from anon, authenticated;

-- Exactly this list: a tag taken off it can't be picked any more.
with list(tag, category, position) as (values
  ('american', 'cuisine', 1),
  ('bbq', 'cuisine', 2),
  ('cajun', 'cuisine', 3),
  ('caribbean', 'cuisine', 4),
  ('chinese', 'cuisine', 5),
  ('french', 'cuisine', 6),
  ('greek', 'cuisine', 7),
  ('indian', 'cuisine', 8),
  ('italian', 'cuisine', 9),
  ('japanese', 'cuisine', 10),
  ('korean', 'cuisine', 11),
  ('mediterranean', 'cuisine', 12),
  ('mexican', 'cuisine', 13),
  ('middleeastern', 'cuisine', 14),
  ('soulfood', 'cuisine', 15),
  ('southern', 'cuisine', 16),
  ('spanish', 'cuisine', 17),
  ('thai', 'cuisine', 18),
  ('vietnamese', 'cuisine', 19),
  ('healthy', 'diet', 20),
  ('highprotein', 'diet', 21),
  ('lowcarb', 'diet', 22),
  ('keto', 'diet', 23),
  ('vegan', 'diet', 24),
  ('vegetarian', 'diet', 25),
  ('pescatarian', 'diet', 26),
  ('glutenfree', 'diet', 27),
  ('dairyfree', 'diet', 28),
  ('homemade', 'cooking', 29),
  ('takeout', 'cooking', 30),
  ('mealprep', 'cooking', 31),
  ('quickandeasy', 'cooking', 32),
  ('onepot', 'cooking', 33),
  ('airfryer', 'cooking', 34),
  ('slowcooker', 'cooking', 35),
  ('grilled', 'cooking', 36),
  ('baked', 'cooking', 37),
  ('streetfood', 'cooking', 38),
  ('comfortfood', 'vibe', 39),
  ('spicy', 'vibe', 40),
  ('sweettooth', 'vibe', 41),
  ('dessert', 'vibe', 42),
  ('seafood', 'vibe', 43),
  ('brunch', 'vibe', 44),
  ('datenight', 'vibe', 45),
  ('latenight', 'vibe', 46),
  ('gameday', 'vibe', 47),
  ('familydinner', 'vibe', 48),
  ('leftovers', 'vibe', 49)
),
saved as (
  insert into public.hashtags (tag, category, position)
  select tag, category, position from list
  on conflict (tag) do update set category = excluded.category, position = excluded.position
  returning tag
)
delete from public.hashtags h where not exists (select 1 from list l where l.tag = h.tag);

-- 2. A post's tags -----------------------------------------------------------------------------
alter table public.posts add column if not exists hashtags text[] not null default '{}';
alter table public.posts drop constraint if exists posts_hashtags_count;
alter table public.posts
  add constraint posts_hashtags_count check (cardinality(hashtags) <= 5) not valid;
do $$
begin
  alter table public.posts validate constraint posts_hashtags_count;
exception when check_violation then
  raise warning 'Rule "posts_hashtags_count" holds for new posts; some older ones don''t meet it.';
end
$$;
-- Search asks "which posts carry #mexican?": a GIN index answers that.
create index if not exists posts_hashtags_idx on public.posts using gin (hashtags);

-- 3. Only tags from the list -------------------------------------------------------------------
create or replace function public.check_post_hashtags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hashtags is null then
    new.hashtags := '{}';
  end if;
  if cardinality(new.hashtags) > 5 then
    raise exception 'A post can have up to 5 hashtags.' using errcode = '23514';
  end if;
  if (select count(distinct t) from unnest(new.hashtags) t) <> cardinality(new.hashtags) then
    raise exception 'Each hashtag can only be added once.' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(new.hashtags) t
    where not exists (select 1 from public.hashtags h where h.tag = t)
  ) then
    raise exception 'Pick hashtags from the list.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_post_hashtags() from public, anon, authenticated;

drop trigger if exists posts_check_hashtags on public.posts;
create trigger posts_check_hashtags before insert or update of hashtags on public.posts
  for each row execute function public.check_post_hashtags();
