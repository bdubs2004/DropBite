-- NiblGo: in-app feedback and bug reports
--
-- Run this on an existing database. A fresh `schema.sql` already includes it.
-- Safe to run more than once.

-- ------------------------------------------------------------- feedback
-- In-app feedback and bug reports, from the Help section of the profile
-- drawer. Deliberately separate from `reports`: that table is a moderation
-- queue about other people's content and carries legal weight, this one is
-- users telling us the app is broken.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: a bug report stays useful after the person who
  -- filed it deletes their account, and losing it would hide the very problem
  -- that made them leave.
  user_id uuid references public.users (id) on delete set null,
  -- Who filed it, kept readable after the account is gone.
  handle_snapshot text
    constraint feedback_handle_len check (handle_snapshot is null or char_length(handle_snapshot) <= 30),
  kind text not null default 'feedback'
    constraint feedback_kind_allowed check (kind in ('feedback', 'bug')),
  message text not null
    constraint feedback_message_len check (char_length(message) between 1 and 2000),
  -- Filled in by the app, not typed by the user: a bug report without the
  -- platform and build is usually not actionable.
  app_version text constraint feedback_version_len check (app_version is null or char_length(app_version) <= 32),
  platform text constraint feedback_platform_len check (platform is null or char_length(platform) <= 32),
  status text not null default 'new'
    constraint feedback_status_allowed check (status in ('new', 'triaged', 'resolved')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text constraint feedback_notes_len check (reviewer_notes is null or char_length(reviewer_notes) <= 2000)
);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

-- feedback: file your own, read your own, and that is all. No update or delete
-- policy on purpose — a filed report should not be editable after the fact,
-- and triage happens through the service role.
drop policy if exists "file feedback as self" on public.feedback;
create policy "file feedback as self" on public.feedback
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback
  for select to authenticated using (user_id = auth.uid());
