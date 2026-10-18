-- The KPI definitions in analytics (0041), checked against people whose
-- sign-up and activity dates are known, so every number Power BI shows can be
-- traced to a rule that was tested:
--
--   activated_7d  first post within 7 days; null until 7 days have passed
--   d1            active the day after the sign-up day
--   d7            active on any day 7-13 after it; d30: any day 30-36
--   (each null until its window is over)
--   days are the person's own (their time zone), not UTC
--   test accounts are left out of kpi_daily and kpi_weekly
--
-- Runs on a database with schema.sql loaded (run_security.sh does this in a
-- database of its own), inside one transaction that's rolled back.
\set ON_ERROR_STOP on
begin;

create temporary table t_results (n serial, name text, want text, got text, ok boolean);
create function pg_temp.check(name text, got text, want text) returns void language sql as $$
  insert into t_results (name, want, got, ok) values (name, want, coalesce(got, 'null'), coalesce(got, 'null') = want);
$$;

-- People. Times are relative to now(), so the test means the same thing any day.
insert into auth.users (id, email_confirmed_at) values
  ('a0000000-0000-4000-8000-0000000000a1', now() - interval '20 days'),   -- ana, verified
  ('a0000000-0000-4000-8000-0000000000b2', null),                          -- ben
  ('a0000000-0000-4000-8000-0000000000c3', now() - interval '3 days'),    -- cat
  ('a0000000-0000-4000-8000-0000000000d4', now() - interval '40 days'),   -- dan
  ('a0000000-0000-4000-8000-0000000000e5', now() - interval '5 days'),    -- eli (Chicago)
  ('a0000000-0000-4000-8000-0000000000f6', now() - interval '20 days');   -- tess (a test account)
insert into public.users (id, handle, display_name, timezone, created_at) values
  ('a0000000-0000-4000-8000-0000000000a1', 'ana', 'Ana', 'UTC', now() - interval '20 days'),
  ('a0000000-0000-4000-8000-0000000000b2', 'ben', 'Ben', 'UTC', now() - interval '10 days'),
  ('a0000000-0000-4000-8000-0000000000c3', 'cat', 'Cat', 'UTC', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-0000000000d4', 'dan', 'Dan', 'Not/AZone', now() - interval '40 days'),
  -- 11pm in Chicago, five days ago: already the next day in UTC.
  ('a0000000-0000-4000-8000-0000000000e5', 'eli', 'Eli', 'America/Chicago',
     ((date_trunc('day', now() at time zone 'America/Chicago') - interval '5 days' + interval '23 hours') at time zone 'America/Chicago')),
  ('a0000000-0000-4000-8000-0000000000f6', 'tess', 'Tess', 'UTC', now() - interval '20 days');

-- Ana: first post 2 days in (48 hours), opened the app on day 1 and day 9, saw Ben's post.
insert into public.posts (id, user_id, meal_slot, photo_url, created_at) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'dinner', 'https://x/a1.jpg', now() - interval '18 days'),
  -- Tess (a test account) posts the day before; Ben never posts at all.
  ('b0000000-0000-4000-8000-0000000000b0', 'a0000000-0000-4000-8000-0000000000f6', 'lunch', 'https://x/t1.jpg', now() - interval '19 days'),
  -- Cat posts on her first day; Dan's first post is on day 8 (too late to count as activation).
  ('b0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-0000000000c3', 'snack', 'https://x/c3.jpg', now() - interval '3 days' + interval '1 minute'),
  ('b0000000-0000-4000-8000-0000000000d4', 'a0000000-0000-4000-8000-0000000000d4', 'dinner', 'https://x/d4.jpg', now() - interval '32 days'),
  ('b0000000-0000-4000-8000-0000000000d5', 'a0000000-0000-4000-8000-0000000000d4', 'dinner', 'https://x/d5.jpg', now() - interval '31 days');
insert into analytics.events (user_id, name, occurred_at) values
  ('a0000000-0000-4000-8000-0000000000a1', 'session_started', now() - interval '19 days'),
  ('a0000000-0000-4000-8000-0000000000a1', 'session_started', now() - interval '11 days'),
  ('a0000000-0000-4000-8000-0000000000b2', 'session_started', now() - interval '10 days'),
  ('a0000000-0000-4000-8000-0000000000d4', 'session_started', now() - interval '9 days'),
  -- Eli: 1am Chicago time, two hours after signing up: the next day where he is, the same day in UTC.
  ('a0000000-0000-4000-8000-0000000000e5', 'session_started',
     ((date_trunc('day', now() at time zone 'America/Chicago') - interval '4 days' + interval '1 hour') at time zone 'America/Chicago')),
  ('a0000000-0000-4000-8000-0000000000a1', 'invite_sent', now() - interval '18 days'),
  ('a0000000-0000-4000-8000-0000000000a1', 'recipe_generated', now() - interval '18 days');
insert into analytics.post_views (user_id, post_id) values
  ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b0');
-- Cat was invited by Ana; Ben and Tess are labelled by hand.
insert into analytics.referrals (new_user_id, referrer_user_id, created_at) values
  ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-0000000000a1', now() - interval '3 days');
select analytics.label('ben', source => 'tiktok', relationship => 'independent', campus => 'UNL');
select analytics.label('@Tess', is_test => true);
select analytics.label('nobody_here', is_test => true) as no_such_person \gset
select pg_temp.check('labelling a handle that doesn''t exist says so', :'no_such_person', 'No one with the handle nobody_here');

-- One row per person.
create temporary table u as select * from analytics.dim_users where user_id::text like 'a0000000-%';
create function pg_temp.k(who text, col text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select %I::text from u where user_id = %L', col, who) into v;
  return coalesce(v, 'null');
end $$;
\set ana '''a0000000-0000-4000-8000-0000000000a1'''
\set ben '''a0000000-0000-4000-8000-0000000000b2'''
\set cat '''a0000000-0000-4000-8000-0000000000c3'''
\set dan '''a0000000-0000-4000-8000-0000000000d4'''
\set eli '''a0000000-0000-4000-8000-0000000000e5'''
\set tess '''a0000000-0000-4000-8000-0000000000f6'''

select pg_temp.check('Ana posted within 7 days: activated', pg_temp.k(:ana, 'activated_7d'), 'true');
select pg_temp.check('Ana: 48 hours to her first post', pg_temp.k(:ana, 'hours_to_first_post'), '48.0');
select pg_temp.check('Ana: back the next day (D1)', pg_temp.k(:ana, 'd1_retained'), 'true');
select pg_temp.check('Ana: back on day 9 (D7 window is days 7-13)', pg_temp.k(:ana, 'd7_retained'), 'true');
select pg_temp.check('Ana: D30 unknown yet (20 days in)', pg_temp.k(:ana, 'd30_retained'), 'null');
select pg_temp.check('Ana: verified her email', pg_temp.k(:ana, 'verified'), 'true');
select pg_temp.check('Ana: saw someone else''s meal', pg_temp.k(:ana, 'viewed_other_meal'), 'true');
select pg_temp.check('Ana: one post, not a repeat poster yet', pg_temp.k(:ana, 'post_count') || '/' || pg_temp.k(:ana, 'repeat_poster'), '1/false');

select pg_temp.check('Ben never posted, 10 days in: not activated', pg_temp.k(:ben, 'activated_7d'), 'false');
select pg_temp.check('Ben: not back the next day', pg_temp.k(:ben, 'd1_retained'), 'false');
select pg_temp.check('Ben: D7 unknown yet (window ends on day 13)', pg_temp.k(:ben, 'd7_retained'), 'null');
select pg_temp.check('Ben: hasn''t verified', pg_temp.k(:ben, 'verified'), 'false');
select pg_temp.check('Ben: labelled TikTok, independent, UNL', pg_temp.k(:ben, 'acquisition_source') || '/' || pg_temp.k(:ben, 'relationship') || '/' || pg_temp.k(:ben, 'campus'), 'tiktok/independent/UNL');

select pg_temp.check('Cat posted on day 0 but is 3 days in: activation not counted yet', pg_temp.k(:cat, 'activated_7d'), 'null');
select pg_temp.check('Cat: invited by Ana, so her source is referral', pg_temp.k(:cat, 'acquisition_source') || '/' || pg_temp.k(:cat, 'referred_by'), 'referral/a0000000-0000-4000-8000-0000000000a1');
select pg_temp.check('Cat: not back on day 1', pg_temp.k(:cat, 'd1_retained'), 'false');

select pg_temp.check('Dan''s first post was on day 8: not activated', pg_temp.k(:dan, 'activated_7d'), 'false');
select pg_temp.check('Dan: that post on day 8 counts as D7', pg_temp.k(:dan, 'd7_retained'), 'true');
select pg_temp.check('Dan: back on day 31 (D30 window is days 30-36)', pg_temp.k(:dan, 'd30_retained'), 'true');
select pg_temp.check('Dan: two posts, a repeat poster', pg_temp.k(:dan, 'repeat_poster'), 'true');
select pg_temp.check('Dan''s made-up time zone falls back to UTC', (select tz from analytics.user_tz where user_id = :dan), 'UTC');
select pg_temp.check('nobody unlabelled gets a made-up source', pg_temp.k(:dan, 'acquisition_source') || '/' || pg_temp.k(:dan, 'relationship'), 'unknown/unknown');

select pg_temp.check('Eli''s days are Chicago days: signed up 5 days ago there', pg_temp.k(:eli, 'signup_date'),
  ((now() at time zone 'America/Chicago')::date - 5)::text);
select pg_temp.check('Eli: 1am Chicago time is the next day there, so D1 counts', pg_temp.k(:eli, 'd1_retained'), 'true');

select pg_temp.check('Tess is a test account', pg_temp.k(:tess, 'is_test'), 'true');

-- Day by day and week by week, test accounts left out.
select pg_temp.check('kpi_daily: Ana''s sign-up day counts one sign-up (Tess signed up too, but she''s a test account)',
  (select signups::text from analytics.kpi_daily where day = (now() - interval '20 days')::date), '1');
select pg_temp.check('kpi_daily: Ana posted 18 days ago (Tess''s post the day before doesn''t count)',
  (select posts::text || '/' || (select posts from analytics.kpi_daily where day = (now() - interval '19 days')::date)
   from analytics.kpi_daily where day = (now() - interval '18 days')::date), '1/0');
select pg_temp.check('kpi_daily: DAU 19 days ago is Ana alone (Tess posted that day, but she''s a test account)',
  (select dau::text from analytics.kpi_daily where day = (now() - interval '19 days')::date), '1');
select pg_temp.check('kpi_daily: WAU 10 days ago counts Ana (back the day before) and Ben (signed up that day)',
  (select wau::text from analytics.kpi_daily where day = (now() - interval '10 days')::date), '2');
select pg_temp.check('kpi_daily: the invite, the recipe card and Cat''s referral are counted',
  (select sum(invites_sent)::text || '/' || sum(recipes_generated) || '/' || sum(referral_signups) from analytics.kpi_daily), '1/1/1');
select pg_temp.check('kpi_weekly: every week''s active users are real people (Tess never counts)',
  (select sum(active_users) from analytics.kpi_weekly)::text,
  (select count(*) from (select distinct a.user_id, date_trunc('week', a.activity_date) from analytics.fact_activity_days a
    join analytics.dim_users d using (user_id) where not d.is_test) x)::text);

-- What the reader sees carries no words.
select pg_temp.check('fact_posts has the post''s facts, not its caption',
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'analytics' and table_name = 'fact_posts'),
  'post_id,user_id,created_at,created_date,meal_slot,price_level,has_recipe,recipe_ai_generated,recipe_user_edited,hashtag_count');

\echo
\echo '================ analytics results ================'
select case when ok then 'PASS' else 'FAIL' end as result, name, want, got from t_results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed, count(*) as total from t_results;
do $$
begin
  if exists (select 1 from t_results where not ok) then
    raise exception '% analytics check(s) failed', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
