-- 0040: What a dish cost to make: $, $$ or $$$.
--
-- A post can say how much it cost (optional), picked when posting, and Search
-- filters on it ("budget meals" finds the $ ones). It replaces the four price
-- hashtags 0039 started with (#budget, #cheapeats, #splurge, #expensive):
-- price is one answer per post, not a tag, so it has a column of its own.
--
--   1. posts.price_level: 1 ($), 2 ($$) or 3 ($$$); null when not given.
--   2. Posts that already carried a price hashtag get the matching level
--      (#budget and #cheapeats are $, #splurge and #expensive are $$$), and
--      the tag comes off; the tags are taken off the list.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. The column ---------------------------------------------------------------------------------
alter table public.posts add column if not exists price_level smallint;
alter table public.posts drop constraint if exists posts_price_level_range;
alter table public.posts
  add constraint posts_price_level_range check (price_level between 1 and 3) not valid;
do $$
begin
  alter table public.posts validate constraint posts_price_level_range;
exception when check_violation then
  raise warning 'Rule "posts_price_level_range" holds for new posts; some older ones don''t meet it.';
end
$$;
create index if not exists posts_price_level_idx on public.posts (price_level)
  where price_level is not null;

-- 2. Price hashtags become price levels ---------------------------------------------------------
update public.posts
set price_level = coalesce(price_level,
      case when hashtags && '{budget,cheapeats}' then 1 else 3 end),
    hashtags = array(select t from unnest(hashtags) with ordinality u(t, n)
                     where t not in ('budget', 'cheapeats', 'splurge', 'expensive')
                     order by n)
where hashtags && '{budget,cheapeats,splurge,expensive}';

delete from public.hashtags where tag in ('budget', 'cheapeats', 'splurge', 'expensive');
-- Close the gap they left in the list's order (0039's list is the same).
update public.hashtags h set position = o.n
from (select tag, row_number() over (order by position, tag) as n from public.hashtags) o
where o.tag = h.tag and h.position <> o.n;
