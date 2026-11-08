-- 0046: The grocery list.
--
-- The list itself is worked out by the app from the week's meal plan: every
-- ingredient on every recipe that week, added up. What's stored here is what
-- people DID with it: ticked "have it" at home, ticked "got it" at the store,
-- or added something the recipes don't cover ("paper towels"). One list per
-- plan per week: your own, or your family's, shared, so whoever is at the
-- store sees what the rest already have.
--
-- Read-only to the app; every change goes through the functions below, which
-- pick the right list (yours, or your family's) themselves.
--
-- Safe to run more than once. Already folded into schema.sql.

create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one of these: your own list, or your family's.
  user_id uuid references public.users (id) on delete cascade,
  family_id uuid references public.families (id) on delete cascade,
  -- The Monday the week starts on.
  week_start date not null,
  -- Which item: the ingredient's name, lower case ("ground beef").
  item_key text not null constraint grocery_items_key_ok check (
    char_length(item_key) between 1 and 80 and public.plain_text_ok(item_key, false)
  ),
  -- Something added by hand, and how it was written.
  custom boolean not null default false,
  label text constraint grocery_items_label_ok check (
    label is null or (char_length(btrim(label)) between 1 and 80 and public.plain_text_ok(label, false))
  ),
  have boolean not null default false,
  got boolean not null default false,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint grocery_items_one_list check ((user_id is null) <> (family_id is null))
);
create unique index if not exists grocery_items_one_per_item
  on public.grocery_items (coalesce(family_id, user_id), week_start, item_key);
create index if not exists grocery_items_family_idx on public.grocery_items (family_id, week_start)
  where family_id is not null;
create index if not exists grocery_items_user_idx on public.grocery_items (user_id, week_start)
  where user_id is not null;

alter table public.grocery_items enable row level security;
revoke all on public.grocery_items from anon, authenticated;
grant select on public.grocery_items to authenticated;
drop policy if exists "grocery list visible to its plan" on public.grocery_items;
create policy "grocery list visible to its plan" on public.grocery_items
  for select to authenticated using (
    (user_id = auth.uid() and public.my_family_id() is null)
    or (family_id is not null and family_id = public.my_family_id())
  );

-- Tick or untick an item (have it at home / got it at the store). Creates
-- the row the first time.
create or replace function public.set_grocery_item(week date, item text, has_it boolean, got_it boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
  wk date := date_trunc('week', week)::date;
  k text := lower(btrim(coalesce(item, '')));
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if week is null or week < current_date - 62 or week > current_date + 400 then
    raise exception 'Pick a week within the next year.';
  end if;
  if char_length(k) not between 1 and 80 then raise exception 'Pick an item.'; end if;
  if (select count(*) from public.grocery_items g
      where coalesce(g.family_id, g.user_id) = coalesce(fid, me) and g.week_start = wk) >= 300
     and not exists (select 1 from public.grocery_items g
      where coalesce(g.family_id, g.user_id) = coalesce(fid, me) and g.week_start = wk and g.item_key = k) then
    raise exception 'That list is full.';
  end if;
  insert into public.grocery_items (user_id, family_id, week_start, item_key, have, got, updated_by)
  values (case when fid is null then me end, fid, wk, k, coalesce(has_it, false), coalesce(got_it, false), me)
  on conflict (coalesce(family_id, user_id), week_start, item_key) do update
    set have = coalesce(has_it, false), got = coalesce(got_it, false),
        updated_by = me, updated_at = now();
end;
$$;

-- Add something the recipes don't cover.
create or replace function public.add_grocery_item(week date, item_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
  wk date := date_trunc('week', week)::date;
  l text := btrim(coalesce(item_label, ''));
  k text := lower(btrim(coalesce(item_label, '')));
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if week is null or week < current_date - 62 or week > current_date + 400 then
    raise exception 'Pick a week within the next year.';
  end if;
  if char_length(l) not between 1 and 80 then raise exception 'Type what to add.'; end if;
  if (select count(*) from public.grocery_items g
      where coalesce(g.family_id, g.user_id) = coalesce(fid, me) and g.week_start = wk) >= 300 then
    raise exception 'That list is full.';
  end if;
  insert into public.grocery_items (user_id, family_id, week_start, item_key, custom, label, updated_by)
  values (case when fid is null then me end, fid, wk, k, true, l, me)
  on conflict (coalesce(family_id, user_id), week_start, item_key) do update
    set custom = true, label = excluded.label, updated_by = me, updated_at = now();
  return k;
end;
$$;

-- Take an item off: one added by hand goes; a ticked recipe item goes back
-- to unticked.
create or replace function public.remove_grocery_item(week date, item text)
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
  delete from public.grocery_items g
  where coalesce(g.family_id, g.user_id) = coalesce(fid, me)
    and g.week_start = date_trunc('week', week)::date
    and g.item_key = lower(btrim(coalesce(item, '')));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'set_grocery_item(date, text, boolean, boolean)',
    'add_grocery_item(date, text)',
    'remove_grocery_item(date, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

drop trigger if exists grocery_items_limit_rate on public.grocery_items;
create trigger grocery_items_limit_rate before insert on public.grocery_items
  for each row execute function public.limit_rate('grocery_item', '400', '1 hour');
