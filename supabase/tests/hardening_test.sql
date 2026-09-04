\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
-- carol is PRIVATE; marge and mike are public
insert into public.users (id, handle, display_name, follows_private) values
  ('11111111-1111-1111-1111-111111111111','carol','Carol',true),
  ('22222222-2222-2222-2222-222222222222','marge','Marge',false),
  ('33333333-3333-3333-3333-333333333333','mike','Mike',false);
insert into public.follows (follower_id, followee_id) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');

set role authenticated;
set test.uid = '33333333-3333-3333-3333-333333333333';

\echo '--- 1. PRIVATE LISTS: Mike cannot enumerate Carol followers (expect 1, only his own edge) ---'
select count(*) as visible_carol_followers from public.follows
  where followee_id = '11111111-1111-1111-1111-111111111111';

\echo '--- 2. ...but counts stay public via follow_counts (expect followers=2) ---'
select * from public.follow_counts('11111111-1111-1111-1111-111111111111');

\echo '--- 3. Carol sees her own full follower list (expect 2) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as carol_own_followers from public.follows
  where followee_id = '11111111-1111-1111-1111-111111111111';

\echo '--- 4. photo_url rejects javascript: and data: ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.posts (user_id,meal_slot,photo_url,blurb)
  values ('33333333-3333-3333-3333-333333333333','dinner','javascript:alert(1)','x');
insert into public.posts (user_id,meal_slot,photo_url,blurb)
  values ('33333333-3333-3333-3333-333333333333','dinner','data:text/html,<script>','x');
\echo '   https is accepted:'
insert into public.posts (user_id,meal_slot,photo_url,blurb)
  values ('33333333-3333-3333-3333-333333333333','dinner','https://x.supabase.co/a.jpg','ok')
  returning 'accepted' as result;

\echo '--- 5. Oversized bio and blurb rejected ---'
update public.users set bio = repeat('a', 301) where id = '33333333-3333-3333-3333-333333333333';
insert into public.posts (user_id,meal_slot,photo_url,blurb)
  values ('33333333-3333-3333-3333-333333333333','dinner','https://x/a.jpg',repeat('b',2001));

\echo '--- 6. Forged streaks rejected ---'
insert into public.streaks (user_id,current_streak,longest_streak)
  values ('33333333-3333-3333-3333-333333333333',999999,999999);
insert into public.streaks (user_id,current_streak,longest_streak)
  values ('33333333-3333-3333-3333-333333333333',50,10);

\echo '--- 7. ai_usage unreachable from the client (expect 0 rows, then denial) ---'
select count(*) as rows_visible from public.ai_usage;
insert into public.ai_usage (user_id,count) values ('33333333-3333-3333-3333-333333333333',0);
\echo '   quota function is service-role only (expect: permission denied)'
\echo '   Until 0010 this SUCCEEDED, letting any client burn another user''s'
\echo '   daily AI allowance and switch their recipe cards off.'
select public.consume_ai_quota('33333333-3333-3333-3333-333333333333', 40);

\echo '--- 8. Post owner can moderate comments on their own post ---'
reset role;
insert into public.comments (post_id,user_id,text)
  select id,'22222222-2222-2222-2222-222222222222','rude' from public.posts limit 1;
set role authenticated;
set test.uid = '33333333-3333-3333-3333-333333333333';
delete from public.comments where text = 'rude';

\echo '--- 9. Storage bucket caps size and MIME type ---'
reset role;
select file_size_limit, allowed_mime_types from storage.buckets where id = 'photos';

\echo '--- 10. Quota actually enforces (expect t, t, f at limit 2) ---'
select public.consume_ai_quota('33333333-3333-3333-3333-333333333333', 2) as call1;
select public.consume_ai_quota('33333333-3333-3333-3333-333333333333', 2) as call2;
select public.consume_ai_quota('33333333-3333-3333-3333-333333333333', 2) as call3_over;

\echo '--- 11. THE DEFINER HELPERS ARE NOT OPEN TO anon ---'
\echo '     Supabase grants EXECUTE on public functions to anon by default, so'
\echo '     `revoke ... from public` was not enough: every one of these answered'
\echo '     an anonymous PostgREST call and bypassed RLS while doing it.'
reset role;
-- Scoped to our own functions by name. A scratch database may also have
-- pgcrypto installed into `public`; on Supabase those live in `extensions`.
with ours(name) as (
  values ('is_blocked_pair'), ('is_conversation_member'), ('conversation_is_empty'),
         ('conversation_has_block'), ('is_following'), ('follow_counts'),
         ('consume_ai_quota'), ('notify_post_interaction'), ('notify_comment')
),
-- authenticated needs EXECUTE only where an RLS policy expression calls it.
expected(name, anon_ok, auth_ok) as (
  values ('is_blocked_pair', false, true), ('is_conversation_member', false, true),
         ('conversation_is_empty', false, true), ('conversation_has_block', false, true),
         ('is_following', false, true), ('follow_counts', false, true),
         ('consume_ai_quota', false, false), ('notify_post_interaction', false, false),
         ('notify_comment', false, false)
)
select
  rpad(e.name, 24) as function,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
  case
    when has_function_privilege('anon', p.oid, 'EXECUTE') <> e.anon_ok
      then 'FAIL: anon should be ' || e.anon_ok::text
    when has_function_privilege('authenticated', p.oid, 'EXECUTE') <> e.auth_ok
      then 'FAIL: authenticated should be ' || e.auth_ok::text
    else 'ok'
  end as verdict
from expected e
join pg_proc p on p.proname = e.name and p.pronamespace = 'public'::regnamespace
order by verdict, function;

\echo '   Every verdict above must read ok. This is the number that matters:'
with ours(name) as (
  values ('is_blocked_pair'), ('is_conversation_member'), ('conversation_is_empty'),
         ('conversation_has_block'), ('is_following'), ('follow_counts'),
         ('consume_ai_quota'), ('notify_post_interaction'), ('notify_comment')
)
select count(*) as our_functions_callable_by_anon
from ours o
join pg_proc p on p.proname = o.name and p.pronamespace = 'public'::regnamespace
where has_function_privilege('anon', p.oid, 'EXECUTE');
