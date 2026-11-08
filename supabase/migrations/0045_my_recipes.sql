-- 0045: Your own recipes, for the meal plan.
--
-- A meal you type on the plan ("Taco night") can carry a recipe card, written
-- by hand or formatted by the AI, the same structured card a post has. It's
-- saved to your recipes so you can put it on the plan again another week.
--
-- Yours alone, except that your family can read one that's on the family
-- plan (so everyone can see how to make Tuesday's dinner). The app writes them
-- directly; row-level security keeps each person to their own, and the same
-- checks as a post's recipe keep the card's shape honest.
--
-- add_plan_item gains a fifth argument, plan_recipe: one of your own recipes.
--
-- Safe to run more than once. Already folded into schema.sql.

create table if not exists public.my_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  title text not null constraint my_recipes_title_ok check (
    char_length(btrim(title)) between 1 and 120 and public.plain_text_ok(title, false)
  ),
  ingredients jsonb not null default '[]'::jsonb constraint my_recipes_ingredients_ok check (
    jsonb_typeof(ingredients) = 'array'
    and jsonb_array_length(ingredients) <= 50
    and pg_column_size(ingredients) <= 16384
    and public.recipe_ingredients_ok(ingredients)
  ),
  steps jsonb not null default '[]'::jsonb constraint my_recipes_steps_ok check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) <= 50
    and pg_column_size(steps) <= 16384
    and public.recipe_steps_ok(steps)
  ),
  cook_time_minutes integer constraint my_recipes_cook_time_range
    check (cook_time_minutes is null or cook_time_minutes between 0 and 6000),
  ai_generated boolean not null default false,
  user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists my_recipes_user_idx on public.my_recipes (user_id, updated_at desc);

alter table public.meal_plan_items
  add column if not exists recipe_id uuid references public.my_recipes (id) on delete set null;
create index if not exists meal_plan_items_recipe_idx on public.meal_plan_items (recipe_id)
  where recipe_id is not null;

alter table public.my_recipes enable row level security;
revoke all on public.my_recipes from anon, authenticated;
grant select, delete on public.my_recipes to authenticated;
grant insert (title, ingredients, steps, cook_time_minutes, ai_generated, user_edited)
  on public.my_recipes to authenticated;
grant update (title, ingredients, steps, cook_time_minutes, user_edited, updated_at)
  on public.my_recipes to authenticated;

drop policy if exists "my recipes readable by me and my family's plan" on public.my_recipes;
create policy "my recipes readable by me and my family's plan" on public.my_recipes
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.meal_plan_items i
      where i.recipe_id = my_recipes.id
        and i.family_id is not null
        and i.family_id = public.my_family_id()
    )
  );
drop policy if exists "my recipes: add my own" on public.my_recipes;
create policy "my recipes: add my own" on public.my_recipes
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "my recipes: change my own" on public.my_recipes;
create policy "my recipes: change my own" on public.my_recipes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "my recipes: delete my own" on public.my_recipes;
create policy "my recipes: delete my own" on public.my_recipes
  for delete to authenticated using (user_id = auth.uid());

-- At most 300 each: plenty for a home cook, not a place to dump data.
create or replace function public.my_recipes_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.my_recipes r where r.user_id = new.user_id) >= 300 then
    raise exception 'You have 300 recipes saved. Delete one first.';
  end if;
  return new;
end;
$$;
revoke all on function public.my_recipes_cap() from public, anon, authenticated;
drop trigger if exists my_recipes_cap on public.my_recipes;
create trigger my_recipes_cap before insert on public.my_recipes
  for each row execute function public.my_recipes_cap();

drop trigger if exists my_recipes_limit_rate on public.my_recipes;
create trigger my_recipes_limit_rate before insert on public.my_recipes
  for each row execute function public.limit_rate('my_recipe', '60', '1 hour');

-- add_plan_item, now with an optional recipe of your own.
drop function if exists public.add_plan_item(date, text, uuid, text);
create or replace function public.add_plan_item(
  on_date date,
  slot text,
  plan_post uuid default null,
  meal_title text default null,
  plan_recipe uuid default null
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
  rt text;
  item uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if slot is null or slot not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'Pick breakfast, lunch, dinner or a snack.';
  end if;
  if on_date is null or on_date < current_date - 31 or on_date > current_date + 366 then
    raise exception 'Pick a day within the next year.';
  end if;
  if plan_recipe is not null then
    select r.title into rt from public.my_recipes r where r.id = plan_recipe and r.user_id = me;
    if rt is null then raise exception 'That recipe isn''t yours.'; end if;
    t := coalesce(t, left(btrim(rt), 80));
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
    insert into public.meal_plan_items (family_id, plan_date, meal_slot, post_id, title, recipe_id, added_by, status, decided_by)
    values (fid, on_date, slot::public.meal_slot, plan_post, t, plan_recipe, me,
            case when is_admin then 'in' else 'pending' end,
            case when is_admin then me else null end)
    returning id into item;
  else
    if (select count(*) from public.meal_plan_items i
        where i.user_id = me and i.plan_date = on_date and i.meal_slot = slot::public.meal_slot) >= 8 then
      raise exception 'That meal is full. Remove something first.';
    end if;
    insert into public.meal_plan_items (user_id, plan_date, meal_slot, post_id, title, recipe_id, added_by, status, decided_by)
    values (me, on_date, slot::public.meal_slot, plan_post, t, plan_recipe, me, 'in', me)
    returning id into item;
  end if;
  return item;
end;
$$;
revoke all on function public.add_plan_item(date, text, uuid, text, uuid) from public, anon;
grant execute on function public.add_plan_item(date, text, uuid, text, uuid) to authenticated;
