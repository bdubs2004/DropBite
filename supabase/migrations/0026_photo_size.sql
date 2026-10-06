-- Keep the whole photo.
--
-- Photos are no longer cropped to a fixed shape when you take or pick them,
-- so the feed draws each one at its own shape (from 1.91:1 landscape up to a
-- 3:4 portrait). Storing the size lets the feed lay the post out at the right
-- height before the photo has loaded, so nothing jumps as you scroll. Older
-- posts have no size; the app measures those when they load.
--
-- Safe to run more than once.

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
