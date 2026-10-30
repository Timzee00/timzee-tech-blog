
-- Blipmood Region & Feature Manager.
-- No changes to the existing launch-announcement table or creator subscriptions.
create table if not exists public.platform_feature_rules(
 feature_key text not null check (feature_key in
 ('video_uploads','fyp_recommendations','marketplace','live_spaces','profile_fx','creator_monetization')),
 country_code text not null default '*' check (country_code='*' or country_code ~ '^[A-Z]{2}$'),
 enabled boolean not null default true,
 rollout_pct smallint not null default 100 check (rollout_pct between 0 and 100),
 starts_at timestamptz,
 ends_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id) on delete set null,
 primary key(feature_key,country_code),
 check (ends_at is null or starts_at is null or ends_at>starts_at)
);
create table if not exists public.platform_trusted_regions(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 country_code text not null check (country_code ~ '^[A-Z]{2}$'),
 evidence_type text not null default 'staff_review'
   check (evidence_type in ('staff_review','verified_residency','verified_billing')),
 reviewed_by uuid not null references public.profiles(id),
 reviewed_at timestamptz not null default now()
);
create index if not exists platform_feature_rules_country_idx on public.platform_feature_rules(country_code,feature_key);
alter table public.platform_feature_rules enable row level security;
alter table public.platform_trusted_regions enable row level security;
revoke all on public.platform_feature_rules, public.platform_trusted_regions from public,anon,authenticated;
grant select on public.platform_feature_rules to anon,authenticated;
grant insert,update,delete on public.platform_feature_rules to authenticated;
grant select,insert,update,delete on public.platform_trusted_regions to authenticated;
drop policy if exists "Public reads rules" on public.platform_feature_rules;
create policy "Public reads rules" on public.platform_feature_rules for select to anon,authenticated using(true);
drop policy if exists "Only super controls rule insert" on public.platform_feature_rules;
create policy "Only super controls rule insert" on public.platform_feature_rules for insert to authenticated
 with check((select public.has_role_secure('super')) and updated_by=(select auth.uid()));
drop policy if exists "Only super controls rule update" on public.platform_feature_rules;
create policy "Only super controls rule update" on public.platform_feature_rules for update to authenticated
 using((select public.has_role_secure('super')))
 with check((select public.has_role_secure('super')) and updated_by=(select auth.uid()));
drop policy if exists "Only super controls rule delete" on public.platform_feature_rules;
create policy "Only super controls rule delete" on public.platform_feature_rules for delete to authenticated
 using((select public.has_role_secure('super')));
drop policy if exists "Only super sees trusted region" on public.platform_trusted_regions;
create policy "Only super sees trusted region" on public.platform_trusted_regions for select to authenticated
 using((select public.has_role_secure('super')));
drop policy if exists "Only super inserts trusted region" on public.platform_trusted_regions;
create policy "Only super inserts trusted region" on public.platform_trusted_regions for insert to authenticated
 with check((select public.has_role_secure('super')) and reviewed_by=(select auth.uid()));
drop policy if exists "Only super updates trusted region" on public.platform_trusted_regions;
create policy "Only super updates trusted region" on public.platform_trusted_regions for update to authenticated
 using((select public.has_role_secure('super')))
 with check((select public.has_role_secure('super')) and reviewed_by=(select auth.uid()));
drop policy if exists "Only super removes trusted region" on public.platform_trusted_regions;
create policy "Only super removes trusted region" on public.platform_trusted_regions for delete to authenticated
 using((select public.has_role_secure('super')));
-- Default every existing feature to available. New rules change behavior only
-- after an explicit super-admin action.
insert into public.platform_feature_rules(feature_key,country_code,enabled,rollout_pct)
values ('video_uploads','*',true,100),
       ('fyp_recommendations','*',true,100),
       ('marketplace','*',true,100),
       ('live_spaces','*',true,100),
       ('profile_fx','*',true,100),
       ('creator_monetization','*',false,0)
on conflict(feature_key,country_code) do nothing;
-- Dedicated audit trail, never exposed through Data API.
create table if not exists private.platform_feature_audit(
 id bigint generated always as identity primary key,
 actor_id uuid,
 table_name text not null,
 operation text not null,
 previous jsonb,
 current jsonb,
 created_at timestamptz not null default now()
);
revoke all on private.platform_feature_audit from public,anon,authenticated;
create or replace function private.platform_feature_audit_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 insert into private.platform_feature_audit(actor_id,table_name,operation,previous,current)
 values(auth.uid(),TG_TABLE_NAME,TG_OP,
   case when TG_OP='INSERT' then null else to_jsonb(old) end,
   case when TG_OP='DELETE' then null else to_jsonb(new) end);
 return coalesce(new,old);
end $$;
revoke all on function private.platform_feature_audit_trigger() from public,anon,authenticated;
drop trigger if exists platform_feature_rules_audit on public.platform_feature_rules;
create trigger platform_feature_rules_audit after insert or update or delete on public.platform_feature_rules
 for each row execute function private.platform_feature_audit_trigger();
drop trigger if exists platform_trusted_regions_audit on public.platform_trusted_regions;
create trigger platform_trusted_regions_audit after insert or update or delete on public.platform_trusted_regions
 for each row execute function private.platform_feature_audit_trigger();
-- Read-only enforcement: never trust a browser country header, GPS or VPN-derived location.
-- Restricted markets require trusted account location; unknown accounts can
-- access only explicit global defaults, never a country-specific exception.
create or replace function public.blipmood_feature_allowed(p_feature text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare viewer uuid:=auth.uid(); region text; rule public.platform_feature_rules%rowtype;
        sample bigint;
begin
 if p_feature not in ('video_uploads','fyp_recommendations','marketplace','live_spaces','profile_fx','creator_monetization')
 then return false; end if;
 if viewer is not null then
  select r.country_code into region from public.platform_trusted_regions r where r.user_id=viewer;
 end if;
 select * into rule from public.platform_feature_rules
 where feature_key=p_feature and country_code=coalesce(region,'*') limit 1;
 if not found then
  select * into rule from public.platform_feature_rules
  where feature_key=p_feature and country_code='*' limit 1;
 end if;
 if not found or not rule.enabled or (rule.starts_at is not null and now()<rule.starts_at)
   or (rule.ends_at is not null and now()>=rule.ends_at) then return false; end if;
 if rule.rollout_pct>=100 then return true;end if;
 if rule.rollout_pct<=0 then return false;end if;
 -- Never randomly reassign a user on every request. Guests may use global
 -- 100%-on features, but cannot access restricted partial rollouts.
 if viewer is null then return false;end if;
 sample:=('x'||substr(md5(viewer::text||':'||p_feature),1,8))::bit(32)::bigint;
 return (sample%100)<rule.rollout_pct;
end $$;
revoke all on function public.blipmood_feature_allowed(text) from public,anon,authenticated;
grant execute on function public.blipmood_feature_allowed(text) to anon,authenticated;
-- The server checks this on new video metadata inserts; UI hiding cannot bypass.
create or replace function private.platform_video_upload_gate()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not public.blipmood_feature_allowed('video_uploads') then
  raise exception 'Video uploads are currently unavailable for this account/region'
  using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.platform_video_upload_gate() from public,anon,authenticated;
drop trigger if exists platform_video_upload_gate on public.videos;
create trigger platform_video_upload_gate before insert on public.videos
for each row execute function private.platform_video_upload_gate();
