-- REVIEW-ONLY ARCHITECTURE PROPOSAL. NOT FOR DIRECT PRODUCTION EXECUTION.
-- This removes 1 announcement x 100,000 profiles fanout; one published
-- announcement is visible once to everyone, and only per-user read status
-- is stored. Ship UI notification-bell changes and replacement maintenance
-- tick IN THE SAME reviewed staging release before applying this schema.

create table if not exists public.announcement_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);
alter table public.announcement_reads enable row level security;
revoke all on public.announcement_reads from public, anon;
grant select,insert,delete on public.announcement_reads to authenticated;
create policy "Users read own announcement receipts" on public.announcement_reads
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark their own announcements read" on public.announcement_reads
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users may unmark own announcement receipts" on public.announcement_reads
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.get_unread_announcement_count()
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*)
  from public.announcements a
  where (select auth.uid()) is not null
    and a.status = 'published'
    and (a.publish_at is null or a.publish_at <= now())
    and not exists (
      select 1 from public.announcement_reads r
      where r.user_id = (select auth.uid()) and r.announcement_id = a.id
    );
$$;
revoke all on function public.get_unread_announcement_count() from public, anon;
grant execute on function public.get_unread_announcement_count() to authenticated;

-- CRITICAL REQUIRED COMPANION MIGRATION (NOT INCLUDED HERE):
-- Replace the public.process_automation_tick() CROSS JOIN public.profiles
-- announcement-notification insert with a single due announcement UPDATE
-- setting status='published', notified_at=now(). Preserve existing story
-- expiry, old notification cleanup and system_job_status telemetry.
-- Existing per-user notification records can remain for historical inbox
-- compatibility, with a gradual read-state migration. Never delete those
-- records without a data-retention/rollback review.

-- REQUIRED TESTS:
-- 1. user A can only read/write their announcement_reads receipts.
-- 2. anon cannot query receipts or invoke unread count RPC.
-- 3. user B cannot mark announcements read on behalf of user A.
-- 4. archived/scheduled/future announcements are excluded.
-- 5. bell/UI counts combine ordinary private notifications and unread
--    announcements without double-counting historical deliveries.
-- 6. one 100,000-account global announcement must not create 100,000
--    notification writes; load test publication and realtime broadcast.
-- 7. do not migrate production without a staged rollback strategy.
