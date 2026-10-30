
-- Blipmood capacity controls. No media is deleted by this migration.
create table if not exists public.platform_capacity_settings(
 singleton boolean primary key default true check(singleton=true),
 max_video_upload_bytes bigint not null default 20971520 check(max_video_upload_bytes between 1048576 and 104857600),
 max_thumbnail_bytes bigint not null default 2097152 check(max_thumbnail_bytes between 131072 and 10485760),
 warning_pct smallint not null default 60 check(warning_pct between 30 and 90),
 upload_pause_pct smallint not null default 95 check(upload_pause_pct between 80 and 100),
 media_budget_bytes bigint not null default 1073741824 check(media_budget_bytes between 104857600 and 107374182400),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
alter table public.platform_capacity_settings enable row level security;
revoke all on public.platform_capacity_settings from public,anon,authenticated;
grant select,update on public.platform_capacity_settings to authenticated;
drop policy if exists "Only super reads capacity settings" on public.platform_capacity_settings;
create policy "Only super reads capacity settings" on public.platform_capacity_settings
 for select to authenticated using((select public.has_role_secure('super')));
drop policy if exists "Only super changes capacity settings" on public.platform_capacity_settings;
create policy "Only super changes capacity settings" on public.platform_capacity_settings for update to authenticated
 using((select public.has_role_secure('super'))) with check((select public.has_role_secure('super')) and updated_by=(select auth.uid()));
insert into public.platform_capacity_settings(singleton) values(true) on conflict do nothing;
-- User UI gets upload limits, not detailed storage inventory.
create or replace function public.blipmood_media_upload_policy()
 returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('max_video_upload_bytes',max_video_upload_bytes,
 'max_thumbnail_bytes',max_thumbnail_bytes,'warning_pct',warning_pct)
 from public.platform_capacity_settings where singleton=true limit 1
$$;
revoke all on function public.blipmood_media_upload_policy() from public,anon,authenticated;
grant execute on function public.blipmood_media_upload_policy() to anon,authenticated;
-- Admin-only costly aggregation, explicitly on demand; never on public FYP.
create or replace function public.blipmood_capacity_snapshot()
 returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,storage as $$
declare storage_bytes bigint; db_bytes bigint; buckets jsonb;conf public.platform_capacity_settings%rowtype;
begin
 if auth.uid() is null or not public.has_role_secure('super') then
  raise exception 'Super administrator required' using errcode='42501';
 end if;
 select * into conf from public.platform_capacity_settings where singleton=true;
 select pg_database_size(current_database()) into db_bytes;
 select coalesce(sum(coalesce((o.metadata->>'size')::bigint,0)),0) into storage_bytes
 from storage.objects o;
 select coalesce(jsonb_agg(jsonb_build_object('name',bucket_id,'files',files,'bytes',bytes)
  order by bytes desc),'[]'::jsonb) into buckets from (
  select o.bucket_id,count(*) as files,
  coalesce(sum(coalesce((o.metadata->>'size')::bigint,0)),0) as bytes
  from storage.objects o group by o.bucket_id
 ) q;
 return jsonb_build_object('database_bytes',db_bytes,'media_bytes',storage_bytes,
   'media_budget_bytes',conf.media_budget_bytes,
   'max_video_upload_bytes',conf.max_video_upload_bytes,
   'max_thumbnail_bytes',conf.max_thumbnail_bytes,
   'warning_pct',conf.warning_pct,'upload_pause_pct',conf.upload_pause_pct,
   'buckets',buckets,'measured_at',now());
end $$;
revoke all on function public.blipmood_capacity_snapshot() from public,anon,authenticated;
grant execute on function public.blipmood_capacity_snapshot() to authenticated;
drop trigger if exists platform_capacity_settings_audit on public.platform_capacity_settings;
create trigger platform_capacity_settings_audit after update on public.platform_capacity_settings
 for each row execute function private.platform_feature_audit_trigger();
-- Since a video is uploaded BEFORE its metadata row is created, DB validation
-- rejects oversized objects even if the user bypasses client-side limits.
create or replace function private.platform_video_upload_gate()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare file_path text; bytes bigint; max_bytes bigint; total_bytes bigint; budget bigint; pause_pct integer;
begin
 if auth.uid() is distinct from new.user_id or not public.blipmood_feature_allowed('video_uploads') then
  raise exception 'Video uploads are unavailable for this account or region' using errcode='42501';
 end if;
 select max_video_upload_bytes,media_budget_bytes,upload_pause_pct
 into max_bytes,budget,pause_pct from public.platform_capacity_settings where singleton=true;
 if new.video_url not like '%/storage/v1/object/public/media/videos/%' then
   raise exception 'New videos must come from managed public video storage' using errcode='22023';
 end if;
 file_path:=split_part(new.video_url,'/storage/v1/object/public/media/',2);
 file_path:=split_part(file_path,'?',1);
 if file_path not like 'videos/'||new.user_id::text||'/%' then
   raise exception 'Video does not belong to this uploader' using errcode='42501';
 end if;
 select (o.metadata->>'size')::bigint into bytes from storage.objects o
 where o.bucket_id='media' and o.name=file_path limit 1;
 if bytes is null or bytes<=0 or bytes>max_bytes then
   raise exception 'Video upload exceeds limit or is not stored' using errcode='22023';
 end if;
 -- Capacity aggregation is performed at upload commit, NOT on every FYP read.
 select coalesce(sum((o.metadata->>'size')::bigint),0) into total_bytes
 from storage.objects o where o.bucket_id='media';
 if total_bytes*100>=budget*pause_pct then
  raise exception 'Media upload capacity safeguard is active' using errcode='54000';
 end if;
 return new;
end $$;
revoke all on function private.platform_video_upload_gate() from public,anon,authenticated;
