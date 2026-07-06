-- Optional: seed fake users/posts so a fresh Supabase project has a live feed.
-- NOTE: these use fixed UUIDs and fake auth users. Easiest path: create 2–3
-- real test accounts through the app, then run only the posts/follows below
-- with your real user ids. This file is a template — replace the UUIDs.

-- Example (after creating a test user through the app, grab its id from
-- Authentication → Users in the Supabase dashboard):

-- insert into public.posts (user_id, meal_slot, photo_url, blurb)
-- values
--   ('YOUR-TEST-USER-UUID', 'dinner',
--    'https://YOUR-PROJECT.supabase.co/storage/v1/object/public/photos/demo/hotdish.jpg',
--    'Tater tot hotdish because it is Tuesday.'),
--   ('YOUR-TEST-USER-UUID', 'breakfast',
--    'https://YOUR-PROJECT.supabase.co/storage/v1/object/public/photos/demo/pancakes.jpg',
--    'Buttermilk pancakes, Sunday rules apply.');

-- insert into public.follows (follower_id, followee_id)
-- values ('USER-A-UUID', 'USER-B-UUID');

-- In-app demo mode (no Supabase configured) already ships with a full seeded
-- feed, so most local testing needs no SQL seeding at all.
