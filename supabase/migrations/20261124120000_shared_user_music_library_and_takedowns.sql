-- Shared, user-contributed music catalogue with rights reporting and admin takedowns.
create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  artist text not null default '' check (char_length(artist) <= 100),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 10485760),
  rights_confirmed boolean not null default false check (rights_confirmed),
  status text not null default 'available' check (status in ('available','restricted','taken_down')),
  takedown_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists music_tracks_available_created_idx on public.music_tracks(created_at desc,id desc) where status='available';
create index if not exists music_tracks_uploader_created_idx on public.music_tracks(uploader_id,created_at desc);
create table if not exists public.music_track_reports (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.music_tracks(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('copyright','impersonation','misleading_metadata','harmful_or_illegal','other')),
  details text not null check (char_length(details) between 10 and 2000),
  claimant_contact text check (claimant_contact is null or char_length(claimant_contact)<=254),
  evidence_url text check (evidence_url is null or char_length(evidence_url)<=1200),
  status text not null default 'open' check (status in ('open','reviewing','dismissed','upheld')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists music_track_reports_track_status_idx on public.music_track_reports(track_id,status,created_at desc);
create index if not exists music_track_reports_created_idx on public.music_track_reports(created_at desc);
create table if not exists public.music_track_moderation_audit (
  id bigint generated always as identity primary key,
  track_id uuid not null references public.music_tracks(id) on delete cascade,
  actor_id uuid references auth.users(id),
  old_status text,
  new_status text not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.music_tracks enable row level security;
alter table public.music_track_reports enable row level security;
alter table public.music_track_moderation_audit enable row level security;
create policy "Available music is readable" on public.music_tracks for select to authenticated
 using (status='available' or uploader_id=(select auth.uid()) or public.has_role_secure('admin') or public.has_role_secure('owner'));
create policy "Users can publish their own music" on public.music_tracks for insert to authenticated
 with check (uploader_id=(select auth.uid()) and rights_confirmed=true and status='available' and storage_path like (select auth.uid())::text||'/%');
create policy "Admins can moderate music" on public.music_tracks for update to authenticated
 using (public.has_role_secure('admin') or public.has_role_secure('owner'))
 with check (public.has_role_secure('admin') or public.has_role_secure('owner'));
create policy "Users can report music" on public.music_track_reports for insert to authenticated
 with check (reporter_id=(select auth.uid()) and exists(select 1 from public.music_tracks t where t.id=track_id and t.status='available'));
create policy "Reporters and admins can read reports" on public.music_track_reports for select to authenticated
 using (reporter_id=(select auth.uid()) or public.has_role_secure('admin') or public.has_role_secure('owner'));
create policy "Admins can update reports" on public.music_track_reports for update to authenticated
 using (public.has_role_secure('admin') or public.has_role_secure('owner'))
 with check (public.has_role_secure('admin') or public.has_role_secure('owner'));
create policy "Admins can read music moderation audit" on public.music_track_moderation_audit for select to authenticated
 using (public.has_role_secure('admin') or public.has_role_secure('owner'));
create or replace function public.log_music_track_moderation()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if old.status is distinct from new.status or old.takedown_reason is distinct from new.takedown_reason then
   insert into public.music_track_moderation_audit(track_id,actor_id,old_status,new_status,reason)
   values(new.id,(select auth.uid()),old.status,new.status,new.takedown_reason);
 end if;
 new.updated_at=now(); return new;
end $$;
create trigger music_track_moderation_audit_trigger before update on public.music_tracks
 for each row execute function public.log_music_track_moderation();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('music-library','music-library',true,10485760,array['audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm'])
on conflict(id) do update set public=true,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create policy "Users upload own music library files" on storage.objects for insert to authenticated
 with check (bucket_id='music-library' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Users delete own music library files" on storage.objects for delete to authenticated
 using (bucket_id='music-library' and (storage.foldername(name))[1]=(select auth.uid())::text);
