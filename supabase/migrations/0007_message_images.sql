-- NiblGo: photo attachments in direct messages
--
-- Run this if your database predates DM photos. A fresh `schema.sql` already
-- includes it. Safe to run more than once.

alter table public.messages
  add column if not exists image_url text;

alter table public.messages
  drop constraint if exists messages_image_url_https,
  add  constraint messages_image_url_https check (
    image_url is null or (image_url ~ '^https://[^\s]+$' and char_length(image_url) <= 1000)
  );

-- The original CHECK required text or a shared post; a photo-only message is
-- now valid too. The old constraint was unnamed, so drop it by its generated
-- name before adding the replacement.
alter table public.messages drop constraint if exists messages_check;
alter table public.messages
  drop constraint if exists messages_not_empty,
  add  constraint messages_not_empty check (
    char_length(text) > 0 or shared_post_id is not null or image_url is not null
  );
