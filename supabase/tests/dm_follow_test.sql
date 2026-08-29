\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

-- DMs are opt-in: you can only START a thread with someone you follow, but
-- once a thread exists both sides can talk. These tests drive the database
-- directly, the way a patched client would.

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into public.users (id, handle, display_name, follows_private) values
  ('11111111-1111-1111-1111-111111111111','alice','Alice', true),
  ('22222222-2222-2222-2222-222222222222','bob','Bob', false),
  ('33333333-3333-3333-3333-333333333333','snoop','Snoop', false);

-- Alice follows Bob. Nobody follows Snoop, and Snoop follows nobody.
insert into public.follows (follower_id, followee_id) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

set role authenticated;

\echo '--- 1. Alice starts a thread with Bob, whom she follows (expect success) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.conversations (id) values ('cccccccc-0000-0000-0000-000000000001');
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
select count(*) as members_in_thread from public.conversation_members
  where conversation_id = 'cccccccc-0000-0000-0000-000000000001';

\echo '--- 2. Alice is private, and it did NOT block her own follow check ---'
\echo '     (is_following is SECURITY DEFINER; a plain subquery would fail here)'
select public.is_following(
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') as alice_follows_bob;

\echo '--- 3. THE BIG ONE: Snoop cannot open a thread with Bob (expect RLS denial) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.conversations (id) values ('cccccccc-0000-0000-0000-000000000002');
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333');
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222');

\echo '--- 4. Bob can reply in Alice''s thread without following her back (expect success) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
select public.is_following(
  '22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111') as bob_follows_alice;
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','sure thing');
select count(*) as bob_replies from public.messages
  where conversation_id = 'cccccccc-0000-0000-0000-000000000001';

\echo '--- 5. Unfollowing does not lock Alice out of a thread she already has ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
delete from public.follows
  where follower_id = '11111111-1111-1111-1111-111111111111'
    and followee_id = '22222222-2222-2222-2222-222222222222';
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','still here');
select count(*) as alice_can_still_send from public.messages
  where conversation_id = 'cccccccc-0000-0000-0000-000000000001'
    and text = 'still here';

\echo '--- 6. Snoop still cannot add himself to their existing thread (expect RLS denial) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');

\echo '--- 7. Bob reports a message from the thread (expect 1 report) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.reports
  (reporter_id, reported_user_id, message_id, message_text_snapshot, reason, detail)
select
  '22222222-2222-2222-2222-222222222222',
  m.sender_id,
  m.id,
  m.text,
  'harassment',
  'reported from the chat thread'
from public.messages m
where m.conversation_id = 'cccccccc-0000-0000-0000-000000000001'
  and m.sender_id = '11111111-1111-1111-1111-111111111111'
limit 1;
select count(*) as bob_reports from public.reports where reporter_id = '22222222-2222-2222-2222-222222222222';

\echo '--- 8. The snapshot outlives the message (sender deletes it; expect text kept) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
delete from public.messages
  where conversation_id = 'cccccccc-0000-0000-0000-000000000001'
    and sender_id = '11111111-1111-1111-1111-111111111111';
set test.uid = '22222222-2222-2222-2222-222222222222';
select message_id is null as message_gone, message_text_snapshot
from public.reports where reporter_id = '22222222-2222-2222-2222-222222222222';

\echo '--- 9. Snoop cannot read anyone else''s reports (expect 0) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
select count(*) as snoop_sees_reports from public.reports;

\echo '--- 10. Nobody can report themselves (expect RLS denial) ---'
insert into public.reports (reporter_id, reported_user_id, reason)
  values ('33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333','spam');
