-- 0041: Product analytics, for the owner's Power BI reports.
--
-- What NiblGo already records (sign-ups, posts, recipe cards, likes, comments,
-- saves, follows) is read where it is. This adds only what was missing, and
-- the reporting views Power BI reads:
--
--   1. A schema of its own, `analytics`, that the app's API never exposes
--      (only `public` is). Signed-in and signed-out users can't read or write
--      anything in it directly.
--   2. events: app opens (session_started), recipes opened on someone else's
--      post, recipe cards made (logged by format-recipe), invites shared.
--      post_views: which posts by other people each person has seen. Both hold
--      ids and times only, never words, and go with the account when it's
--      deleted.
--   3. user_labels: where each person came from, how they know us, campus and
--      whether they're a test account, set by hand by the owner
--      (analytics.label(...) below). referrals: who invited whom, from the
--      invite code typed at sign-up.
--   4. Functions the app calls to record those, each acting only as the
--      signed-in person; one more only the server can call.
--   5. Reporting views (dim_users, fact_*, kpi_*) with every KPI defined once
--      in SQL. Dates are in each person's own time zone. They carry ids, dates
--      and counts: no emails, names, captions or messages.
--   6. analytics_reader: a role that can read the reporting views and nothing
--      else. The owner makes a login in it for Power BI (docs/ANALYTICS.md).
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. The schema ---------------------------------------------------------------------------------
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

-- 2-3. Tables -----------------------------------------------------------------------------------
create table if not exists analytics.events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null constraint events_name_known
    check (name in ('session_started', 'recipe_viewed', 'recipe_generated', 'invite_sent')),
  post_id uuid references public.posts (id) on delete set null,
  detail text constraint events_detail_known check (detail is null or detail in ('card', 'blank')),
  occurred_at timestamptz not null default now()
);
create index if not exists events_user_time_idx on analytics.events (user_id, occurred_at);
create index if not exists events_name_time_idx on analytics.events (name, occurred_at);

create table if not exists analytics.post_views (
  user_id uuid not null references public.users (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists analytics.user_labels (
  user_id uuid primary key references public.users (id) on delete cascade,
  acquisition_source text constraint user_labels_source_known check (acquisition_source is null or acquisition_source in
    ('direct', 'referral', 'tiktok', 'instagram', 'campus', 'app_store', 'other')),
  relationship text constraint user_labels_relationship_known check (relationship is null or relationship in
    ('family_friend', 'acquaintance', 'independent')),
  campus text constraint user_labels_campus_len check (campus is null or char_length(campus) between 1 and 60),
  is_test boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists analytics.referrals (
  new_user_id uuid primary key references public.users (id) on delete cascade,
  referrer_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (referrer_user_id is distinct from new_user_id)
);

alter table analytics.events enable row level security;
alter table analytics.post_views enable row level security;
alter table analytics.user_labels enable row level security;
alter table analytics.referrals enable row level security;
revoke all on all tables in schema analytics from public, anon, authenticated;

-- 4. Recording ----------------------------------------------------------------------------------
-- What the app records for the signed-in person. Quietly does nothing when
-- signed out, without a profile, or past the day's cap (500): recording must
-- never get in the way of the app.
create or replace function public.log_event(event_name text, event_post uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  post uuid := event_post;
begin
  if event_name is null or event_name not in ('session_started', 'recipe_viewed', 'invite_sent') then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  if me is null or not exists (select 1 from public.users u where u.id = me) then
    return;
  end if;
  if (select count(*) from analytics.events e
      where e.user_id = me and e.occurred_at > now() - interval '1 day') >= 500 then
    return;
  end if;
  -- Only a post this person can see.
  if post is not null and not exists (
    select 1 from public.posts p where p.id = post and not public.is_blocked_pair(p.user_id, me)
  ) then
    post := null;
  end if;
  insert into analytics.events (user_id, name, post_id) values (me, event_name, post);
end;
$$;
revoke all on function public.log_event(text, uuid) from public, anon;
grant execute on function public.log_event(text, uuid) to authenticated;

-- Posts by other people this person has seen, up to 50 at a time. Their own
-- posts, posts that don't exist and posts across a block are skipped. Returns
-- how many were new.
create or replace function public.log_post_views(post_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null or post_ids is null or not exists (select 1 from public.users u where u.id = me) then
    return 0;
  end if;
  if cardinality(post_ids) > 50 then
    raise exception 'Too many posts at once' using errcode = '22023';
  end if;
  insert into analytics.post_views (user_id, post_id)
  select me, p.id
  from public.posts p
  where p.id = any (post_ids)
    and p.user_id <> me
    and not public.is_blocked_pair(p.user_id, me)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.log_post_views(uuid[]) from public, anon;
grant execute on function public.log_post_views(uuid[]) to authenticated;

-- The invite code typed at sign-up: the inviter's handle. Once per account,
-- within its first 7 days, never yourself. Says what happened:
-- ok, already, not_found, self, too_late.
create or replace function public.claim_referral(inviter_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  joined timestamptz;
  inviter uuid;
  wanted text := lower(btrim(coalesce(inviter_handle, ''), ' @'));
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select u.created_at into joined from public.users u where u.id = me;
  if joined is null then
    return 'not_found';
  end if;
  if exists (select 1 from analytics.referrals r where r.new_user_id = me) then
    return 'already';
  end if;
  if joined < now() - interval '7 days' then
    return 'too_late';
  end if;
  select u.id into inviter from public.users u where lower(u.handle) = wanted;
  if inviter is null then
    return 'not_found';
  end if;
  if inviter = me then
    return 'self';
  end if;
  insert into analytics.referrals (new_user_id, referrer_user_id) values (me, inviter)
  on conflict do nothing;
  return 'ok';
end;
$$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Server-side events (format-recipe records each card it makes). The server
-- only: it names the person, so nobody else may call it.
create or replace function public.log_server_event(target uuid, event_name text, event_detail text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if event_name is null or event_name not in ('recipe_generated') then
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  if target is null or not exists (select 1 from public.users u where u.id = target) then
    return;
  end if;
  insert into analytics.events (user_id, name, detail) values (target, event_name, event_detail);
end;
$$;
revoke all on function public.log_server_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_server_event(uuid, text, text) to service_role;

-- Labelling people by hand, from the SQL Editor (runs as the owner):
--   select analytics.label('JoeMama', source => 'direct', relationship => 'family_friend',
--                          campus => 'UNL', is_test => false);
-- Leave out what you don't want to change. analytics.label_overview lists
-- everyone with their labels.
create or replace function analytics.label(
  handle text,
  source text default null,
  relationship text default null,
  campus text default null,
  is_test boolean default null
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  who uuid;
begin
  select u.id into who from public.users u where lower(u.handle) = lower(btrim(label.handle, ' @'));
  if who is null then
    return 'No one with the handle ' || label.handle;
  end if;
  insert into analytics.user_labels as l (user_id, acquisition_source, relationship, campus, is_test)
  values (who, label.source, label.relationship, label.campus, coalesce(label.is_test, false))
  on conflict (user_id) do update set
    acquisition_source = coalesce(excluded.acquisition_source, l.acquisition_source),
    relationship = coalesce(label.relationship, l.relationship),
    campus = coalesce(label.campus, l.campus),
    is_test = coalesce(label.is_test, l.is_test),
    updated_at = now();
  return 'Labelled ' || label.handle;
end;
$$;
revoke all on function analytics.label(text, text, text, text, boolean) from public, anon, authenticated;

-- 5. Reporting views ----------------------------------------------------------------------------
-- Rebuilt from scratch each run, so a changed definition always lands.
drop view if exists
  analytics.kpi_weekly, analytics.kpi_daily, analytics.dim_users, analytics.fact_activity_days,
  analytics.fact_posts, analytics.fact_post_hashtags, analytics.fact_interactions,
  analytics.fact_events, analytics.fact_post_views, analytics.fact_referrals,
  analytics.label_overview, analytics.user_tz
  cascade;

-- Each person's time zone, if it's a real one; UTC otherwise. Internal.
create view analytics.user_tz as
with zones as (select z.name from pg_catalog.pg_timezone_names z)
select u.id as user_id, coalesce(z.name, 'UTC') as tz
from public.users u
left join zones z on z.name = u.timezone;

-- One row per person per day they were active: opened the app, or did
-- anything (posted, liked, commented, saved, reposted, shared, followed,
-- messaged, viewed a post).
create view analytics.fact_activity_days as
with acts as (
  select e.user_id, e.occurred_at as at from analytics.events e
  union all select p.user_id, p.created_at from public.posts p
  union all select r.user_id, r.created_at from public.reactions r
  union all select c.user_id, c.created_at from public.comments c
  union all select s.user_id, s.created_at from public.saved_posts s
  union all select r.user_id, r.created_at from public.reposts r
  union all select s.user_id, s.created_at from public.shares s
  union all select f.follower_id, f.created_at from public.follows f
  union all select m.sender_id, m.created_at from public.messages m
  union all select v.user_id, v.first_viewed_at from analytics.post_views v
)
select distinct a.user_id, (a.at at time zone t.tz)::date as activity_date
from acts a
join analytics.user_tz t on t.user_id = a.user_id;

create view analytics.fact_posts as
select
  p.id as post_id,
  p.user_id,
  p.created_at,
  (p.created_at at time zone t.tz)::date as created_date,
  p.meal_slot::text as meal_slot,
  p.price_level,
  coalesce(r.n, 0) > 0 as has_recipe,
  coalesce(r.ai, false) as recipe_ai_generated,
  coalesce(r.edited, false) as recipe_user_edited,
  coalesce(cardinality(p.hashtags), 0) as hashtag_count
from public.posts p
join analytics.user_tz t on t.user_id = p.user_id
left join lateral (
  select count(*) as n, bool_or(x.ai_generated) as ai, bool_or(x.user_edited) as edited
  from public.recipes x where x.post_id = p.id
) r on true;

create view analytics.fact_post_hashtags as
select p.id as post_id, tag
from public.posts p, unnest(p.hashtags) as tag;

-- Likes, comments, saves (and saves of a post with a recipe card), reposts,
-- shares and follows: who, which post, when.
create view analytics.fact_interactions as
with i as (
  select 'like'::text as kind, r.user_id, r.post_id, r.created_at from public.reactions r
  union all select 'comment', c.user_id, c.post_id, c.created_at from public.comments c
  union all select 'save', s.user_id, s.post_id, s.created_at from public.saved_posts s
  union all select 'recipe_save', s.user_id, s.post_id, s.created_at from public.saved_posts s
    where exists (select 1 from public.recipes x where x.post_id = s.post_id)
  union all select 'repost', r.user_id, r.post_id, r.created_at from public.reposts r
  union all select 'share', s.user_id, s.post_id, s.created_at from public.shares s
  union all select 'follow', f.follower_id, null::uuid, f.created_at from public.follows f
)
select i.kind, i.user_id, i.post_id, i.created_at, (i.created_at at time zone t.tz)::date as created_date
from i
join analytics.user_tz t on t.user_id = i.user_id;

create view analytics.fact_events as
select e.user_id, e.name, e.post_id, e.detail, e.occurred_at,
       (e.occurred_at at time zone t.tz)::date as occurred_date
from analytics.events e
join analytics.user_tz t on t.user_id = e.user_id;

create view analytics.fact_post_views as
select v.user_id, v.post_id, v.first_viewed_at, (v.first_viewed_at at time zone t.tz)::date as viewed_date
from analytics.post_views v
join analytics.user_tz t on t.user_id = v.user_id;

create view analytics.fact_referrals as
select r.new_user_id, r.referrer_user_id, r.created_at, (r.created_at at time zone t.tz)::date as created_date
from analytics.referrals r
join analytics.user_tz t on t.user_id = r.new_user_id;

-- One row per person: who they are for reporting (labels, sign-up cohort) and
-- the cohort KPIs, each defined once:
--   activated_7d  first post within 7 days of signing up; null until 7 days
--                 have passed, so young sign-ups never count as failures
--   d1_retained   active the day after the sign-up day
--   d7_retained   active on any day 7 to 13 after the sign-up day
--   d30_retained  active on any day 30 to 36 after the sign-up day
--   (each null until its window is over: only mature cohorts count)
create view analytics.dim_users as
with base as (
  select
    u.id as user_id,
    u.created_at as signup_at,
    (u.created_at at time zone t.tz)::date as signup_date,
    (now() at time zone t.tz)::date as today,
    au.email_confirmed_at as email_verified_at
  from public.users u
  join analytics.user_tz t on t.user_id = u.id
  left join auth.users au on au.id = u.id
),
act as (
  select b.user_id,
    count(*) as active_days,
    bool_or(a.activity_date = b.signup_date + 1) as d1,
    bool_or(a.activity_date between b.signup_date + 7 and b.signup_date + 13) as d7,
    bool_or(a.activity_date between b.signup_date + 30 and b.signup_date + 36) as d30,
    bool_or(a.activity_date > b.signup_date) as came_back
  from base b
  join analytics.fact_activity_days a on a.user_id = b.user_id
  group by b.user_id
),
posts as (
  select p.user_id, min(p.created_at) as first_post_at, count(*) as post_count
  from public.posts p group by p.user_id
)
select
  b.user_id,
  b.signup_at,
  b.signup_date,
  date_trunc('week', b.signup_date)::date as signup_week,
  b.email_verified_at as verified_at,
  b.email_verified_at is not null as verified,
  coalesce(l.acquisition_source, case when r.new_user_id is not null then 'referral' end, 'unknown')
    as acquisition_source,
  coalesce(l.relationship, 'unknown') as relationship,
  coalesce(l.campus, 'unknown') as campus,
  coalesce(l.is_test, false) as is_test,
  r.referrer_user_id as referred_by,
  p.first_post_at,
  round(extract(epoch from p.first_post_at - b.signup_at) / 3600.0, 1) as hours_to_first_post,
  coalesce(p.post_count, 0) as post_count,
  coalesce(p.post_count, 0) >= 2 as repeat_poster,
  case when now() >= b.signup_at + interval '7 days'
       then coalesce(p.first_post_at <= b.signup_at + interval '7 days', false) end as activated_7d,
  case when b.today > b.signup_date + 1 then coalesce(a.d1, false) end as d1_retained,
  case when b.today > b.signup_date + 13 then coalesce(a.d7, false) end as d7_retained,
  case when b.today > b.signup_date + 36 then coalesce(a.d30, false) end as d30_retained,
  coalesce(a.active_days, 0) as active_days,
  coalesce(a.came_back, false) as came_back,
  exists (select 1 from analytics.post_views v where v.user_id = b.user_id) as viewed_other_meal
from base b
left join act a on a.user_id = b.user_id
left join posts p on p.user_id = b.user_id
left join analytics.user_labels l on l.user_id = b.user_id
left join analytics.referrals r on r.new_user_id = b.user_id;

-- Day by day, real users only (test accounts left out): a quick check in the
-- SQL Editor, and the same numbers Power BI should show.
create view analytics.kpi_daily as
with real_users as (select user_id from analytics.dim_users where not is_test),
days as (
  select generate_series(
    (select coalesce(min(signup_date), current_date) from analytics.dim_users),
    current_date, interval '1 day')::date as day
)
select
  d.day,
  (select count(*) from analytics.dim_users u where u.signup_date = d.day and not u.is_test) as signups,
  (select count(distinct a.user_id) from analytics.fact_activity_days a
     join real_users r using (user_id) where a.activity_date = d.day) as dau,
  (select count(distinct a.user_id) from analytics.fact_activity_days a
     join real_users r using (user_id) where a.activity_date between d.day - 6 and d.day) as wau,
  (select count(*) from analytics.fact_posts p join real_users r using (user_id) where p.created_date = d.day) as posts,
  (select count(*) from analytics.fact_events e join real_users r using (user_id)
     where e.name = 'recipe_generated' and e.occurred_date = d.day) as recipes_generated,
  (select count(*) from analytics.fact_interactions i join real_users r using (user_id)
     where i.kind = 'save' and i.created_date = d.day) as saves,
  (select count(*) from analytics.fact_interactions i join real_users r using (user_id)
     where i.kind = 'like' and i.created_date = d.day) as likes,
  (select count(*) from analytics.fact_interactions i join real_users r using (user_id)
     where i.kind = 'comment' and i.created_date = d.day) as comments,
  (select count(*) from analytics.fact_events e join real_users r using (user_id)
     where e.name = 'invite_sent' and e.occurred_date = d.day) as invites_sent,
  (select count(*) from analytics.fact_referrals f
     join real_users r on r.user_id = f.new_user_id where f.created_date = d.day) as referral_signups
from days d;

-- Week by week (Monday to Sunday), real users only: who was active, who was
-- also active the week before, who posted.
create view analytics.kpi_weekly as
with real_users as (select user_id from analytics.dim_users where not is_test),
wk as (
  select distinct a.user_id, date_trunc('week', a.activity_date)::date as week_start
  from analytics.fact_activity_days a join real_users r using (user_id)
),
weeks as (select distinct week_start from wk)
select
  w.week_start,
  (select count(*) from wk where wk.week_start = w.week_start) as active_users,
  (select count(*) from wk where wk.week_start = w.week_start
     and exists (select 1 from wk p where p.user_id = wk.user_id and p.week_start = w.week_start - 7))
    as returning_users,
  (select count(distinct p.user_id) from analytics.fact_posts p join real_users r using (user_id)
     where date_trunc('week', p.created_date)::date = w.week_start) as posting_users,
  (select count(*) from analytics.fact_posts p join real_users r using (user_id)
     where date_trunc('week', p.created_date)::date = w.week_start) as posts,
  (select count(*) from analytics.dim_users u
     where u.signup_week = w.week_start and not u.is_test) as signups
from weeks w;

-- For the owner only (it shows handles): everyone, with their labels.
create view analytics.label_overview as
select u.handle, u.created_at as signed_up, l.acquisition_source, l.relationship, l.campus,
       coalesce(l.is_test, false) as is_test
from public.users u
left join analytics.user_labels l on l.user_id = u.id;

-- 6. The reader -----------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'analytics_reader') then
    create role analytics_reader nologin;
  end if;
end
$$;
grant usage on schema analytics to analytics_reader;
revoke all on all tables in schema analytics from analytics_reader;
grant select on
  analytics.dim_users, analytics.fact_activity_days, analytics.fact_posts, analytics.fact_post_hashtags,
  analytics.fact_interactions, analytics.fact_events, analytics.fact_post_views, analytics.fact_referrals,
  analytics.kpi_daily, analytics.kpi_weekly
to analytics_reader;
