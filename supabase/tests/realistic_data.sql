-- A database that has been used: every kind of row the app makes, including
-- the awkward ones later rules allow but early ones didn't. Loaded (as the
-- owner) after schema.sql by run_security.sh's "data" mode, which then runs
-- upgrade_all.sql and schema.sql over it: re-running the migrations on a live
-- database must never trip over data the app was allowed to write.
--
-- The awkward ones, on purpose:
--   * a "Dana left the chat" line (kind 'left', no text)
--   * a DM whose shared post was deleted, and one whose shared profile was
--     deleted (both end up with nothing in them)
--   * a DM photo from before DM photos went private (public image_url)
--   * handles with capitals (JoeMama), which early rules didn't allow
--   * a photo-only comment (empty text), a reply, a reply to a deleted person
--   * every notification type, every report kind and status
--   * recipe cards with numbers as quantities, with and without nutrition

insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'), ('a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003'), ('a0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000005');
insert into public.users (id, handle, display_name, bio, timezone, follows_private) values
  ('a0000000-0000-4000-8000-000000000001', 'JoeMama', 'Joe Mama', E'cooks a lot\nsecond line', 'America/Chicago', false),
  ('a0000000-0000-4000-8000-000000000002', 'dana_cooks', 'Dana', null, 'UTC', true),
  ('a0000000-0000-4000-8000-000000000003', 'eli', 'Eli', '', 'Europe/London', false),
  ('a0000000-0000-4000-8000-000000000004', 'Gone_Soon', 'Gone', null, 'UTC', false),
  ('a0000000-0000-4000-8000-000000000005', 'pat', 'Pat 👨‍🍳', null, 'UTC', false);

insert into public.follows (follower_id, followee_id) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004');
insert into public.blocks (blocker_id, blocked_id) values
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004');

insert into storage.objects (bucket_id, name, owner) values
  ('photos', 'a0000000-0000-4000-8000-000000000001/aaaa0000aaaa0000aaaa0000aaaa0001.jpg', 'a0000000-0000-4000-8000-000000000001'),
  ('photos', 'a0000000-0000-4000-8000-000000000002/aaaa0000aaaa0000aaaa0000aaaa0002.jpg', 'a0000000-0000-4000-8000-000000000002'),
  ('photos', 'a0000000-0000-4000-8000-000000000004/aaaa0000aaaa0000aaaa0000aaaa0004.jpg', 'a0000000-0000-4000-8000-000000000004');
insert into public.posts (id, user_id, meal_slot, photo_url, blurb, photo_width, photo_height) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'dinner',
   'https://proj.supabase.co/storage/v1/object/public/photos/a0000000-0000-4000-8000-000000000001/aaaa0000aaaa0000aaaa0000aaaa0001.jpg', 'chicken thing with garlic', 1080, 1350),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'breakfast',
   'https://proj.supabase.co/storage/v1/object/public/photos/a0000000-0000-4000-8000-000000000002/aaaa0000aaaa0000aaaa0000aaaa0002.jpg', '', null, null),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'snack',
   'https://proj.supabase.co/storage/v1/object/public/photos/a0000000-0000-4000-8000-000000000004/aaaa0000aaaa0000aaaa0000aaaa0004.jpg', 'about to be deleted', 800, 800);
-- Hashtags (0039), where the database has them.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'posts' and column_name = 'hashtags') then
    update public.posts set hashtags = '{homemade,comfortfood}' where id = 'b0000000-0000-4000-8000-000000000001';
  end if;
end $$;
insert into public.recipes (post_id, title, ingredients, steps, cook_time_minutes, ai_generated, user_edited, servings, nutrition, nutrition_source) values
  ('b0000000-0000-4000-8000-000000000001', 'Garlic chicken',
   '[{"item":"chicken thighs","quantity":2,"unit":""},{"item":"garlic","quantity":"3","unit":"cloves","grams":9,"fdc_id":1104647,"nutrition":{"calories":13,"protein_g":0.6}}]',
   '["Rub with garlic.","Roast 25 minutes."]', 25, true, true, 2,
   '{"calories":620,"protein_g":58,"carbs_g":3,"fat_g":40,"fiber_g":0,"sugar_g":0,"sodium_mg":240}', 'usda'),
  ('b0000000-0000-4000-8000-000000000002', 'Toast', '[]', '[]', null, true, false, 1, null, null);
insert into public.post_tags (post_id, user_id) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');

insert into public.reactions (post_id, user_id) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.comments (id, post_id, user_id, text, image_url, parent_id, reply_to_user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'looks amazing', null, null, null),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '',
   'https://proj.supabase.co/storage/v1/object/public/photos/a0000000-0000-4000-8000-000000000002/aaaa0000aaaa0000aaaa0000aaaa0002.jpg', null, null),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'thank you!',
   null, 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'reply to someone who leaves',
   null, 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004');
insert into public.comment_reactions (comment_id, user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001');
insert into public.reposts (post_id, user_id) values ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001');
insert into public.shares (post_id, user_id) values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
insert into public.saved_posts (user_id, post_id) values ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001');
insert into public.collections (id, user_id, name) values ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Weeknight dinners');
insert into public.collection_posts (collection_id, post_id) values ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');

-- Chats: a 1:1, and a titled group someone left.
insert into public.conversations (id, is_group, title) values
  ('e0000000-0000-4000-8000-000000000001', false, null),
  ('e0000000-0000-4000-8000-000000000002', true, 'Supper club');
insert into public.conversation_members (conversation_id, user_id, muted) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', false),
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', true),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', false),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', false);
insert into storage.objects (bucket_id, name, owner) values
  ('dm-photos', 'e0000000-0000-4000-8000-000000000001/aaaa0000aaaa0000aaaa0000aaaa0009.jpg', 'a0000000-0000-4000-8000-000000000001');
insert into public.messages (id, conversation_id, sender_id, text, shared_post_id, shared_user_id, image_url, image_path, kind) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'hey', null, null, null, null, 'message'),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '', 'b0000000-0000-4000-8000-000000000003', null, null, null, 'message'),
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '', null, 'a0000000-0000-4000-8000-000000000004', null, null, 'message'),
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '', null, null,
   'https://proj.supabase.co/storage/v1/object/public/photos/a0000000-0000-4000-8000-000000000002/aaaa0000aaaa0000aaaa0000aaaa0002.jpg', null, 'message'),
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '', null, null, null,
   'e0000000-0000-4000-8000-000000000001/aaaa0000aaaa0000aaaa0000aaaa0009.jpg', 'message'),
  ('f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '', null, null, null, null, 'left'),
  ('f0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'count me in', null, null, null, null, 'message');
insert into public.message_reactions (message_id, user_id, emoji) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', '❤️');

-- Every notification type.
insert into public.notifications (user_id, actor_id, type, post_id, comment_id, read_at) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'repost', 'b0000000-0000-4000-8000-000000000001', null, now()),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'share', 'b0000000-0000-4000-8000-000000000001', null, null),
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'follow_back', null, null, null)
on conflict do nothing;

-- Reports of every kind, in every state; feedback with and without an account.
insert into public.reports (reporter_id, post_id, reported_user_id, reason, post_blurb_snapshot, status, reviewed_at, reviewer_notes) values
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'spam', 'about to be deleted', 'actioned', now(), 'Removed.');
insert into public.reports (reporter_id, comment_id, reported_user_id, reason, comment_text_snapshot, status) values
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'harassment', 'looks amazing', 'dismissed');
insert into public.reports (reporter_id, message_id, reported_user_id, reason, message_text_snapshot, status) values
  ('a0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'spam', 'hey', 'open');
insert into public.reports (reporter_id, reported_user_id, reason, status) values
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'other', 'reviewing');
insert into public.feedback (user_id, kind, message, handle_snapshot, app_version, platform) values
  ('a0000000-0000-4000-8000-000000000001', 'bug', 'the button is blue', 'JoeMama', '1.0.3', 'ios'),
  (null, 'feedback', 'love it', null, '1.0.1', 'android');

insert into public.push_tokens (user_id, token, platform) values
  ('a0000000-0000-4000-8000-000000000001', 'ExponentPushToken[joe-phone]', 'ios'),
  ('a0000000-0000-4000-8000-000000000002', 'ExponentPushToken[dana-phone]', null);
insert into public.ai_usage (user_id, day, count) values ('a0000000-0000-4000-8000-000000000001', current_date, 3);
insert into public.app_config (key, value) values ('storage_origin', 'https://proj.supabase.co') on conflict do nothing;

-- Now what time does to data: a shared post and a shared profile get deleted
-- (their messages are left with nothing in them), and an account goes.
delete from public.posts where id = 'b0000000-0000-4000-8000-000000000003';
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000004';
