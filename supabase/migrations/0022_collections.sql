-- Collections: named groups of your own posts ("Crockpot meals", "Desserts")
-- shown on your profile.
--
-- Anyone who can see your posts can see your collections (blocking hides them
-- both ways, same as posts). Only you can create, rename or delete yours, and
-- only your own posts can go in them.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null constraint collections_name_len check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
-- One "Desserts" per person, whatever the capitalisation.
create unique index if not exists collections_user_name_idx
  on public.collections (user_id, lower(btrim(name)));
create index if not exists collections_user_created_idx
  on public.collections (user_id, created_at desc);

create table if not exists public.collection_posts (
  collection_id uuid not null references public.collections (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists collection_posts_post_idx on public.collection_posts (post_id);

alter table public.collections enable row level security;
alter table public.collection_posts enable row level security;

drop policy if exists "collections readable" on public.collections;
create policy "collections readable" on public.collections
  for select to authenticated using (not public.is_blocked_pair(user_id, auth.uid()));
drop policy if exists "create own collections" on public.collections;
create policy "create own collections" on public.collections
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "rename own collections" on public.collections;
create policy "rename own collections" on public.collections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own collections" on public.collections;
create policy "delete own collections" on public.collections
  for delete to authenticated using (user_id = auth.uid());

-- Items are visible wherever their collection is (the subquery runs under the
-- collections policy above), and the posts themselves still go through the
-- posts policy when they're loaded.
drop policy if exists "collection items readable" on public.collection_posts;
create policy "collection items readable" on public.collection_posts
  for select to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id)
  );
drop policy if exists "add own posts to own collections" on public.collection_posts;
create policy "add own posts to own collections" on public.collection_posts
  for insert to authenticated with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
    and exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid())
  );
drop policy if exists "remove from own collections" on public.collection_posts;
create policy "remove from own collections" on public.collection_posts
  for delete to authenticated using (
    exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid())
  );
