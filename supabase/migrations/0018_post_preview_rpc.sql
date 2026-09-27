-- Public preview for a shared post link.
--
-- When someone shares a post out of the app, the link (niblgo.com/post/<id>)
-- is opened by a small web page that needs to show a rich preview card: the
-- photo, the caption and who posted it. That page runs before anyone signs in,
-- so it has no session — it reads through this SECURITY DEFINER function with
-- the public anon key.
--
-- It returns ONLY the handful of fields a preview card shows, for one post
-- looked up by its (unguessable) UUID. No feed, no listing, no way to
-- enumerate: you can only see a post whose exact id you were already given,
-- which is precisely what sharing the link hands over on purpose.
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
