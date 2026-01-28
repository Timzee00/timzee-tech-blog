-- Announcements table for system-wide updates and notifications
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  type text default 'update', -- update, feature, maintenance, event, alert
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Indexes for performance
create index if not exists announcements_created_at_idx on public.announcements(created_at desc);
create index if not exists announcements_type_idx on public.announcements(type);

-- Row Level Security
alter table public.announcements enable row level security;

-- Public read access - everyone can see announcements
drop policy if exists "Announcements are public" on public.announcements;
create policy "Announcements are public" on public.announcements
  for select using (true);

-- Only admins can create announcements
drop policy if exists "Admins create announcements" on public.announcements;
create policy "Admins create announcements" on public.announcements
  for insert
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'super'));

-- Only admins can update announcements
drop policy if exists "Admins update announcements" on public.announcements;
create policy "Admins update announcements" on public.announcements
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'super'));

-- Only admins can delete announcements
drop policy if exists "Admins delete announcements" on public.announcements;
create policy "Admins delete announcements" on public.announcements
  for delete
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'super'));

-- Grant permissions
grant select on public.announcements to anon, authenticated;
grant insert, update, delete on public.announcements to authenticated;
