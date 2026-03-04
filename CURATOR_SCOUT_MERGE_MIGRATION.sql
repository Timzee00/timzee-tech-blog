-- CURATOR_SCOUT_MERGE_MIGRATION.sql
-- Purpose: merge Scout controls into existing curator_settings without changing existing RLS policies.

begin;

-- Guard: curator_settings must already exist in this project.
do $$
begin
  if to_regclass('public.curator_settings') is null then
    raise exception 'public.curator_settings does not exist. Run base schema setup first.';
  end if;
end $$;

alter table if exists public.curator_settings
  add column if not exists scout_enabled boolean default true;

alter table if exists public.curator_settings
  add column if not exists scout_interval_minutes integer default 60;

alter table if exists public.curator_settings
  add column if not exists scout_last_run_at timestamp;

alter table if exists public.curator_settings
  add column if not exists scout_last_status text;

-- Backfill from legacy fields where available, across different schema variants.
do $$
declare
  has_enabled boolean;
  has_updated_at boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'curator_settings'
      and column_name = 'enabled'
  ) into has_enabled;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'curator_settings'
      and column_name = 'updated_at'
  ) into has_updated_at;

  if has_enabled then
    execute '
      update public.curator_settings
      set
        scout_enabled = coalesce(scout_enabled, enabled, true),
        scout_interval_minutes = coalesce(scout_interval_minutes, 60)
    ';
  else
    execute '
      update public.curator_settings
      set
        scout_enabled = coalesce(scout_enabled, true),
        scout_interval_minutes = coalesce(scout_interval_minutes, 60)
    ';
  end if;

  if has_updated_at then
    execute '
      update public.curator_settings
      set updated_at = coalesce(updated_at, now())
    ';
  end if;
end $$;

-- Keep interval sane for UI + scheduler compatibility.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'curator_settings_scout_interval_chk'
      and conrelid = 'public.curator_settings'::regclass
  ) then
    alter table public.curator_settings
      add constraint curator_settings_scout_interval_chk
      check (scout_interval_minutes between 5 and 1440);
  end if;
end $$;

commit;
