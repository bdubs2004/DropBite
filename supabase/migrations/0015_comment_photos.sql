-- Photos in comments: reply to a post with a picture (e.g. the apple pie you
-- actually baked). Same storage + https rules as message/post photos.
alter table public.comments add column if not exists image_url text;

-- A comment may now be text, a photo, or both — so text is no longer required.
-- Drop the old "text length 1..2000" check (whatever its generated name is) and
-- replace it with rules that permit an empty caption when there is an image.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.comments'::regclass and contype = 'c'
  loop
    execute format('alter table public.comments drop constraint %I', c);
  end loop;
end $$;

alter table public.comments alter column text drop not null;
alter table public.comments alter column text set default '';

alter table public.comments
  add constraint comments_image_url_https check (
    image_url is null or (image_url ~ '^https://[^\s]+$' and char_length(image_url) <= 1000)
  );

alter table public.comments
  add constraint comments_not_empty check (
    char_length(coalesce(text, '')) <= 2000
    and (char_length(coalesce(text, '')) > 0 or image_url is not null)
  );
