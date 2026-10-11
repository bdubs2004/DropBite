-- Live Activity: new rows in notifications are sent to the app as they happen,
-- so the in-app banner can drop down the moment someone likes, comments,
-- replies or follows you.
--
-- This only adds the table to Supabase's realtime publication. Who can see
-- what is unchanged: realtime runs every row through the same RLS policies as
-- a normal read, so you only ever receive your own Activity.
--
-- Without it the app still works: it falls back to checking every 30 seconds.
-- Safe to run more than once, and a no-op where the publication doesn't exist.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
