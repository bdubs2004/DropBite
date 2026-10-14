-- 0037: Clear out what very old databases still carry.
--
-- A database first set up from an early schema.sql and brought forward with
-- the migrations ends up almost exactly like a fresh install, but not quite:
--
--   1. The early setup let people change their own files in the photos bucket
--      ("update own photos"). Nothing removed that policy, so on those
--      databases a signed-in user could still replace their own stored photo
--      directly, skipping upload-photo's checks (real JPEG, metadata stripped).
--      Since 0031 only the server writes files: any INSERT or UPDATE policy on
--      the app's buckets is removed, whatever it's called.
--   2. Comment text: same rule, written differently. Made identical to a fresh
--      install (text never null, at most 2,000 characters, and a comment needs
--      text or a photo).
--
-- Safe to run more than once, and does nothing on a fresh install. Already
-- folded into schema.sql.

-- 1. No client writes to the photo buckets ------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select pol.polname
    from pg_policy pol
    where pol.polrelid = 'storage.objects'::regclass
      and pol.polcmd in ('a', 'w', '*')
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ~ '''(dm-)?photos'''
           or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ '''(dm-)?photos''')
  loop
    execute format('drop policy %I on storage.objects', p.polname);
    raise notice 'Removed storage policy "%" (only the server uploads photos).', p.polname;
  end loop;
end
$$;

-- 2. Comment text, as on a fresh install ------------------------------------------------------
update public.comments set text = '' where text is null;
alter table public.comments alter column text set default '';
alter table public.comments alter column text set not null;
alter table public.comments drop constraint if exists comments_not_empty;
alter table public.comments
  add constraint comments_not_empty check (char_length(text) > 0 or image_url is not null) not valid;
alter table public.comments drop constraint if exists comments_text_check;
alter table public.comments
  add constraint comments_text_check check (char_length(text) <= 2000) not valid;
