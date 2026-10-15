-- STAGING REVIEW ONLY. Does not run in production until migrated and tested.
-- Atomic, RLS-safe authenticated video views with deduplication per UTC day.
-- For anonymous views use a separately rate-limited server endpoint; never
-- give anonymous callers privileged UPDATE access to public.videos.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.video_view_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  viewed_on date not null,
  primary key (user_id, video_id, viewed_on)
);
alter table app_private.video_view_events enable row level security;
-- Intentionally no direct policies/grants. Only the guarded function writes.

create or replace function public.record_video_view(p_video_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  inserted_rows integer := 0;
begin
  if viewer is null or p_video_id is null then
    return false;
  end if;
  if not exists (
    select 1 from public.videos
    where id = p_video_id and is_public is true
  ) then
    return false;
  end if;

  insert into app_private.video_view_events (user_id, video_id, viewed_on)
  values (viewer, p_video_id, (now() at time zone 'utc')::date)
  on conflict (user_id, video_id, viewed_on) do nothing;
  get diagnostics inserted_rows = row_count;
  if inserted_rows = 0 then
    return false;
  end if;

  update public.videos
  set view_count = coalesce(view_count, 0) + 1
  where id = p_video_id and is_public is true;
  -- If this UPDATE unexpectedly finds no row, raise to roll back the insert.
  if not found then
    raise exception 'Video disappeared during view recording';
  end if;
  return true;
end;
$$;
revoke all on function public.record_video_view(uuid) from public, anon;
grant execute on function public.record_video_view(uuid) to authenticated;

-- Required before production:
-- 1. owner/schema execution rights reviewed; SECURITY DEFINER ownership limited.
-- 2. anon cannot call; authenticated user sees one TRUE/day, then FALSE.
-- 3. users cannot update another user's videos through ordinary Data API.
-- 4. parallel same-user requests only increment once; different viewers count.
-- 5. rejected/deleted/private videos do not increase counts.
-- 6. audit growth/retention of app_private.video_view_events.
