-- Blipmood aggregate-only traffic, independent of optional measurement consent.
-- No IP address, cookie, user ID, browser ID, user agent, or request log stored.
-- Events are totals per UTC day, public HTML route, event type and write shard.
-- Do not interpret page opens as distinct humans.
create table if not exists public.site_aggregate_events (
  day date not null,
  page text not null check (page ~ '^/([a-z0-9-]{1,48}[.]html)?$'),
  event_type text not null check (event_type in ('view','engaged','signup_click')),
  shard smallint not null check (shard between 0 and 31),
  total bigint not null default 0 check (total >= 0),
  primary key (day,page,event_type,shard)
);
alter table public.site_aggregate_events enable row level security;
revoke all on public.site_aggregate_events from public,anon,authenticated;
grant select,insert,update on public.site_aggregate_events to service_role;

create or replace function public.record_site_aggregate_event(
  p_page text, p_event text, p_shard integer
) returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  if p_page is null or p_page !~ '^/([a-z0-9-]{1,48}[.]html)?$'
     or p_page in ('/404.html','/offline.html') then
    raise exception 'Invalid public page';
  end if;
  if p_event not in ('view','engaged','signup_click') or p_event is null then
    raise exception 'Invalid aggregate event';
  end if;
  if p_shard is null or p_shard not between 0 and 31 then
    raise exception 'Invalid aggregate shard';
  end if;
  insert into public.site_aggregate_events(day,page,event_type,shard,total)
  values ((now() at time zone 'UTC')::date,p_page,p_event,p_shard,1)
  on conflict (day,page,event_type,shard)
  do update set total=public.site_aggregate_events.total+1;
end;
$$;
revoke all on function public.record_site_aggregate_event(text,text,integer) from public,anon,authenticated;
grant execute on function public.record_site_aggregate_event(text,text,integer) to service_role;

create or replace function public.site_aggregate_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path=pg_catalog,public
as $$
declare
  p_start date;
  result jsonb;
begin
  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Unsupported report range';
  end if;
  p_start := (now() at time zone 'UTC')::date-(p_days-1);
  with daily_totals as (
    select day,
      coalesce(sum(total) filter (where event_type='view'),0)::bigint as pageviews,
      coalesce(sum(total) filter (where event_type='engaged'),0)::bigint as engaged,
      coalesce(sum(total) filter (where event_type='signup_click'),0)::bigint as signup_clicks
    from public.site_aggregate_events
    where day >= p_start
    group by day
  )
  select jsonb_build_object(
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d.day::date,
        'pageviews',coalesce(t.pageviews,0),
        'engaged',coalesce(t.engaged,0),
        'signup_clicks',coalesce(t.signup_clicks,0)
      ) order by d.day),'[]'::jsonb)
      from generate_series(p_start,(now() at time zone 'UTC')::date,interval '1 day') d(day)
      left join daily_totals t on t.day=d.day::date
    ),
    'totals', (
      select jsonb_build_object(
        'pageviews',coalesce(sum(pageviews),0),
        'engaged',coalesce(sum(engaged),0),
        'signup_clicks',coalesce(sum(signup_clicks),0)
      ) from daily_totals
    ),
    'top_pages', (
      select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)
      from (
        select page,
          coalesce(sum(total) filter (where event_type='view'),0)::bigint as pageviews,
          coalesce(sum(total) filter (where event_type='engaged'),0)::bigint as engaged
        from public.site_aggregate_events
        where day >= p_start
        group by page
        order by pageviews desc,page asc
        limit 8
      ) q
    ),
    'period_days',p_days,
    'counting_method','Aggregate page loads and engagement signals; not distinct people'
  ) into result;
  return result;
end;
$$;
revoke all on function public.site_aggregate_report(integer) from public,anon,authenticated;
grant execute on function public.site_aggregate_report(integer) to service_role;
