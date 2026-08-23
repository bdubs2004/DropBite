-- NiblGo: content reporting
--
-- Run this if your database was created before the reports feature existed.
-- A fresh `schema.sql` already includes everything here.
--
-- Paste into Supabase dashboard > SQL Editor > New query > Run.
-- Safe to run more than once.
--
-- See MODERATION.md for how to actually work the queue this creates.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: deleting the reported post must not erase the
  -- report. The snapshots below keep the evidence readable afterwards.
  post_id uuid references public.posts (id) on delete set null,
  reporter_id uuid not null references public.users (id) on delete cascade,
  reported_user_id uuid references public.users (id) on delete set null,
  reason text not null check (
    reason in ('spam', 'harassment', 'sexual', 'violence', 'self_harm',
               'false_info', 'intellectual_property', 'other')
  ),
  detail text check (detail is null or char_length(detail) <= 1000),
  post_blurb_snapshot text check (post_blurb_snapshot is null or char_length(post_blurb_snapshot) <= 2000),
  post_photo_url_snapshot text check (post_photo_url_snapshot is null or char_length(post_photo_url_snapshot) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text check (reviewer_notes is null or char_length(reviewer_notes) <= 2000)
);

create unique index if not exists reports_one_per_reporter_idx
  on public.reports (reporter_id, post_id);
create index if not exists reports_status_created_idx
  on public.reports (status, created_at);
create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id);

alter table public.reports enable row level security;

-- Write-only from the client: file your own, read back only your own.
-- No policy exposes the queue or tells a reported user who filed against them.
-- No UPDATE/DELETE policy: only staff (service role / dashboard) change status.
drop policy if exists "file report as self" on public.reports;
create policy "file report as self" on public.reports
  for insert to authenticated with check (
    reporter_id = auth.uid()
    and reported_user_id is distinct from auth.uid()
  );

drop policy if exists "read own reports" on public.reports;
create policy "read own reports" on public.reports
  for select to authenticated using (reporter_id = auth.uid());
