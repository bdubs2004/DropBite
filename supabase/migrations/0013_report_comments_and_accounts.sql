-- NiblGo: reports can now target a comment, or a whole account
--
-- Run this if your database predates in-app reporting of comments and
-- accounts. A fresh `schema.sql` already includes it. Safe to run more than
-- once.
--
-- Paste into Supabase dashboard > SQL Editor > New query > Run.
--
-- Nothing about the RLS changes: the existing "file report as self" insert
-- policy already permits these rows — it only checks that reporter_id is the
-- caller and reported_user_id is not. See MODERATION.md for working the queue.

-- A reported comment. SET NULL like post_id and message_id so the author
-- deleting the comment doesn't erase the report; the snapshot keeps the text.
alter table public.reports
  add column if not exists comment_id uuid references public.comments (id) on delete set null,
  add column if not exists comment_text_snapshot text;

alter table public.reports
  drop constraint if exists reports_comment_text_snapshot_check,
  add  constraint reports_comment_text_snapshot_check check (
    comment_text_snapshot is null or char_length(comment_text_snapshot) <= 2000
  );

create index if not exists reports_comment_idx on public.reports (comment_id);

-- Account reports need no new column: they are simply a report row with no
-- post_id, message_id or comment_id, carrying only reported_user_id — which is
-- already indexed by reports_reported_user_idx.
