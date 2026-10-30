
-- If any country override exists, an unknown user region must not bypass it
-- by disabling the optional geo sync endpoint. Normal all-global rules are
-- unaffected. Creator payouts always require a staff-reviewed residence.
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
 if region is null and exists(select 1 from public.platform_feature_rules
   where feature_key=p_feature and country_code<>'*')
 then return false; end if;
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
