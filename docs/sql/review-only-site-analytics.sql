-- REVIEW AND DEPLOY TO STAGING FIRST. No historical visits are backfillable
-- from existing post.view counts. UTC day and browser-unique opt-in analytics.
create table if not exists public.site_visitors (
  visitor_hash text primary key check(length(visitor_hash)=64),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists public.site_visit_daily (
  day date not null,
  visitor_hash text not null references public.site_visitors(visitor_hash) on delete cascade,
  pageviews integer not null default 1 check(pageviews>0),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key(day,visitor_hash)
);
create index if not exists site_visit_daily_day_idx on public.site_visit_daily(day desc);
alter table public.site_visitors enable row level security;
alter table public.site_visit_daily enable row level security;
revoke all on public.site_visitors,public.site_visit_daily from anon,authenticated;
grant select,insert,update on public.site_visitors,public.site_visit_daily to service_role;
create or replace function public.record_site_visit(p_hash text)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid anonymous visitor token';
  end if;
  insert into public.site_visitors(visitor_hash) values (p_hash)
  on conflict(visitor_hash) do update set last_seen=now();
  insert into public.site_visit_daily(day,visitor_hash)
  values ((now() at time zone 'UTC')::date,p_hash)
  on conflict(day,visitor_hash) do update set
    pageviews=public.site_visit_daily.pageviews+1,last_seen=now();
end;
$$;
revoke all on function public.record_site_visit(text) from public,anon,authenticated;
grant execute on function public.record_site_visit(text) to service_role;
create or replace function public.site_traffic_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path=pg_catalog,public
as $$
declare result jsonb;
begin
  if p_days not in(7,30,90) then raise exception 'Unsupported traffic report range'; end if;
  select jsonb_build_object(
    'unique_browsers_total',(select count(*) from public.site_visitors),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'date',d.day,'unique_browsers',coalesce(t.uniques,0),'pageviews',coalesce(t.views,0)
    ) order by d.day)
    from generate_series((now() at time zone 'UTC')::date-(p_days-1),
      (now() at time zone 'UTC')::date,interval '1 day') d(day)
    left join (
      select day,count(*) uniques,sum(pageviews) views
      from public.site_visit_daily
      where day>=(now() at time zone 'UTC')::date-(p_days-1)
      group by day
    ) t on t.day=d.day), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.site_traffic_report(integer) from public,anon,authenticated;
grant execute on function public.site_traffic_report(integer) to service_role;
-- Privacy: only visitor IDs randomly generated after optional measurement
-- consent; hash with a server secret. Clear client ID on consent withdrawal.
-- This counts browsers/devices, NOT perfectly unique human beings.
-- Decide retention (recommended 13 months) with legal review before rollout.
