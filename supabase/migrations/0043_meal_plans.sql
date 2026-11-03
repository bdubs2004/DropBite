-- 0043: Meal plans and families.
--
-- A meal plan is a week calendar: meals (a post, usually one with a recipe,
-- or just a name like "tacos") placed on a day and a meal slot. Everyone has
-- their own plan. Joining a family switches you to the family's shared plan;
-- leaving brings your own back.
--
-- Families have one admin (whoever made it). The admin's additions go
-- straight in. Anyone else's wait as "pending" until the admin approves them.
-- Members can vote yes or no on any meal so the admin can see how people feel,
-- but only the admin decides: keep a meal over a no, or drop it.
--
-- All changes go through the functions below (each acts only as the signed-in
-- person); the tables themselves are read-only to the app. The feature is
-- hidden in the app for now (MEAL_PLANS_ENABLED in src/config.ts).
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. Tables ------------------------------------------------------------------------------------
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null constraint families_name_ok check (
    char_length(btrim(name)) between 1 and 40 and public.plain_text_ok(name, false)
  ),
  admin_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'invited'
    constraint family_members_status_known check (status in ('invited', 'active')),
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
-- One family at a time.
create unique index if not exists family_members_one_family_idx
  on public.family_members (user_id) where status = 'active';
create index if not exists family_members_user_idx on public.family_members (user_id);

create table if not exists public.meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one of these: your own plan, or your family's.
  user_id uuid references public.users (id) on delete cascade,
  family_id uuid references public.families (id) on delete cascade,
  plan_date date not null,
  meal_slot meal_slot not null,
  post_id uuid references public.posts (id) on delete cascade,
  title text constraint meal_plan_items_title_ok check (
    title is null or (char_length(btrim(title)) between 1 and 80 and public.plain_text_ok(title, false))
  ),
  added_by uuid references public.users (id) on delete set null,
  status text not null default 'in'
    constraint meal_plan_items_status_known check (status in ('in', 'pending')),
  decided_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint meal_plan_items_one_plan check ((user_id is null) <> (family_id is null)),
  constraint meal_plan_items_has_meal check (post_id is not null or title is not null)
);
create index if not exists meal_plan_items_user_date_idx on public.meal_plan_items (user_id, plan_date)
  where user_id is not null;
create index if not exists meal_plan_items_family_date_idx on public.meal_plan_items (family_id, plan_date)
  where family_id is not null;
create index if not exists meal_plan_items_post_idx on public.meal_plan_items (post_id)
  where post_id is not null;

create table if not exists public.meal_plan_votes (
  item_id uuid not null references public.meal_plan_items (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  approve boolean not null,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists meal_plan_votes_user_idx on public.meal_plan_votes (user_id);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.meal_plan_items enable row level security;
alter table public.meal_plan_votes enable row level security;
revoke all on public.families, public.family_members, public.meal_plan_items, public.meal_plan_votes
  from anon, authenticated;
grant select on public.families, public.family_members, public.meal_plan_items, public.meal_plan_votes
  to authenticated;

-- 2. Who's in which family (definer helpers, so policies don't recurse) -------------------------
create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id from public.family_members m
  where m.user_id = auth.uid() and m.status = 'active'
  limit 1;
$$;
revoke all on function public.my_family_id() from public, anon;
grant execute on function public.my_family_id() to authenticated;

-- 3. Read rules --------------------------------------------------------------------------------
-- A family: its members, and anyone it has invited (so they can see who's asking).
drop policy if exists "families visible to members and invitees" on public.families;
create policy "families visible to members and invitees" on public.families
  for select to authenticated using (
    id = public.my_family_id()
    or exists (select 1 from public.family_members m where m.family_id = id and m.user_id = auth.uid())
  );

-- Membership: everyone in your family (and its invites); your own invites.
drop policy if exists "family members visible to the family" on public.family_members;
create policy "family members visible to the family" on public.family_members
  for select to authenticated using (
    family_id = public.my_family_id() or user_id = auth.uid()
  );

-- Plan items: your own plan, and your family's.
drop policy if exists "plan items visible to their plan" on public.meal_plan_items;
create policy "plan items visible to their plan" on public.meal_plan_items
  for select to authenticated using (
    user_id = auth.uid() or (family_id is not null and family_id = public.my_family_id())
  );

-- Votes: wherever the item is visible (the subquery runs under the policy above).
drop policy if exists "plan votes visible with their item" on public.meal_plan_votes;
create policy "plan votes visible with their item" on public.meal_plan_votes
  for select to authenticated using (
    exists (select 1 from public.meal_plan_items i where i.id = item_id)
  );

-- 4. Families ----------------------------------------------------------------------------------
create or replace function public.create_family(family_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if public.my_family_id() is not null then
    raise exception 'You''re already in a family. Leave it first.';
  end if;
  if (select count(*) from public.families where admin_id = me) >= 3 then
    raise exception 'Too many families. Delete one first.';
  end if;
  insert into public.families (name, admin_id) values (btrim(family_name), me) returning id into fid;
  insert into public.family_members (family_id, user_id, status, invited_by) values (fid, me, 'active', me);
  return fid;
end;
$$;

-- 'ok', 'not_found' (no such handle, or a block between you), 'self',
-- 'already' (in your family or already invited), 'full'.
create or replace function public.invite_to_family(invitee_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
  who uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if fid is null or not exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'Only the family admin can invite people.';
  end if;
  select u.id into who from public.users u
  where lower(u.handle) = lower(btrim(invitee_handle, ' @'));
  if who is null or public.is_blocked_pair(me, who) then return 'not_found'; end if;
  if who = me then return 'self'; end if;
  if exists (select 1 from public.family_members m where m.family_id = fid and m.user_id = who) then
    return 'already';
  end if;
  if (select count(*) from public.family_members m where m.family_id = fid) >= 12 then
    return 'full';
  end if;
  insert into public.family_members (family_id, user_id, status, invited_by) values (fid, who, 'invited', me);
  return 'ok';
end;
$$;

create or replace function public.respond_family_invite(target_family uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.family_members m
    where m.family_id = target_family and m.user_id = me and m.status = 'invited'
  ) then
    raise exception 'That invite isn''t there anymore.';
  end if;
  if not accept then
    delete from public.family_members where family_id = target_family and user_id = me;
    return;
  end if;
  if public.my_family_id() is not null then
    raise exception 'Leave your family before joining another.';
  end if;
  update public.family_members set status = 'active'
  where family_id = target_family and user_id = me;
end;
$$;

-- Leave your family. The admin can't leave it with people in it; they remove
-- people or delete the family.
create or replace function public.leave_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if fid is null then return; end if;
  if exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'You''re the admin. Delete the family instead.';
  end if;
  delete from public.meal_plan_votes v using public.meal_plan_items i
  where v.item_id = i.id and i.family_id = fid and v.user_id = me;
  delete from public.family_members where family_id = fid and user_id = me;
end;
$$;

-- Admin only: take someone out of the family, or withdraw an invite.
create or replace function public.remove_family_member(member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if fid is null or not exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'Only the family admin can remove people.';
  end if;
  if member = me then raise exception 'You''re the admin. Delete the family instead.'; end if;
  delete from public.meal_plan_votes v using public.meal_plan_items i
  where v.item_id = i.id and i.family_id = fid and v.user_id = member;
  delete from public.family_members where family_id = fid and user_id = member;
end;
$$;

-- Admin only: the family and its plan are gone; everyone is back on their own plan.
create or replace function public.delete_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if fid is null or not exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'Only the family admin can delete the family.';
  end if;
  delete from public.families where id = fid;
end;
$$;

-- 5. The plan ----------------------------------------------------------------------------------
-- Add a meal: a post (that you can see) or a name. Goes on your family's plan
-- if you're in one, otherwise your own. Pending if you're a family member who
-- isn't the admin.
create or replace function public.add_plan_item(
  on_date date,
  slot text,
  plan_post uuid default null,
  meal_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
  is_admin boolean := false;
  t text := nullif(btrim(coalesce(meal_title, '')), '');
  item uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if slot is null or slot not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'Pick breakfast, lunch, dinner or a snack.';
  end if;
  if on_date is null or on_date < current_date - 31 or on_date > current_date + 366 then
    raise exception 'Pick a day within the next year.';
  end if;
  if plan_post is null and t is null then raise exception 'Pick a meal to add.'; end if;
  if plan_post is not null and not exists (
    select 1 from public.posts p where p.id = plan_post and not public.is_blocked_pair(me, p.user_id)
  ) then
    raise exception 'That post isn''t available.';
  end if;
  if fid is not null then
    is_admin := exists (select 1 from public.families f where f.id = fid and f.admin_id = me);
    if (select count(*) from public.meal_plan_items i
        where i.family_id = fid and i.plan_date = on_date and i.meal_slot = slot::public.meal_slot) >= 8 then
      raise exception 'That meal is full. Remove something first.';
    end if;
    insert into public.meal_plan_items (family_id, plan_date, meal_slot, post_id, title, added_by, status, decided_by)
    values (fid, on_date, slot::public.meal_slot, plan_post, t, me,
            case when is_admin then 'in' else 'pending' end,
            case when is_admin then me else null end)
    returning id into item;
  else
    if (select count(*) from public.meal_plan_items i
        where i.user_id = me and i.plan_date = on_date and i.meal_slot = slot::public.meal_slot) >= 8 then
      raise exception 'That meal is full. Remove something first.';
    end if;
    insert into public.meal_plan_items (user_id, plan_date, meal_slot, post_id, title, added_by, status, decided_by)
    values (me, on_date, slot::public.meal_slot, plan_post, t, me, 'in', me)
    returning id into item;
  end if;
  return item;
end;
$$;

-- Take a meal off: anything on your own plan; on a family plan, the admin can
-- remove anything and a member can take back their own pending meal.
create or replace function public.remove_plan_item(item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  it public.meal_plan_items;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select * into it from public.meal_plan_items where id = item;
  if not found then return; end if;
  if it.user_id = me
     or (it.family_id is not null and it.family_id = public.my_family_id() and (
           exists (select 1 from public.families f where f.id = it.family_id and f.admin_id = me)
           or (it.added_by = me and it.status = 'pending')))
  then
    delete from public.meal_plan_items where id = item;
  else
    raise exception 'You can''t remove that meal.';
  end if;
end;
$$;

-- Admin only: keep a meal (approve it, or keep it over a no) or drop it.
create or replace function public.decide_plan_item(item uuid, keep boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select i.family_id into fid from public.meal_plan_items i where i.id = item;
  if fid is null or fid is distinct from public.my_family_id()
     or not exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'Only the family admin can decide.';
  end if;
  if keep then
    update public.meal_plan_items set status = 'in', decided_by = me where id = item;
    -- The no votes were heard and overruled; the meal starts clean.
    delete from public.meal_plan_votes where item_id = item;
  else
    delete from public.meal_plan_items where id = item;
  end if;
end;
$$;

-- Family members (not the admin, who decides instead) say yes or no to a meal.
-- Voting the same way twice is fine; null clears your vote.
create or replace function public.vote_plan_item(item uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select i.family_id into fid from public.meal_plan_items i where i.id = item;
  if fid is null or fid is distinct from public.my_family_id() then
    raise exception 'That meal isn''t on your family''s plan.';
  end if;
  if exists (select 1 from public.families f where f.id = fid and f.admin_id = me) then
    raise exception 'You''re the admin: keep it or drop it instead.';
  end if;
  if approve is null then
    delete from public.meal_plan_votes where item_id = item and user_id = me;
  else
    insert into public.meal_plan_votes (item_id, user_id, approve) values (item, me, approve)
    on conflict (item_id, user_id) do update set approve = excluded.approve, created_at = now();
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_family(text)', 'invite_to_family(text)', 'respond_family_invite(uuid, boolean)',
    'leave_family()', 'remove_family_member(uuid)', 'delete_family()',
    'add_plan_item(date, text, uuid, text)', 'remove_plan_item(uuid)',
    'decide_plan_item(uuid, boolean)', 'vote_plan_item(uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

-- 6. Rate limits (same meter as everything else people create) ---------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('families',        'family',        5,   '1 day'),
      ('family_members',  'family_invite', 30,  '1 hour'),
      ('meal_plan_items', 'plan_item',     200, '1 hour'),
      ('meal_plan_votes', 'plan_vote',     300, '1 hour')
    ) v(tbl, act, n, win)
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_limit_rate', r.tbl);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.limit_rate(%L, %L, %L)',
      r.tbl || '_limit_rate', r.tbl, r.act, r.n::text, r.win);
  end loop;
end
$$;
