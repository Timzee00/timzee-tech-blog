
-- Storage thresholds and deduplicated low-frequency administrative alerts.
create table if not exists public.platform_capacity_alerts(
 id bigint generated always as identity primary key,
 alert_day date not null default (now() at time zone 'utc')::date,
 level text not null check(level in ('warning','restrict','pause')),
 used_bytes bigint not null,
 budget_bytes bigint not null,
 created_at timestamptz not null default now(),
 unique(alert_day,level)
);
alter table public.platform_capacity_alerts enable row level security;
revoke all on public.platform_capacity_alerts from public,anon,authenticated;
grant select on public.platform_capacity_alerts to authenticated;
drop policy if exists "Only super reads storage warnings" on public.platform_capacity_alerts;
create policy "Only super reads storage warnings" on public.platform_capacity_alerts
for select to authenticated using((select public.has_role_secure('super')));
-- At 80%, new videos must be <= 6 MiB, limiting how quickly usage grows.
create or replace function public.blipmood_media_upload_policy()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,storage as $$
declare conf public.platform_capacity_settings%rowtype;media_size bigint;effective bigint;
begin
 select * into conf from public.platform_capacity_settings where singleton=true;
 select coalesce(sum((metadata->>'size')::bigint),0) into media_size from storage.objects where bucket_id='media';
 effective:=conf.max_video_upload_bytes;
 if media_size*100>=conf.media_budget_bytes*80 then
  effective:=least(effective,6291456);
 end if;
 return jsonb_build_object('max_video_upload_bytes',effective,
 'max_thumbnail_bytes',conf.max_thumbnail_bytes,'warning_pct',conf.warning_pct);
end $$;
-- Add the same hard 80%-utilization threshold to video metadata validation.
create or replace function private.platform_video_upload_gate()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare file_path text;bytes bigint;max_bytes bigint;total_bytes bigint;budget bigint;pause_pct integer;
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
 if bytes is null or bytes<=0 then
  raise exception 'Video object not found in managed storage' using errcode='22023';
 end if;
 select coalesce(sum((o.metadata->>'size')::bigint),0) into total_bytes
 from storage.objects o where o.bucket_id='media';
 if total_bytes*100>=budget*pause_pct then
  raise exception 'Media upload capacity safeguard is active' using errcode='54000';
 end if;
 if total_bytes*100>=budget*80 then max_bytes:=least(max_bytes,6291456);end if;
 if bytes>max_bytes then
  raise exception 'Video file exceeds the available storage upload limit' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function private.platform_video_upload_gate() from public,anon,authenticated;
-- Once per hour. Notifications appear only once per day per threshold, not
-- once per request or upload. It does not remove any member media.
create or replace function private.platform_storage_monitor()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,storage as $$
declare conf public.platform_capacity_settings%rowtype;used bigint;level_name text;outcome jsonb:='{}'::jsonb;admin_row record;new_id bigint;
begin
 select * into conf from public.platform_capacity_settings where singleton=true;
 select coalesce(sum((metadata->>'size')::bigint),0) into used from storage.objects where bucket_id='media';
 for level_name in select unnest(array['warning','restrict','pause']) loop
  if (level_name='warning' and used*100>=conf.media_budget_bytes*conf.warning_pct)
    or (level_name='restrict' and used*100>=conf.media_budget_bytes*80)
    or (level_name='pause' and used*100>=conf.media_budget_bytes*conf.upload_pause_pct) then
   insert into public.platform_capacity_alerts(level,used_bytes,budget_bytes)
    values(level_name,used,conf.media_budget_bytes)
    on conflict(alert_day,level) do nothing returning id into new_id;
   if new_id is not null then
    for admin_row in select id from public.profiles where lower(coalesce(role,''))='super' loop
     perform public.emit_user_notification(admin_row.id,'storage_capacity',
      'Blipmood media capacity: '||level_name,
      'Media usage reached '||round(100.0*used/greatest(1,conf.media_budget_bytes),1)
      ||'% of configured budget. Review Region & Capacity settings.',
      '/super/region-capacity.html',jsonb_build_object('level',level_name,'day',(now() at time zone 'utc')::date));
    end loop;
   end if;
   outcome:=outcome||jsonb_build_object(level_name,true);
  end if;
  new_id:=null;
 end loop;
 return jsonb_build_object('media_bytes',used,'budget_bytes',conf.media_budget_bytes,'alerts',outcome);
end $$;
revoke all on function private.platform_storage_monitor() from public,anon,authenticated;
select cron.schedule('blipmood-storage-capacity-hourly','13 * * * *',
 'select private.platform_storage_monitor();');
