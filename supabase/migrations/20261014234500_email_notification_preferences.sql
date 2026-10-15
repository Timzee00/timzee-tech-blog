-- User-owned optional email preferences, separate from in-app alerts.
-- Security and transactional account emails are unaffected by these opt-outs.
create table if not exists public.email_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  message_digest boolean not null default false,
  mention_digest boolean not null default false,
  marketplace_alerts boolean not null default false,
  community_digest boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists email_notification_preferences_updated_at_idx
  on public.email_notification_preferences(updated_at desc);
alter table public.email_notification_preferences enable row level security;
revoke all on public.email_notification_preferences from public,anon,authenticated;
grant select,insert,update on public.email_notification_preferences to authenticated;
grant select,insert,update on public.email_notification_preferences to service_role;
drop policy if exists email_prefs_read_own on public.email_notification_preferences;
create policy email_prefs_read_own on public.email_notification_preferences
  for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists email_prefs_insert_own on public.email_notification_preferences;
create policy email_prefs_insert_own on public.email_notification_preferences
  for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists email_prefs_update_own on public.email_notification_preferences;
create policy email_prefs_update_own on public.email_notification_preferences
  for update to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));
