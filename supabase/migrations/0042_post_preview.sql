-- 0042: A fuller preview behind a shared post link.
--
-- niblgo.com/post/<id> renders a card for whoever opens a shared link, signed
-- in or not (0018). It now also shows the poster's photo, when it was posted,
-- what it cost, its hashtags, and the recipe's title and time as a teaser.
-- That is still only what anyone signed in already sees on the post, and still
-- one post looked up by the exact id the link handed over: no listing, no
-- email, nothing about the person who opened it.
--
-- The returned columns change, which `create or replace` can't do, so the
-- function is dropped and created again (in one transaction, so there is no
-- moment without it). Safe to run more than once. Already folded into
-- schema.sql.

drop function if exists public.get_post_preview(uuid);
create function public.get_post_preview(pid uuid)
returns table (
  photo_url text,
  blurb text,
  display_name text,
  handle text,
  meal_slot text,
  avatar_url text,
  created_at timestamptz,
  price_level smallint,
  hashtags text[],
  recipe_title text,
  cook_time_minutes integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.photo_url, p.blurb, u.display_name, u.handle, p.meal_slot::text,
         u.avatar_url, p.created_at, p.price_level, p.hashtags,
         r.title, r.cook_time_minutes
  from public.posts p
  join public.users u on u.id = p.user_id
  left join public.recipes r on r.post_id = p.id
  where p.id = pid
  limit 1;
$$;

revoke all on function public.get_post_preview(uuid) from public;
grant execute on function public.get_post_preview(uuid) to anon, authenticated;
