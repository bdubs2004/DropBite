\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');
insert into public.users (id, handle, display_name) values
  ('11111111-1111-1111-1111-111111111111','alice','Alice'),
  ('22222222-2222-2222-2222-222222222222','bob','Bob'),
  ('33333333-3333-3333-3333-333333333333','snoop','Snoop');

-- Alice and Bob have a private thread.
insert into public.conversations (id) values ('cccccccc-0000-0000-0000-000000000001');
insert into public.conversation_members (conversation_id, user_id) values
  ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),
  ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
insert into public.messages (conversation_id, sender_id, text) values
  ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','private thing');

set role authenticated;

\echo '--- 1. Alice (member) reads her thread (expect 1 msg) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as alice_sees from public.messages;

\echo '--- 2. THE BIG ONE: Snoop cannot read the thread (expect 0) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
select count(*) as snoop_sees_messages from public.messages;
select count(*) as snoop_sees_conversations from public.conversations;
select count(*) as snoop_sees_members from public.conversation_members;

\echo '--- 3. Snoop cannot inject himself into their thread (expect RLS denial) ---'
insert into public.conversation_members (conversation_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');

\echo '--- 4. Snoop cannot post into their thread (expect RLS denial) ---'
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','hello');

\echo '--- 5. Alice cannot send a message spoofing Bob (expect RLS denial) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','fake');

\echo '--- 6. Snoop cannot delete their messages (expect DELETE 0) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
delete from public.messages;

\echo '--- 7. An empty message is rejected (expect check violation) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','');

\echo '--- 8. Starting a NEW thread works (expect success) ---'
set test.uid = '33333333-3333-3333-3333-333333333333';
insert into public.conversations (id) values ('cccccccc-0000-0000-0000-000000000002');
insert into public.conversation_members (conversation_id, user_id) values
  ('cccccccc-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333');
insert into public.conversation_members (conversation_id, user_id) values
  ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111');
insert into public.messages (conversation_id, sender_id, text)
  values ('cccccccc-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','hi alice');
select count(*) as snoop_own_thread_msgs from public.messages;

\echo '--- 9. A shared post survives the post being deleted (SET NULL) ---'
reset role;
insert into public.posts (id,user_id,meal_slot,photo_url,blurb) values
  ('aaaaaaaa-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','dinner','https://x/p.jpg','yum');
insert into public.messages (conversation_id, sender_id, text, shared_post_id) values
  ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','check this','aaaaaaaa-0000-0000-0000-000000000009');
delete from public.posts where id = 'aaaaaaaa-0000-0000-0000-000000000009';
select text, shared_post_id is null as attachment_cleared
  from public.messages where text = 'check this';
