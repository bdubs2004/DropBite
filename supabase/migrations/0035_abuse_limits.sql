-- 0035: Spam limits, duplicate guards, and text that can't disguise who wrote it.
--
--   1. Rate limits. Nothing stopped a script from sending a thousand DMs a
--      minute, flooding a post with comments, or burying the report and
--      feedback queues. Every table people create rows in now counts each
--      person's app requests in a fixed window and refuses past the limit.
--      The server (service role) and the dashboard are never limited.
--   2. Duplicates. A double tap posted the same photo twice, or the same
--      comment twice.
--   3. Text. Direction-flipping and control characters can make a name read
--      as someone else's ("Alice" + U+202E ...), and a line break in a display
--      name can fake a second line like a badge. They're refused in names,
--      titles, posts, comments and messages. Emoji, including joined ones,
--      are fine.
--   4. Handles that look like staff ("admin", "support", anything with
--      "niblgo") can't be taken from the app.
--   5. push_tokens.platform was the one unbounded column clients could write.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. Rate limits ---------------------------------------------------------------------------
create table if not exists public.action_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, action, window_start)
);
alter table public.action_usage enable row level security;
revoke all on table public.action_usage from anon, authenticated;

-- Trigger arguments: action name, how many, per what interval.
create or replace function public.limit_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  who uuid;
  act text := tg_argv[0];
  max_n integer := tg_argv[1]::integer;
  win interval := tg_argv[2]::interval;
  started timestamptz;
  n integer;
begin
  -- Only requests from the app. The server and the dashboard pass.
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  begin
    who := (claims ->> 'sub')::uuid;
  exception when others then
    return new;
  end;
  if who is null or not exists (select 1 from public.users where id = who) then
    return new;
  end if;

  started := date_bin(win, now(), timestamptz '2000-01-01 00:00:00+00');
  insert into public.action_usage as a (user_id, action, window_start, count)
  values (who, act, started, 1)
  on conflict (user_id, action, window_start) do update set count = a.count + 1
  returning a.count into n;
  if n > max_n then
    raise exception 'You''re doing that too fast. Try again in a little while.'
      using errcode = 'P0001', hint = 'rate_limited:' || act;
  end if;
  -- Old windows are no use to anyone (cheap: same person and action).
  if n = 1 then
    delete from public.action_usage
    where user_id = who and action = act and window_start < now() - interval '2 days';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_rate() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('posts',             'post',          30,  '1 hour'),
      ('comments',          'comment',       20,  '5 minutes'),
      ('messages',          'message',       30,  '1 minute'),
      ('conversations',     'new_chat',      30,  '1 hour'),
      ('follows',           'follow',        60,  '1 hour'),
      ('reactions',         'like',          300, '1 hour'),
      ('comment_reactions', 'comment_like',  300, '1 hour'),
      ('message_reactions', 'message_react', 300, '1 hour'),
      ('reposts',           'repost',        100, '1 hour'),
      ('shares',            'share',         100, '1 hour'),
      ('post_tags',         'tag',           100, '1 hour'),
      ('collections',       'collection',    50,  '1 hour'),
      ('reports',           'report',        20,  '1 day'),
      ('feedback',          'feedback',      10,  '1 day')
    ) v(tbl, act, n, win)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_limit_rate', r.tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.limit_rate(%L, %L, %L)',
      r.tbl || '_limit_rate', r.tbl, r.act, r.n::text, r.win);
  end loop;
end
$$;

-- 2. Duplicates -----------------------------------------------------------------------------
create index if not exists posts_photo_url_idx on public.posts (photo_url);

create or replace function public.refuse_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  if coalesce(claims ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'posts' then
    -- Every upload has its own random name, so a photo is posted once.
    if exists (select 1 from public.posts p where p.photo_url = new.photo_url) then
      raise exception 'That photo is already posted.' using errcode = '23505';
    end if;
  elsif tg_table_name = 'comments' then
    if exists (
      select 1 from public.comments c
      where c.user_id = new.user_id and c.post_id = new.post_id
        and c.text = new.text
        and c.image_url is not distinct from new.image_url
        and c.created_at > now() - interval '1 minute'
    ) then
      raise exception 'You just posted that comment.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_duplicate() from public, anon, authenticated;

drop trigger if exists posts_refuse_duplicate on public.posts;
create trigger posts_refuse_duplicate before insert on public.posts
  for each row execute function public.refuse_duplicate();
drop trigger if exists comments_refuse_duplicate on public.comments;
create trigger comments_refuse_duplicate before insert on public.comments
  for each row execute function public.refuse_duplicate();

-- 3. Text that can't disguise who wrote it --------------------------------------------------
-- No control characters (bar line breaks and tabs where text may have lines)
-- and no direction overrides or isolates (U+202A-202E, U+2066-2069).
create or replace function public.plain_text_ok(t text, multiline boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t is null
      or (t !~ '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]'
          and (multiline or t !~ '[\n\r\t]'));
$$;
-- The checks run as whoever saves the row, so signed-in users can call it. It
-- reads nothing but its arguments.
revoke all on function public.plain_text_ok(text, boolean) from public, anon;
grant execute on function public.plain_text_ok(text, boolean) to authenticated, service_role;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('users',         'display_name', false),
      ('users',         'bio',          true),
      ('posts',         'blurb',        true),
      ('comments',      'text',         true),
      ('messages',      'text',         true),
      ('collections',   'name',         false),
      ('conversations', 'title',        false),
      ('recipes',       'title',        false)
    ) v(tbl, col, multi)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.tbl || '_' || r.col || '_plain');
    -- NOT VALID: new and edited text is checked; anything older stays as it is.
    execute format('alter table public.%I add constraint %I check (public.plain_text_ok(%I, %L)) not valid',
      r.tbl, r.tbl || '_' || r.col || '_plain', r.col, r.multi);
  end loop;
end
$$;

-- 4. Staff-looking handles ------------------------------------------------------------------
create or replace function public.handle_reserved(h text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(h) like '%niblgo%'
      or lower(h) in (
        'admin', 'admins', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
        'contact', 'official', 'moderator', 'moderators', 'mod', 'mods', 'staff', 'team',
        'security', 'safety', 'trust', 'abuse', 'legal', 'privacy', 'terms', 'api', 'www',
        'app', 'auth', 'login', 'signup', 'settings', 'about', 'null', 'undefined',
        'anonymous', 'everyone', 'here', 'feed', 'inbox', 'discover', 'search', 'streaks',
        'notifications', 'activity', 'post', 'posts', 'me', 'u');
$$;
revoke all on function public.handle_reserved(text) from public, anon, authenticated;

create or replace function public.refuse_reserved_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  -- From the app only: the team can still make an official account by hand.
  if coalesce(claims ->> 'role', '') = 'authenticated' and public.handle_reserved(new.handle) then
    -- 23505 (taken) so the app's sign-up picks a free variant, as it does for
    -- a handle someone else already has.
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.refuse_reserved_handle() from public, anon, authenticated;

drop trigger if exists users_refuse_reserved_handle on public.users;
create trigger users_refuse_reserved_handle before insert or update of handle on public.users
  for each row execute function public.refuse_reserved_handle();

-- 5. push_tokens.platform ---------------------------------------------------------------------
alter table public.push_tokens drop constraint if exists push_tokens_platform_valid;
alter table public.push_tokens
  add constraint push_tokens_platform_valid
  check (platform is null or platform in ('ios', 'android', 'web')) not valid;
