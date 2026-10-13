-- 0036: What's kept after an account is deleted, and for how long.
--
-- Deleting an account deletes everything it owns (posts, comments, messages,
-- likes, follows, tokens; rls_attack_test.sql section 21 proves nothing is left
-- pointing at it). A few safety records deliberately outlive it, as the
-- privacy policy says, and now do so with less:
--
--   1. Feedback and bug reports the person sent stay for the team, but no
--      longer carry their handle once the account is gone.
--   2. Reports the person filed used to be deleted with their account, so
--      someone harassed off the app erased the record of what they reported.
--      They now stay, without the reporter.
--   3. Moderation reports copy what was reported (post text and photo, comment
--      text, message text and photo), so the evidence survives the content
--      being deleted. Those copies were kept for ever. Once a report is closed
--      (actioned or dismissed) and REPORT_RETENTION_DAYS have passed (default
--      730, the privacy policy's two years), the copies are cleared; the report
--      itself (why, outcome, notes) stays as the audit trail. The daily
--      sweep-storage run calls redact_closed_reports(); the photos the copies
--      pointed at are then swept as orphans.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. Feedback forgets who sent it -----------------------------------------------------------
create or replace function public.forget_feedback_sender()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The account was deleted (its foreign key set user_id to null).
  if old.user_id is not null and new.user_id is null then
    new.handle_snapshot := null;
  end if;
  return new;
end;
$$;
revoke all on function public.forget_feedback_sender() from public, anon, authenticated;

drop trigger if exists feedback_forget_sender on public.feedback;
create trigger feedback_forget_sender before update of user_id on public.feedback
  for each row execute function public.forget_feedback_sender();

-- Feedback from accounts already deleted.
update public.feedback set handle_snapshot = null
where user_id is null and handle_snapshot is not null;

-- 2. Reports outlive the reporter's account ------------------------------------------------
alter table public.reports alter column reporter_id drop not null;
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports
  add constraint reports_reporter_id_fkey foreign key (reporter_id)
  references public.users (id) on delete set null;

-- 3. Closed reports let go of what they copied ----------------------------------------------
create or replace function public.redact_closed_reports(older_than interval default interval '730 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.reports r
  set post_blurb_snapshot = null,
      post_photo_url_snapshot = null,
      message_text_snapshot = null,
      message_image_url_snapshot = null,
      comment_text_snapshot = null
  where r.status in ('actioned', 'dismissed')
    and coalesce(r.reviewed_at, r.created_at) < now() - older_than
    and (r.post_blurb_snapshot is not null or r.post_photo_url_snapshot is not null
         or r.message_text_snapshot is not null or r.message_image_url_snapshot is not null
         or r.comment_text_snapshot is not null);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.redact_closed_reports(interval) from public, anon, authenticated;
grant execute on function public.redact_closed_reports(interval) to service_role;
