\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into public.users (id, handle, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'alice', 'Alice'),
  ('22222222-2222-2222-2222-222222222222', 'badguy', 'Bad Guy'),
  ('33333333-3333-3333-3333-333333333333', 'carol', 'Carol');

-- Bad Guy posts something.
insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'dinner',
   'https://x.supabase.co/storage/v1/object/public/photos/22222222-2222-2222-2222-222222222222/1.jpg',
   'something awful');

set role authenticated;

\echo '--- 1. Alice reports Bad Guy (expect INSERT 1) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.reports (post_id, reporter_id, reported_user_id, reason, detail, post_blurb_snapshot)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          'harassment', 'targeted abuse', 'something awful');

\echo '--- 2. Alice reporting the SAME post twice (expect unique violation) ---'
insert into public.reports (post_id, reporter_id, reported_user_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', 'spam');

\echo '--- 3. Alice cannot file a report AS someone else (expect RLS denial) ---'
insert into public.reports (post_id, reporter_id, reported_user_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222', 'spam');

\echo '--- 4. Carol also reports the same post (expect INSERT 1, different reporter) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.reports (post_id, reporter_id, reported_user_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222', 'spam');

\echo '--- 5. THE BIG ONE: Bad Guy cannot see reports against him (expect 0 rows) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as reports_badguy_can_see from public.reports;

\echo '--- 6. Carol sees only her own report, not Alices (expect 1) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
select count(*) as reports_carol_can_see from public.reports;

\echo '--- 7. Bad Guy cannot delete reports against him (expect DELETE 0) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
delete from public.reports;

\echo '--- 8. Reporter cannot mark their own report as dismissed (expect UPDATE 0) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
update public.reports set status = 'dismissed';

\echo '--- 9. You cannot report your own post (expect RLS denial) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'lunch',
   'https://x.supabase.co/storage/v1/object/public/photos/22222222-2222-2222-2222-222222222222/2.jpg', 'mine');
insert into public.reports (post_id, reporter_id, reported_user_id, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000002',
          '22222222-2222-2222-2222-222222222222',
          '22222222-2222-2222-2222-222222222222', 'spam');

\echo '--- 10. CRITICAL: Bad Guy deletes the post; reports must SURVIVE ---'
delete from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
select count(*) as reports_surviving_post_deletion from public.reports
  where reported_user_id = '22222222-2222-2222-2222-222222222222';
\echo 'evidence preserved via snapshot (post_id now null):'
select post_id, reason, post_blurb_snapshot, status
  from public.reports where reason = 'harassment';

\echo '--- 11. Moderator triage view (service role bypasses RLS) ---'
select r.reason, r.status, u.handle as reported_user, r.post_blurb_snapshot
  from public.reports r
  left join public.users u on u.id = r.reported_user_id
  order by r.created_at;
