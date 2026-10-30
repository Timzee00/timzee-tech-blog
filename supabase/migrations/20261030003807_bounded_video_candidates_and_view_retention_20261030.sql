
-- Dense, reusable candidate list: generated once per 15 minutes instead of
-- repeatedly aggregating reactions for every scrolling user.
create table if not exists public.blipmood_video_candidates(
 video_id uuid not null references public.videos(id) on delete cascade,
 lane text not null check(lane in ('trending','new')),
 score numeric not null,
 refreshed_at timestamptz not null default now(),
 primary key(video_id,lane)
);
create index if not exists blipmood_video_candidate_lane_idx
 on public.blipmood_video_candidates(lane,score desc,video_id);
create index if not exists blipmood_videos_public_recent_idx on public.videos(created_at desc,id)
 where is_public=true;
create index if not exists blipmood_video_view_events_day_idx on app_private.video_view_events(viewed_on);
create index if not exists blipmood_guest_video_views_day_idx on app_private.video_guest_view_events(viewed_on);
alter table public.blipmood_video_candidates enable row level security;
revoke all on public.blipmood_video_candidates from public,anon,authenticated;
-- candidates are internal; the read RPC joins actual video RLS at read time.
create or replace function private.refresh_blipmood_video_candidates()
returns integer language plpgsql security definer
 set search_path=pg_catalog,public,private as $$
declare n integer;
begin
  -- Limit candidate computation to a recent indexed slice. Do not scan a
  -- future billion-video catalog just to find relevant items.
  delete from public.blipmood_video_candidates;
  insert into public.blipmood_video_candidates(video_id,lane,score,refreshed_at)
  select v.id,'trending',
     (4*ln(greatest(coalesce(v.like_count,0),0)+1)
     +5*ln(greatest(coalesce(v.comment_count,0),0)+1)
     +0.7*ln(greatest(coalesce(v.view_count,0),0)+1)
     +12/(1+greatest(extract(epoch from(now()-v.created_at))/86400.0,0)))::numeric,
     now()
  from (select id,like_count,comment_count,view_count,created_at
        from public.videos where is_public=true
        order by created_at desc limit 2000) v
  order by 3 desc limit 200;
  insert into public.blipmood_video_candidates(video_id,lane,score,refreshed_at)
  select v.id,'new',(1/(1+greatest(extract(epoch from(now()-v.created_at))/86400,0)))::numeric,now()
  from public.videos v where is_public=true
  order by created_at desc limit 80;
  select count(*) into n from public.blipmood_video_candidates;
  return n;
end $$;
revoke all on function private.refresh_blipmood_video_candidates() from public,anon,authenticated;
-- A single bounded personalized read over 280 MAX precomputed items.
-- Return IDs only. Existing client batching retrieves row metadata in one query.
create or replace function public.blipmood_video_feed_ids(
 p_mode text default 'for-you',p_limit integer default 50
) returns table(video_id uuid)
 language sql stable security invoker set search_path=pg_catalog,public as $$
with viewer as (select auth.uid() as id),
candidate_scores as (
 select c.video_id,v.user_id,
  max(case when c.lane='trending' then c.score else c.score*12 end)
    +case when exists (select 1 from public.follows f
       where f.follower_id=(select id from viewer)
       and f.target_type='author' and f.target_id=v.user_id::text)
        then 7 else 0 end as score,
  max(v.created_at) as added
 from public.blipmood_video_candidates c
 join public.videos v on v.id=c.video_id
 where v.is_public=true and
   (p_mode='for-you' or (p_mode='following' and exists(
     select 1 from public.follows f
     where f.follower_id=(select id from viewer)
       and f.target_type='author' and f.target_id=v.user_id::text)))
   and not exists (select 1 from public.user_content_feedback n
    where n.user_id=(select id from viewer) and n.content_type='video'
     and n.content_id=v.id and n.action in ('not_interested','hide'))
 group by c.video_id,v.user_id
)
select c.video_id from candidate_scores c
where p_mode in ('for-you','following')
order by c.score desc,c.added desc,c.video_id desc
limit least(50,greatest(1,coalesce(p_limit,50)))
$$;
revoke all on function public.blipmood_video_feed_ids(text,integer) from public,anon,authenticated;
grant execute on function public.blipmood_video_feed_ids(text,integer) to anon,authenticated;
-- Distinct daily view history remains for deduplication, but events older
-- than 30 days are removed in small batches; aggregate view counts remain.
create or replace function private.prune_video_view_events(p_batch integer default 4000)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private,private as $$
declare v_user integer:=0;v_guest integer:=0;cutoff date:=((now() at time zone 'utc')::date-30);
begin
 with old_rows as (
  select ctid from app_private.video_view_events
  where viewed_on<cutoff order by viewed_on asc limit least(greatest(p_batch,100),4000)
 )
 delete from app_private.video_view_events where ctid in(select ctid from old_rows);
 get diagnostics v_user=row_count;
 with old_rows as (
  select ctid from app_private.video_guest_view_events
  where viewed_on<cutoff order by viewed_on asc limit least(greatest(p_batch,100),4000)
 )
 delete from app_private.video_guest_view_events where ctid in(select ctid from old_rows);
 get diagnostics v_guest=row_count;
 return jsonb_build_object('user_events_pruned',v_user,'guest_events_pruned',v_guest);
end $$;
revoke all on function private.prune_video_view_events(integer) from public,anon,authenticated;
-- Use existing pg_cron, no additional hosted queue or paid background worker.
select cron.schedule('blipmood-candidate-refresh-15m','*/15 * * * *',
 'select private.refresh_blipmood_video_candidates();');
select cron.schedule('blipmood-view-event-prune-daily','42 3 * * *',
 'select private.prune_video_view_events(4000);');
select private.refresh_blipmood_video_candidates();
