-- 0044: Meal plan notifications.
--
-- On a family plan, everyone else in the family hears when someone adds a
-- meal: "Mike asked to add Chicken nuggets for Thursday dinner" when it waits
-- for the admin, "Mom added Pot roast for Wednesday dinner" when it goes
-- straight on. And whoever asked hears when the admin approves it.
--
-- They're ordinary Activity rows (the notifications table), written by the
-- triggers below as the database itself, so the app can't fake one. The meal's
-- name and day go in `detail` so the line still reads right later; the row
-- disappears with the meal (plan_item_id) if the meal is dropped or the family
-- is deleted. notify-activity pushes them like likes and comments.
--
-- Safe to run more than once. Already folded into schema.sql.

alter table public.notifications drop constraint if exists notifications_type_allowed;
alter table public.notifications
  add constraint notifications_type_allowed check (
    type in ('like', 'comment', 'repost', 'share', 'tag',
             'follow', 'follow_back', 'comment_like', 'reply',
             'plan_add', 'plan_request', 'plan_approved')
  ) not valid;
do $$
begin
  alter table public.notifications validate constraint notifications_type_allowed;
exception when check_violation then
  raise warning 'Rule "notifications_type_allowed" holds for new rows; some older rows don''t meet it.';
end
$$;

alter table public.notifications
  add column if not exists plan_item_id uuid references public.meal_plan_items (id) on delete cascade;
alter table public.notifications add column if not exists detail text;
alter table public.notifications drop constraint if exists notifications_detail_len;
alter table public.notifications
  add constraint notifications_detail_len check (detail is null or char_length(detail) <= 160) not valid;
do $$
begin
  alter table public.notifications validate constraint notifications_detail_len;
exception when check_violation then
  raise warning 'Rule "notifications_detail_len" holds for new rows; some older rows don''t meet it.';
end
$$;
create index if not exists notifications_plan_item_idx
  on public.notifications (plan_item_id) where plan_item_id is not null;

-- "Pot roast for Wednesday dinner": the recipe's title, else the first line
-- of the post, else the typed name; then the day and the meal.
create or replace function public.plan_item_label(item uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(
           nullif(btrim((select r.title from public.recipes r where r.post_id = i.post_id limit 1)), ''),
           nullif(btrim(split_part((select p.blurb from public.posts p where p.id = i.post_id), E'\n', 1)), ''),
           nullif(btrim(i.title), ''),
           'A meal'), 90)
         || ' for ' || to_char(i.plan_date, 'FMDay') || ' ' || i.meal_slot::text
  from public.meal_plan_items i
  where i.id = item;
$$;
revoke all on function public.plan_item_label(uuid) from public, anon, authenticated;

-- Someone added a meal to a family plan: tell everyone else in the family.
create or replace function public.notify_plan_item_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
begin
  if new.family_id is null or new.added_by is null then
    return new;
  end if;
  label := public.plan_item_label(new.id);
  insert into public.notifications (user_id, actor_id, type, post_id, plan_item_id, detail)
  select m.user_id, new.added_by,
         case when new.status = 'pending' then 'plan_request' else 'plan_add' end,
         new.post_id, new.id, label
  from public.family_members m
  where m.family_id = new.family_id
    and m.status = 'active'
    and m.user_id <> new.added_by
    and not public.is_blocked_pair(m.user_id, new.added_by)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.notify_plan_item_added() from public, anon, authenticated;
drop trigger if exists meal_plan_items_notify_added on public.meal_plan_items;
create trigger meal_plan_items_notify_added after insert on public.meal_plan_items
  for each row execute function public.notify_plan_item_added();

-- The admin approved a meal someone asked for: tell them.
create or replace function public.notify_plan_item_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'in'
     and new.family_id is not null
     and new.added_by is not null and new.decided_by is not null
     and new.added_by <> new.decided_by
     and not public.is_blocked_pair(new.added_by, new.decided_by) then
    insert into public.notifications (user_id, actor_id, type, post_id, plan_item_id, detail)
    values (new.added_by, new.decided_by, 'plan_approved', new.post_id, new.id,
            public.plan_item_label(new.id))
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_plan_item_approved() from public, anon, authenticated;
drop trigger if exists meal_plan_items_notify_approved on public.meal_plan_items;
create trigger meal_plan_items_notify_approved after update of status on public.meal_plan_items
  for each row execute function public.notify_plan_item_approved();
