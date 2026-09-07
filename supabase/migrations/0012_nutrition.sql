-- NiblGo: nutrition on recipe cards
--
-- Run this on an existing database. A fresh `schema.sql` already includes it.
-- Safe to run more than once.

-- ------------------------------------------------------------- nutrition
-- Recipe nutrition is stored as TOTALS for the whole recipe, never
-- per-serving. Servings is a display divisor the user can change afterwards
-- without anything being recomputed — which is the point: the app cannot know
-- that a pie feeds four unless someone says so.
alter table public.recipes
  add column if not exists servings integer not null default 1,
  add column if not exists nutrition jsonb,
  add column if not exists nutrition_source text;

alter table public.recipes
  drop constraint if exists recipes_servings_range,
  add  constraint recipes_servings_range check (servings between 1 and 100);

-- Where the numbers came from, so the card can say so honestly:
--   usda      — looked up in USDA FoodData Central
--   estimated — the model's guess, used only where USDA had no match
--   demo      — seeded demo-mode data, not a claim about real food
alter table public.recipes
  drop constraint if exists recipes_nutrition_source_allowed,
  add  constraint recipes_nutrition_source_allowed check (
    nutrition_source is null or nutrition_source in ('usda', 'estimated', 'demo')
  );

-- Bounded like the other jsonb columns so a scripted client cannot store a
-- blob here. Totals only; the keys are fixed.
alter table public.recipes
  drop constraint if exists recipes_nutrition_bounded,
  add  constraint recipes_nutrition_bounded check (
    nutrition is null
    or (jsonb_typeof(nutrition) = 'object' and pg_column_size(nutrition) <= 2048)
  );

-- Cache of USDA lookups, keyed by the normalised ingredient term.
-- "chicken breast" is going to be looked up thousands of times; the USDA API
-- is rate limited per key, so not caching would make the feature fail at
-- exactly the moment it became popular.
create table if not exists public.nutrition_cache (
  term text primary key constraint nutrition_cache_term_len check (char_length(term) between 1 and 120),
  fdc_id bigint,
  description text constraint nutrition_cache_desc_len check (description is null or char_length(description) <= 300),
  -- Nutrients per 100 g, exactly as USDA reports them.
  per_100g jsonb not null,
  source text not null default 'usda'
    constraint nutrition_cache_source_allowed check (source in ('usda', 'estimated', 'demo')),
  created_at timestamptz not null default now()
);

alter table public.nutrition_cache enable row level security;
-- No policies and no grants, deliberately: only the lookup edge function
-- touches this, through the service role. Same shape as ai_usage.
revoke all on table public.nutrition_cache from anon, authenticated;
