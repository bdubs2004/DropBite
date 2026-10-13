-- Security pass before outside testing. Every change below closes something
-- supabase/tests/rls_attack_test.sql proved possible with a normal account.
--
--   1. DMs: a member could move their own membership row into ANY thread
--      (update conversation_members set conversation_id = ...) and read its
--      whole history. Members can now only change mute and last-read.
--      Raw conversation / membership inserts are gone too: chats only start
--      through start_conversation() / start_group_conversation(), which check
--      follows and blocks. Members can rename and bump a thread, nothing else.
--   2. The RLS helper functions answered questions about other people:
--      "did Alice block Eve?", "is Alice in this thread?", "who does this
--      private account follow?". They now only answer about the caller, and
--      the two that no policy needs any more can't be called at all.
--   3. Dates were the client's to choose: a post dated 2099 sat at the top of
--      every feed forever, messages and comments could be backdated, and a
--      thread could be pinned to the top of someone's inbox. created_at (and a
--      thread's updated_at) is now always the server's clock.
--   4. Streaks were written by the app, so anyone could give themselves a
--      999-day streak and top the leaderboard. The database now keeps them,
--      from posts, and the app can't write them.
--   5. Blocked people could still comment on and like the blocker's posts by
--      id, read what the blocker liked, and read the blocker's recipes. Likes,
--      comments, saves and the rest now need the post to be visible to you,
--      and replies must sit under a comment on the same post.
--   6. Reports trusted the client for who and what was reported, and could be
--      filed already "actioned". The database now fills in the evidence and
--      the reported person from the real rows (and refuses anything you can't
--      see), and every new report starts "open". Same for feedback.
--   7. Profiles: only the fields the app edits can change (not your id,
--      creation date or timezone). Notifications: only read/unread.
--   8. Photo storage: anyone, signed in or not, could LIST every file in the
--      bucket, DM photos included. Listing is now limited to your own folder.
--      (Public photo links keep working; the bucket is still public.)
--
-- Safe to run more than once.

-- 1. Helper functions only answer about the caller ------------------------------
-- auth.uid() is null only for trusted callers (the dashboard, the service
-- role, server-side triggers); anon can't execute these at all.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or auth.uid() = a or auth.uid() = b)
    and exists (
      select 1 from public.blocks x
      where (x.blocker_id = a and x.blocked_id = b)
         or (x.blocker_id = b and x.blocked_id = a)
    );
$$;

create or replace function public.is_conversation_member(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Only about the caller, like is_blocked_pair.
  select (auth.uid() is null or auth.uid() = who)
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conv and m.user_id = who
    );
$$;

create or replace function public.conversation_has_block(conv uuid, who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Only about the caller, like is_blocked_pair.
  select (auth.uid() is null or auth.uid() = who)
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conv
        and m.user_id <> who
        and public.is_blocked_pair(m.user_id, who)
    );
$$;

-- No policy uses these any more (see 2 below), so nobody needs to call them.
revoke all on function public.is_following(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conversation_is_empty(uuid) from public, anon, authenticated;

-- 2. DMs ------------------------------------------------------------------------
drop policy if exists "create conversations" on public.conversations;
drop policy if exists "join conversations" on public.conversation_members;

-- Members may change only these columns. Everything else about a membership
-- (which thread, whose) is fixed.
revoke update on public.conversation_members from anon, authenticated;
grant update (last_read_at, muted) on public.conversation_members to authenticated;
revoke update on public.conversations from anon, authenticated;
grant update (title, updated_at) on public.conversations to authenticated;

-- A shared post must be one you can see.
drop policy if exists "send messages as self" on public.messages;
create policy "send messages as self" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and kind = 'message'
    and public.is_conversation_member(conversation_id, auth.uid())
    and not public.conversation_has_block(conversation_id, auth.uid())
    and (shared_post_id is null or exists (select 1 from public.posts p where p.id = shared_post_id))
  );

-- 3. The server's clock ------------------------------------------------------------
-- For the app's own requests only: the dashboard, the service role and
-- server-side functions keep whatever they set. The column is named by the
-- trigger's argument (created_at unless said otherwise).
create or replace function public.stamp_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text := coalesce(tg_argv[0], 'created_at');
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new := jsonb_populate_record(new, jsonb_build_object(col, now()));
    else
      new := jsonb_populate_record(new, jsonb_build_object(col, to_jsonb(old) -> col));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_created_at() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'follows', 'posts', 'recipes', 'reactions', 'comments', 'reposts',
    'shares', 'saved_posts', 'blocks', 'conversations', 'collections', 'messages',
    'comment_reactions', 'reports', 'feedback', 'post_tags', 'message_reactions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp_created_at', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.stamp_created_at()',
      t || '_stamp_created_at', t);
  end loop;
end $$;
drop trigger if exists collection_posts_stamp_added_at on public.collection_posts;
create trigger collection_posts_stamp_added_at before insert or update on public.collection_posts
  for each row execute function public.stamp_created_at('added_at');

-- A thread's "last activity" is always now, so nobody can pin a thread to
-- the top of someone else's inbox.
create or replace function public.stamp_conversation_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_conversation_activity() from public, anon, authenticated;
drop trigger if exists conversations_stamp_activity on public.conversations;
create trigger conversations_stamp_activity before update on public.conversations
  for each row execute function public.stamp_conversation_activity();

-- 4. Streaks are kept by the database ------------------------------------------------
-- One more day when you post on the day after your last posting day, in your
-- own timezone; back to 1 after a gap; unchanged for a second post the same day.
create or replace function public.bump_streak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz text;
  today date;
  s public.streaks%rowtype;
begin
  select u.timezone into tz from public.users u where u.id = new.user_id;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then
    tz := 'UTC';
  end if;
  today := (now() at time zone tz)::date;

  select * into s from public.streaks where user_id = new.user_id for update;
  if not found then
    insert into public.streaks (user_id, current_streak, longest_streak, last_post_date)
    values (new.user_id, 1, 1, today)
    on conflict (user_id) do nothing;
  elsif s.last_post_date is null or s.last_post_date < today - 1 then
    update public.streaks
      set current_streak = 1, longest_streak = greatest(longest_streak, 1), last_post_date = today
      where user_id = new.user_id;
  elsif s.last_post_date = today - 1 then
    update public.streaks
      set current_streak = current_streak + 1,
          longest_streak = greatest(longest_streak, current_streak + 1),
          last_post_date = today
      where user_id = new.user_id;
  end if;
  -- Same day (or a date ahead of today): nothing to add.
  return new;
end;
$$;
revoke all on function public.bump_streak() from public, anon, authenticated;
drop trigger if exists posts_bump_streak on public.posts;
create trigger posts_bump_streak after insert on public.posts
  for each row execute function public.bump_streak();

drop policy if exists "upsert own streak" on public.streaks;
drop policy if exists "update own streak" on public.streaks;
revoke insert, update, delete on public.streaks from anon, authenticated;

-- 5. Interactions need the post (or comment) to be visible to you --------------------
-- The subqueries run under the caller's own RLS, so a post hidden by a block
-- is simply not there.
-- Can the caller reply under this comment? It has to be a top-level comment
-- on the same post, by someone the caller isn't blocked with. A function
-- because a policy on comments can't query comments itself (Postgres refuses
-- the recursion).
create or replace function public.can_reply_under(parent uuid, post uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
    where c.id = parent
      and c.post_id = post
      and c.parent_id is null
      and not public.is_blocked_pair(c.user_id, auth.uid())
  );
$$;
revoke all on function public.can_reply_under(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_reply_under(uuid, uuid) to authenticated;

drop policy if exists "comment as self" on public.comments;
create policy "comment as self" on public.comments
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
    -- A reply sits under a top-level comment on the same post.
    and (parent_id is null or public.can_reply_under(parent_id, post_id))
  );
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments
  for select to authenticated using (
    not public.is_blocked_pair(user_id, auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "react as self" on public.reactions;
create policy "react as self" on public.reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id <> auth.uid())
  );
drop policy if exists "reactions readable" on public.reactions;
create policy "reactions readable" on public.reactions
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));

drop policy if exists "repost as self" on public.reposts;
create policy "repost as self" on public.reposts
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "reposts readable" on public.reposts;
create policy "reposts readable" on public.reposts
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));

drop policy if exists "share as self" on public.shares;
create policy "share as self" on public.shares
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "shares readable" on public.shares;
create policy "shares readable" on public.shares
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));

drop policy if exists "save as self" on public.saved_posts;
create policy "save as self" on public.saved_posts
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id)
  );

drop policy if exists "like comment as self" on public.comment_reactions;
create policy "like comment as self" on public.comment_reactions
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.comments c where c.id = comment_id)
  );
drop policy if exists "comment reactions readable" on public.comment_reactions;
create policy "comment reactions readable" on public.comment_reactions
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));

drop policy if exists "recipes readable" on public.recipes;
create policy "recipes readable" on public.recipes
  for select to authenticated using (
    exists (select 1 from public.posts p where p.id = post_id)
  );

-- 6. Reports and feedback: the database fills in the facts ------------------------------
-- SECURITY INVOKER on purpose: it reads the reported post / comment / message
-- with the reporter's own RLS, so you can only report what you can see, and a
-- report can't be used to read a DM you are not in.
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
    select m.sender_id, nullif(m.text, ''), m.image_url
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
drop trigger if exists reports_prepare on public.reports;
create trigger reports_prepare before insert on public.reports
  for each row execute function public.prepare_report();

create or replace function public.prepare_feedback()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.status := 'new';
    new.reviewed_at := null;
    new.reviewer_notes := null;
    new.handle_snapshot := (select u.handle from public.users u where u.id = auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_feedback() from public, anon, authenticated;
drop trigger if exists feedback_prepare on public.feedback;
create trigger feedback_prepare before insert on public.feedback
  for each row execute function public.prepare_feedback();

-- 7. Only the columns the app edits -----------------------------------------------------
revoke update on public.users from anon, authenticated;
grant update (display_name, bio, avatar_emoji, avatar_url, follows_private)
  on public.users to authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 8. Storage: list only your own folder ---------------------------------------------------
-- A public bucket serves its files by URL without this policy; it only
-- controls listing and reading through the API, which the app needs just for
-- its own files (deleting a photo looks it up first).
drop policy if exists "photos public read" on storage.objects;
drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects
  for select to authenticated using (
    bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
