\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Notifications are written by triggers, never by clients. These tests drive
-- the database directly, the way a patched client would.

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into public.users (id, handle, display_name) values
  ('11111111-1111-1111-1111-111111111111','alice','Alice'),
  ('22222222-2222-2222-2222-222222222222','bob','Bob'),
  ('33333333-3333-3333-3333-333333333333','snoop','Snoop');

insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'dinner','https://example.com/a.jpg','alice dinner');

set role authenticated;

\echo '--- 1. Bob likes Alice''s post: Alice gets one notification ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
set test.uid = '11111111-1111-1111-1111-111111111111';
select type, actor_id = '22222222-2222-2222-2222-222222222222' as from_bob, read_at is null as unread
from public.notifications;

\echo '--- 2. Unliking and re-liking does NOT stack a second one (expect still 1) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
delete from public.reactions
  where post_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and user_id = '22222222-2222-2222-2222-222222222222';
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as like_notifications from public.notifications where type = 'like';

\echo '--- 3. Every comment is its own notification (expect 2 comment rows) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.comments (post_id, user_id, text)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','first');
insert into public.comments (post_id, user_id, text)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','second');
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as comment_notifications from public.notifications where type = 'comment';

\echo '--- 4. Reposts and shares notify too (expect one of each) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.reposts (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
insert into public.shares (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
set test.uid = '11111111-1111-1111-1111-111111111111';
select type, count(*) from public.notifications group by type order by type;

\echo '--- 5. Liking your OWN post notifies nobody (expect no new row) ---'
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
select count(*) as self_notifications from public.notifications
  where actor_id = '11111111-1111-1111-1111-111111111111';

\echo '--- 6. THE BIG ONE: Snoop cannot read Alice''s notifications (expect 0) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
select count(*) as snoop_sees from public.notifications;

\echo '--- 7. THE OTHER BIG ONE: Snoop cannot forge one (expect RLS denial) ---'
\echo '     There is no insert policy at all; only the trigger may write.'
insert into public.notifications (user_id, actor_id, type)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','like');

\echo '--- 8. Snoop cannot mark Alice''s notifications read (expect UPDATE 0) ---'
update public.notifications set read_at = now()
  where user_id = '11111111-1111-1111-1111-111111111111';

\echo '--- 9. Alice can mark her own read, and cannot readdress them ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
update public.notifications set read_at = now() where read_at is null;
select count(*) as still_unread from public.notifications where read_at is null;
update public.notifications set user_id = '33333333-3333-3333-3333-333333333333';

\echo '--- 10. Blocking someone hides the notifications they already caused ---'
\echo '     Snoop likes first, THEN Alice blocks him (expect it to disappear).'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as before_block from public.notifications
  where actor_id = '33333333-3333-3333-3333-333333333333';

\echo '--- 10b. A blocked user''s like notifies nobody (expect no new row) ---'
insert into public.blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
select count(*) as after_block from public.notifications
  where actor_id = '33333333-3333-3333-3333-333333333333';

-- ...and a like filed while blocked never lands either.
set test.uid = '33333333-3333-3333-3333-333333333333';
delete from public.reactions
  where post_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and user_id = '33333333-3333-3333-3333-333333333333';
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as from_blocked_user from public.notifications
  where actor_id = '33333333-3333-3333-3333-333333333333';

\echo '--- 11. Deleting the post takes its notifications with it (expect 0) ---'
delete from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select count(*) as left_behind from public.notifications;

\echo '--- 12. Alice can clear her own notifications ---'
insert into public.posts (id, user_id, meal_slot, photo_url, blurb) values
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'lunch','https://example.com/b.jpg','another');
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.reactions (post_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222');
set test.uid = '11111111-1111-1111-1111-111111111111';
delete from public.notifications where user_id = '11111111-1111-1111-1111-111111111111';
select count(*) as after_clear from public.notifications;
