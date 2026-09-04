\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.users (id, handle, display_name) values
  ('11111111-1111-1111-1111-111111111111','alice','Alice'),
  ('22222222-2222-2222-2222-222222222222','bob','Bob');

set role authenticated;

\echo '--- 1. Alice files feedback (expect 1) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
insert into public.feedback (user_id, handle_snapshot, kind, message, app_version, platform)
  values ('11111111-1111-1111-1111-111111111111','alice','bug','camera will not open','0.1.0','ios 18');
select count(*) as alice_sees from public.feedback;

\echo '--- 2. THE BIG ONE: Bob cannot read Alice''s feedback (expect 0) ---'
set test.uid = '22222222-2222-2222-2222-222222222222';
select count(*) as bob_sees from public.feedback;

\echo '--- 3. Bob cannot file feedback as Alice (expect RLS denial) ---'
insert into public.feedback (user_id, kind, message)
  values ('11111111-1111-1111-1111-111111111111','bug','forged');

\echo '--- 4. Nobody can edit filed feedback, not even their own (expect UPDATE 0) ---'
set test.uid = '11111111-1111-1111-1111-111111111111';
update public.feedback set message = 'rewritten', status = 'resolved';

\echo '--- 5. ...nor delete it (expect DELETE 0) ---'
delete from public.feedback;

\echo '--- 6. An empty message is rejected (expect constraint violation) ---'
insert into public.feedback (user_id, kind, message)
  values ('11111111-1111-1111-1111-111111111111','bug','');

\echo '--- 7. An invented kind is rejected (expect constraint violation) ---'
insert into public.feedback (user_id, kind, message)
  values ('11111111-1111-1111-1111-111111111111','urgent','x');

\echo '--- 8. Deleting the account KEEPS the report (expect 1 row, user_id null) ---'
reset role;
delete from public.users where id = '11111111-1111-1111-1111-111111111111';
select count(*) as surviving, max(handle_snapshot) as who, bool_and(user_id is null) as detached
from public.feedback;

\echo '--- 9. A moderator (service role) sees the queue ---'
select kind, message, app_version, platform, status from public.feedback;
