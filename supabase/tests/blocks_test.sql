\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.users (id, handle, display_name) values
  ('11111111-1111-1111-1111-111111111111','alice','Alice'),
  ('22222222-2222-2222-2222-222222222222','troll','Troll');

insert into public.posts (id,user_id,meal_slot,photo_url,blurb) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','dinner','https://x/a.jpg','alice dinner'),
  ('aaaaaaaa-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','dinner','https://x/t.jpg','troll dinner');
insert into public.comments (post_id,user_id,text) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','22222222-2222-2222-2222-222222222222','nasty comment');
insert into public.follows (follower_id,followee_id) values
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111');

-- An existing DM thread between them.
insert into public.conversations (id) values ('cccccccc-0000-0000-0000-00000000000c');
insert into public.conversation_members (conversation_id,user_id) values
  ('cccccccc-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111'),
  ('cccccccc-0000-0000-0000-00000000000c','22222222-2222-2222-2222-222222222222');

set role authenticated;

\echo '--- Before blocking: Alice sees both posts (expect 2) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as posts_visible from public.posts;

\echo '--- Alice blocks Troll ---'
insert into public.blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

\echo '--- 1. Alice no longer sees Troll posts (expect 1: her own) ---'
select count(*) as alice_posts_visible from public.posts;

\echo '--- 2. SYMMETRY: Troll no longer sees Alice posts (expect 1: his own) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as troll_posts_visible from public.posts;

\echo '--- 3. Troll comment hidden from Alice (expect 0) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as comments_visible from public.comments;

\echo '--- 4. Troll cannot re-follow Alice (expect RLS denial) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
insert into public.follows (follower_id,followee_id)
  values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111');

\echo '--- 5. Troll cannot message through the old thread (expect RLS denial) ---'
insert into public.messages (conversation_id,sender_id,text)
  values ('cccccccc-0000-0000-0000-00000000000c','22222222-2222-2222-2222-222222222222','still here');

\echo '--- 6. Alice cannot message him either (block is symmetric) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.messages (conversation_id,sender_id,text)
  values ('cccccccc-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','hi');

\echo '--- 7. Troll cannot tell he was blocked (expect 0 rows) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as blocks_troll_can_see from public.blocks;

\echo '--- 8. Troll cannot delete the block (expect DELETE 0) ---'
delete from public.blocks;

\echo '--- 9. Alice sees her own block (expect 1) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
select count(*) as blocks_alice_sees from public.blocks;

\echo '--- 10. Nobody can block themselves (expect check violation) ---'
insert into public.blocks (blocker_id, blocked_id)
  values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');

\echo '--- 11. Unblocking restores visibility (expect 2 posts) ---'
delete from public.blocks where blocked_id = '22222222-2222-2222-2222-222222222222';
select count(*) as posts_after_unblock from public.posts;
