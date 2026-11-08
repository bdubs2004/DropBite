-- 0047: Give a planned meal a recipe afterwards.
--
-- "Pizza night" went on the plan as just a name; now it gets a card (or just
-- the ingredients it needs, for the grocery list). The card is one of your
-- own recipes (0045). Who can: on your own plan, you; on a family plan, the
-- admin, or whoever added the meal.
--
-- Safe to run more than once. Already folded into schema.sql.

create or replace function public.set_plan_item_recipe(item uuid, plan_recipe uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  fid uuid := public.my_family_id();
  it record;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  select i.user_id, i.family_id, i.added_by into it from public.meal_plan_items i where i.id = item;
  -- coalesce: a family meal has no user_id, and a NULL here must mean no.
  if not found or not coalesce(
    it.user_id = me
    or (it.family_id is not null and it.family_id = fid and (
      coalesce(it.added_by = me, false)
      or exists (select 1 from public.families f where f.id = fid and f.admin_id = me)
    )),
    false
  ) then
    raise exception 'You can''t change that meal.';
  end if;
  if plan_recipe is not null
     and not exists (select 1 from public.my_recipes r where r.id = plan_recipe and r.user_id = me) then
    raise exception 'That recipe isn''t yours.';
  end if;
  update public.meal_plan_items set recipe_id = plan_recipe where id = item;
end;
$$;
revoke all on function public.set_plan_item_recipe(uuid, uuid) from public, anon;
grant execute on function public.set_plan_item_recipe(uuid, uuid) to authenticated;
