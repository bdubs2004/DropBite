-- 0034: AI cost limits, and recipe cards that can't break the app.
--
--   1. AI allowance. Recipe cards and nutrition estimates cost money per call.
--      consume_ai_quota() already capped each person per day; it now also caps
--      each person per minute (a script can't burn a day's allowance in a
--      second) and the whole app per day, which is the ceiling on what any
--      number of accounts can spend together. The edge functions pass the
--      limits (AI_DAILY_LIMIT, AI_PER_MINUTE, AI_GLOBAL_DAILY_LIMIT); callers
--      that only pass the daily limit still work, with the defaults.
--   2. Recipe JSON. ingredients, steps and nutrition were only size-checked.
--      Everyone who opens a post draws its card, and an object where text
--      belongs crashes the screen drawing it, so a scripted client could
--      break the app for everyone who scrolled past one post. They now have
--      to be the documented shape.
--
-- Safe to run more than once. Already folded into schema.sql.

-- 1. AI allowance ---------------------------------------------------------------------------
alter table public.ai_usage add column if not exists minute_start timestamptz;
alter table public.ai_usage add column if not exists minute_count integer not null default 0;

create table if not exists public.ai_usage_global (
  day date primary key,
  count integer not null default 0
);
alter table public.ai_usage_global enable row level security;
revoke all on table public.ai_usage_global from anon, authenticated;

drop function if exists public.consume_ai_quota(uuid, integer);
create or replace function public.consume_ai_quota(
  target uuid,
  daily_limit integer,
  per_minute integer default 6,
  global_daily integer default 2000
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  this_minute timestamptz := date_trunc('minute', now());
  used integer;
  burst integer;
  started timestamptz;
  everyone integer;
begin
  if global_daily < 1 then return false; end if;

  -- One row per person per day, locked so parallel calls count one at a time.
  insert into public.ai_usage (user_id, day, count, minute_start, minute_count)
  values (target, today, 0, this_minute, 0)
  on conflict (user_id, day) do nothing;
  select u.count, u.minute_start, u.minute_count into used, started, burst
  from public.ai_usage u
  where u.user_id = target and u.day = today
  for update;
  if started is distinct from this_minute then burst := 0; end if;

  -- Refused calls cost nothing, so they don't use up the allowance either.
  if used >= daily_limit or burst >= per_minute then
    return false;
  end if;

  -- The app-wide ceiling: counted only when there's room.
  insert into public.ai_usage_global as g (day, count) values (today, 1)
  on conflict (day) do update set count = g.count + 1
    where g.count < global_daily
  returning g.count into everyone;
  if everyone is null then return false; end if;

  update public.ai_usage u
  set count = used + 1, minute_start = this_minute, minute_count = burst + 1
  where u.user_id = target and u.day = today;
  return true;
end;
$$;
revoke all on function public.consume_ai_quota(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer, integer, integer) to service_role;

-- 2. Recipe JSON ----------------------------------------------------------------------------
-- Nutrition: an object of non-negative numbers (totals, so generous bounds).
create or replace function public.recipe_nutrition_ok(n jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select n is null
      or jsonb_typeof(n) = 'null'
      or (jsonb_typeof(n) = 'object'
          and not exists (
            select 1 from jsonb_each(n) e
            where jsonb_typeof(e.value) <> 'number'
               or (e.value)::text::numeric < 0
               or (e.value)::text::numeric > 100000000));
$$;

-- Ingredients: objects whose item is text and whose quantity and unit are text
-- or a number (older cards have "quantity": 1), capped like the app's fields,
-- and whose weight, USDA id and nutrition are numbers.
create or replace function public.recipe_ingredients_ok(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(j) e(v)
       where jsonb_typeof(v) <> 'object'
          or jsonb_typeof(v -> 'item') is distinct from 'string'
          or char_length(v ->> 'item') > 120
          or coalesce(jsonb_typeof(v -> 'quantity'), 'null') not in ('string', 'number', 'null')
          or char_length(coalesce(v ->> 'quantity', '')) > 32
          or coalesce(jsonb_typeof(v -> 'unit'), 'null') not in ('string', 'number', 'null')
          or char_length(coalesce(v ->> 'unit', '')) > 32
          or coalesce(jsonb_typeof(v -> 'grams'), 'null') not in ('number', 'null')
          or (jsonb_typeof(v -> 'grams') = 'number'
              and ((v ->> 'grams')::numeric < 0 or (v ->> 'grams')::numeric > 20000))
          or coalesce(jsonb_typeof(v -> 'fdc_id'), 'null') not in ('number', 'null')
          or not public.recipe_nutrition_ok(v -> 'nutrition'));
$$;

-- Steps: text, at most 500 characters each.
create or replace function public.recipe_steps_ok(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(j) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(j) e(v)
       where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500);
$$;

-- The checks run as whoever saves the card, so signed-in users need to be
-- able to call them. They're pure: they read nothing but their argument.
revoke all on function public.recipe_nutrition_ok(jsonb) from public, anon;
revoke all on function public.recipe_ingredients_ok(jsonb) from public, anon;
revoke all on function public.recipe_steps_ok(jsonb) from public, anon;
grant execute on function public.recipe_nutrition_ok(jsonb) to authenticated, service_role;
grant execute on function public.recipe_ingredients_ok(jsonb) to authenticated, service_role;
grant execute on function public.recipe_steps_ok(jsonb) to authenticated, service_role;

-- NOT VALID: new and edited cards are checked from now on. Cards saved before
-- are then checked too, if they all pass; if any don't, the app's own reader
-- (cleanRecipe) still draws them safely, and verify.sql says how many.
alter table public.recipes drop constraint if exists recipes_ingredients_shape;
alter table public.recipes
  add constraint recipes_ingredients_shape check (public.recipe_ingredients_ok(ingredients)) not valid;
alter table public.recipes drop constraint if exists recipes_steps_shape;
alter table public.recipes
  add constraint recipes_steps_shape check (public.recipe_steps_ok(steps)) not valid;
alter table public.recipes drop constraint if exists recipes_nutrition_shape;
alter table public.recipes
  add constraint recipes_nutrition_shape check (public.recipe_nutrition_ok(nutrition)) not valid;

do $$
begin
  alter table public.recipes validate constraint recipes_ingredients_shape;
  alter table public.recipes validate constraint recipes_steps_shape;
  alter table public.recipes validate constraint recipes_nutrition_shape;
exception when check_violation then
  raise warning 'Some recipe cards saved before 0034 are malformed; new ones are checked. verify.sql lists them.';
end
$$;
