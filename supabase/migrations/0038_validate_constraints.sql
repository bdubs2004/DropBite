-- 0038: Check the rules against the rows already there, where they fit.
--
-- Every rule the migrations add (a CHECK or a foreign key) is added NOT VALID:
-- it applies to every new and changed row straight away, but doesn't make the
-- migration fail because of rows that are already there. That matters when the
-- migrations run again on a database that's in use (upgrade_all.sql): an early
-- rule, later relaxed, would otherwise trip over rows the later rule allowed.
-- 0007's "a message must carry something" did exactly that on a "Dana left the
-- chat" line.
--
-- This last step then checks each rule against the existing rows. Where they
-- all fit, which is the normal case, the rule is marked validated, exactly as on
-- a fresh install. Where some don't, the rule stays in force for new rows and a
-- warning names it; nothing fails.
--
-- Safe to run more than once. Already folded into schema.sql.

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.connamespace = 'public'::regnamespace
      and c.contype in ('c', 'f')
      and not c.convalidated
    order by 1, 2
  loop
    begin
      execute format('alter table %s validate constraint %I', r.tbl, r.conname);
    exception when check_violation or foreign_key_violation then
      raise warning 'Rule "%" on % holds for new rows; some older rows don''t meet it.', r.conname, r.tbl;
    end;
  end loop;
end
$$;
