-- Threaded replies on comments (Instagram-style, two levels: a reply always
-- attaches to a top-level comment). NULL parent = a top-level comment.
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;

create index if not exists comments_parent_idx on public.comments (parent_id);
