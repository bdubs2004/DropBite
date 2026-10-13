-- Photo storage, locked down before outside testing. Proven by
-- supabase/tests/rls_attack_test.sql (sections 13-16) and the upload-photo tests.
--
--   1. Uploads only go through the upload-photo edge function, which reads the
--      bytes (not the client's Content-Type or file name), accepts only real
--      JPEGs, strips EXIF/GPS and other metadata, and picks the bucket, folder
--      and a random name itself. Clients can no longer write to storage at all.
--   2. DM photos move to their own PRIVATE bucket, dm-photos, under the
--      conversation's folder. Only people in that chat can read them, through
--      short-lived signed links. (They used to sit in the public bucket, where
--      anyone holding a link could open them.)
--   3. A photo link saved on a post, avatar, comment or message must be a real
--      upload: this project's storage, the poster's own folder (or, for a DM
--      photo, that chat's folder), a file that exists. Before this, a post or
--      avatar could point at someone else's photo or at any https server, which
--      could log the IP address of everyone who looked at it.
--   4. Orphaned files (from deleted posts, comments, messages, old avatars and
--      deleted accounts) are found by storage_orphans() and removed by the
--      sweep-storage edge function. Files that are evidence in an open report
--      are kept until the report is closed.
--   5. Uploads are capped per user per hour (consume_upload_quota).
--
-- Deploy upload-photo and sweep-storage with this, and ship the app build that
-- uses them: older builds upload straight to storage and will be refused.
-- Safe to run more than once.

-- Settings the database needs to know about this project -----------------------------
-- Only public values belong here (signed-in users can read them). The storage
-- origin is recorded by upload-photo the first time it stores a photo.
create table if not exists public.app_config (
  key text primary key constraint app_config_key_len check (char_length(key) <= 64),
  value text not null constraint app_config_value_len check (char_length(value) <= 500)
);
alter table public.app_config enable row level security;
drop policy if exists "settings readable" on public.app_config;
create policy "settings readable" on public.app_config
  for select to authenticated using (true);
revoke insert, update, delete on public.app_config from anon, authenticated;

-- 1 + 2. Buckets and who can touch them --------------------------------------------------
-- Every photo the app makes is a JPEG (upload-photo checks the bytes too).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm-photos', 'dm-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No client uploads: only upload-photo (service role) writes files.
drop policy if exists "upload own photos" on storage.objects;

-- DM photos: readable (and so signable) only by people in that chat. Folders
-- are conversation ids; anything else is simply not readable.
drop policy if exists "read photos in own chats" on storage.objects;
create policy "read photos in own chats" on storage.objects
  for select to authenticated using (
    bucket_id = 'dm-photos'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid())
      else false
    end
  );

-- 2. Messages carry a DM photo by its private path -----------------------------------
alter table public.messages add column if not exists image_path text;
alter table public.messages drop constraint if exists messages_image_path_format;
alter table public.messages
  add constraint messages_image_path_format check (
    image_path is null
    or image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.jpg$'
  );

create or replace function public.message_not_empty()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'message'
     and char_length(new.text) = 0
     and new.shared_post_id is null
     and new.image_url is null
     and new.image_path is null
     and new.shared_user_id is null then
    raise exception 'A message must carry something' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.message_not_empty() from public, anon, authenticated;

-- 3. Photo links must be real uploads, in your own space --------------------------------
-- SECURITY INVOKER on purpose: it looks the file up with the caller's own
-- storage access (their own folder; for DM photos, chats they're in).
create or replace function public.check_photo_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prefix text;
  link text;
  prev text;
  rest text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'messages' then
    -- New DM photos travel by private path, never as a public link.
    if tg_op = 'INSERT' and new.image_url is not null then
      raise exception 'Send photos with the app.' using errcode = '42501';
    end if;
    if new.image_path is not null
       and (tg_op = 'INSERT' or new.image_path is distinct from old.image_path) then
      if split_part(new.image_path, '/', 1) <> new.conversation_id::text
         or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'dm-photos' and o.name = new.image_path
         ) then
        raise exception 'That photo is not in this chat.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'posts' then
    link := new.photo_url;
    if tg_op = 'UPDATE' then prev := old.photo_url; end if;
  elsif tg_table_name = 'users' then
    link := new.avatar_url;
    if tg_op = 'UPDATE' then prev := old.avatar_url; end if;
  elsif tg_table_name = 'comments' then
    link := new.image_url;
    if tg_op = 'UPDATE' then prev := old.image_url; end if;
  end if;

  -- Unchanged links (older posts being edited) are left alone.
  if link is null or (tg_op = 'UPDATE' and link is not distinct from prev) then
    return new;
  end if;

  prefix := (select c.value from public.app_config c where c.key = 'storage_origin')
            || '/storage/v1/object/public/photos/' || auth.uid()::text || '/';
  rest := case when prefix is not null and left(link, length(prefix)) = prefix
               then substr(link, length(prefix) + 1) end;
  if rest is null
     or rest !~ '^[0-9a-f]{32}\.jpg$'
     or not exists (
       select 1 from storage.objects o
       where o.bucket_id = 'photos' and o.name = auth.uid()::text || '/' || rest
     ) then
    raise exception 'Upload photos with the app.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.check_photo_links() from public, anon, authenticated;

drop trigger if exists posts_check_photo_links on public.posts;
create trigger posts_check_photo_links before insert or update on public.posts
  for each row execute function public.check_photo_links();
drop trigger if exists users_check_photo_links on public.users;
create trigger users_check_photo_links before insert or update on public.users
  for each row execute function public.check_photo_links();
drop trigger if exists comments_check_photo_links on public.comments;
create trigger comments_check_photo_links before insert or update on public.comments
  for each row execute function public.check_photo_links();
drop trigger if exists messages_check_photo_links on public.messages;
create trigger messages_check_photo_links before insert or update on public.messages
  for each row execute function public.check_photo_links();

-- Reports keep a reported DM photo's private path as evidence.
create or replace function public.prepare_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.status := 'open';
  new.reviewed_at := null;
  new.reviewer_notes := null;
  new.post_blurb_snapshot := null;
  new.post_photo_url_snapshot := null;
  new.message_text_snapshot := null;
  new.message_image_url_snapshot := null;
  new.comment_text_snapshot := null;

  if (new.post_id is not null)::int + (new.comment_id is not null)::int
     + (new.message_id is not null)::int > 1 then
    raise exception 'Report one thing at a time.' using errcode = '22023';
  end if;

  if new.post_id is not null then
    select p.user_id, p.blurb, p.photo_url
      into new.reported_user_id, new.post_blurb_snapshot, new.post_photo_url_snapshot
      from public.posts p where p.id = new.post_id;
    if not found then
      raise exception 'That post is not available to report.' using errcode = '42501';
    end if;
  elsif new.comment_id is not null then
    select c.user_id, nullif(c.text, '')
      into new.reported_user_id, new.comment_text_snapshot
      from public.comments c where c.id = new.comment_id;
    if not found then
      raise exception 'That comment is not available to report.' using errcode = '42501';
    end if;
  elsif new.message_id is not null then
    select m.sender_id, nullif(m.text, ''),
           coalesce(m.image_url, 'dm-photos/' || m.image_path)
      into new.reported_user_id, new.message_text_snapshot, new.message_image_url_snapshot
      from public.messages m where m.id = new.message_id;
    if not found then
      raise exception 'That message is not available to report.' using errcode = '42501';
    end if;
  end if;
  -- An account report names the person directly; it has to be a real one.
  if new.reported_user_id is null
     or not exists (select 1 from public.users u where u.id = new.reported_user_id) then
    raise exception 'Nothing to report.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_report() from public, anon, authenticated;

-- 4. Orphaned files ------------------------------------------------------------------------
-- Files in either bucket that nothing points at any more and are older than
-- `grace` (so a photo uploaded a moment before its post is saved isn't
-- caught). Evidence in an open report counts as in use. Server only: the
-- sweep-storage function calls it, then deletes through the Storage API
-- (deleting rows here would leave the actual files behind).
create or replace function public.storage_orphans(grace interval, only_bucket text default null)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with photo_links(u) as (
    select photo_url from public.posts
    union all select avatar_url from public.users
    union all select image_url from public.comments
    union all select image_url from public.messages
    union all select post_photo_url_snapshot from public.reports where status in ('open', 'reviewing')
    union all select message_image_url_snapshot from public.reports where status in ('open', 'reviewing')
  ),
  used(bucket, name) as (
    select 'photos', substring(u from '/storage/v1/object/public/photos/(.+)$')
      from photo_links where u is not null
    union all
    select 'dm-photos', image_path from public.messages where image_path is not null
    union all
    select 'dm-photos', substring(message_image_url_snapshot from '^dm-photos/(.+)$')
      from public.reports
      where status in ('open', 'reviewing') and message_image_url_snapshot like 'dm-photos/%'
  )
  select o.bucket_id || '/' || o.name
  from storage.objects o
  where o.bucket_id in ('photos', 'dm-photos')
    and (only_bucket is null or o.bucket_id = only_bucket)
    and o.created_at < now() - grace
    and o.name not like '%.emptyFolderPlaceholder'
    and not exists (select 1 from used x where x.bucket = o.bucket_id and x.name = o.name)
  order by 1;
$$;
revoke all on function public.storage_orphans(interval, text) from public, anon, authenticated;
grant execute on function public.storage_orphans(interval, text) to service_role;

-- 5. Upload cap -----------------------------------------------------------------------------
create table if not exists public.upload_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  hour timestamptz not null,
  count integer not null default 0,
  primary key (user_id, hour)
);
alter table public.upload_usage enable row level security;
revoke all on table public.upload_usage from anon, authenticated;

create or replace function public.consume_upload_quota(target uuid, hourly_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  insert into public.upload_usage (user_id, hour, count)
  values (target, date_trunc('hour', now()), 1)
  on conflict (user_id, hour)
    do update set count = public.upload_usage.count + 1
  returning count into used;
  -- Old hours are no use to anyone.
  delete from public.upload_usage
  where user_id = target and hour < date_trunc('hour', now()) - interval '1 day';
  return used <= hourly_limit;
end;
$$;
revoke all on function public.consume_upload_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_upload_quota(uuid, integer) to service_role;
