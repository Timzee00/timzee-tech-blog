
-- Approximate country is recorded ONLY by the authenticated Netlify server.
-- This is not verified residency and is never used to qualify for payouts.
create table if not exists public.platform_observed_regions(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 country_code text not null check(country_code ~ '^[A-Z]{2}$'),
 observed_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '72 hours')
);
alter table public.platform_observed_regions enable row level security;
revoke all on public.platform_observed_regions from public,anon,authenticated;
-- service_role can write via server SDK; clients cannot read or spoof region.
create index if not exists platform_observed_regions_expire_idx
 on public.platform_observed_regions(expires_at);
create or replace function public.blipmood_feature_allowed(p_feature text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare viewer uuid:=auth.uid(); region text; rule public.platform_feature_rules%rowtype;
        sample bigint;
begin
 if p_feature not in ('video_uploads','fyp_recommendations','marketplace','live_spaces','profile_fx','creator_monetization')
 then return false;end if;
 if viewer is not null then
  select country_code into region from public.platform_trusted_regions where user_id=viewer;
  if region is null and p_feature<>'creator_monetization' then
   select country_code into region from public.platform_observed_regions
    where user_id=viewer and expires_at>now();
  end if;
 end if;
 select * into rule from public.platform_feature_rules
 where feature_key=p_feature and country_code=coalesce(region,'*') limit 1;
 if not found then
  select * into rule from public.platform_feature_rules
   where feature_key=p_feature and country_code='*' limit 1;
 end if;
 if not found or not rule.enabled
   or (rule.starts_at is not null and now()<rule.starts_at)
   or (rule.ends_at is not null and now()>=rule.ends_at) then return false;end if;
 if rule.rollout_pct>=100 then return true;end if;
 if rule.rollout_pct<=0 then return false;end if;
 if viewer is null then return false;end if;
 sample:=('x'||substr(md5(viewer::text||':'||p_feature),1,8))::bit(32)::bigint;
 return (sample%100)<rule.rollout_pct;
end $$;
-- bounded, daily expiry cleanup (no connection IPs or GPS saved).
create or replace function private.prune_platform_observed_regions()
returns integer language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare n integer;
begin
 with old as (
  select user_id from public.platform_observed_regions
   where expires_at<now() order by expires_at limit 2000
 )
 delete from public.platform_observed_regions
 where user_id in (select user_id from old);
 get diagnostics n=row_count;
 return n;
end $$;
revoke all on function private.prune_platform_observed_regions() from public,anon,authenticated;
select cron.schedule('blipmood-expired-observed-regions','55 3 * * *',
 'select private.prune_platform_observed_regions();');
