-- DESIGN PROPOSAL ONLY: do not apply to production.
-- An opt-in service-role scheduled worker computes a bounded shared candidate
-- pool every 15 minutes rather than asking every viewer to rank all content.
-- This table is PRIVATE: do not add it to Data API exposed schemas.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.feed_candidate_scores (
  content_type text not null,
  content_id uuid not null,
  baseline_score numeric not null,
  published_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  primary key (content_type, content_id)
);
alter table app_private.feed_candidate_scores enable row level security;
revoke all on app_private.feed_candidate_scores from public, anon, authenticated;
create index if not exists feed_candidate_scores_rank_idx
 on app_private.feed_candidate_scores (content_type,baseline_score desc,published_at desc);

create or replace function public.refresh_feed_candidate_scores(p_max_per_type integer default 150)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  batch_size integer := greatest(25,least(coalesce(p_max_per_type,150),250));
  changed_rows integer := 0;
  last_refresh timestamptz;
begin
  if not pg_try_advisory_xact_lock(317820, 144) then
    return jsonb_build_object('skipped','already_running');
  end if;
  select max(refreshed_at) into last_refresh from app_private.feed_candidate_scores;
  if last_refresh > now() - interval '15 minutes' then
    return jsonb_build_object('skipped','recently_refreshed');
  end if;

  with
    recent_posts as materialized (
      select p.id, p.created_at, p.views
      from public.posts p
      where lower(coalesce(p.status,'')) = 'published'
        and coalesce(p.publish_at,p.created_at) <= now()
      order by p.created_at desc limit batch_size
    ),
    recent_videos as materialized (
      select v.id,v.created_at,v.view_count,v.like_count,v.comment_count
      from public.videos v where v.is_public is true
      order by v.created_at desc limit batch_size
    ),
    recent_topics as materialized (
      select t.id,t.updated_at from public.discussion_topics t
      order by t.updated_at desc limit batch_size
    ),
    recent_listings as materialized (
      select m.id,m.created_at,m.view_count
      from public.marketplace_items m where m.is_available is true
      order by m.created_at desc limit batch_size
    ),
    candidates as (
      select 'post'::text as content_type,p.id as content_id,
        (8 + ln(greatest(coalesce(p.views,0),0)+1))::numeric as baseline_score,
        p.created_at::timestamptz as published_at from recent_posts p
      union all
      select 'video',v.id,(7+coalesce(v.like_count,0)*1.2+coalesce(v.comment_count,0)*1.5+
          ln(greatest(coalesce(v.view_count,0),0)+1))::numeric,v.created_at::timestamptz from recent_videos v
      union all
      select 'discussion',t.id,6::numeric,t.updated_at from recent_topics t
      union all
      select 'marketplace',m.id,(4+ln(greatest(coalesce(m.view_count,0),0)+1))::numeric,
        m.created_at::timestamptz from recent_listings m
    )
    insert into app_private.feed_candidate_scores(content_type,content_id,baseline_score,published_at,refreshed_at)
    select content_type,content_id,baseline_score,published_at,now() from candidates
    on conflict (content_type,content_id) do update
      set baseline_score=excluded.baseline_score,published_at=excluded.published_at,refreshed_at=now();

  get diagnostics changed_rows = row_count;
  -- Candidates older than a retention window are discarded; downstream
  -- feed reads MUST re-check content visibility/RLS before returning items.
  delete from app_private.feed_candidate_scores
   where refreshed_at < now() - interval '2 days';

  return jsonb_build_object('refreshed_candidates',changed_rows,'refreshed_at',now());
end;
$$;
revoke all on function public.refresh_feed_candidate_scores(integer) from public, anon, authenticated;
grant execute on function public.refresh_feed_candidate_scores(integer) to service_role;

-- STAGING EXIT CHECKS before setting FEED_CANDIDATE_REFRESH_ENABLED=true:
-- 1. Private schema/table remain inaccessible to anon/authenticated.
-- 2. Repeated/multiple schedulers cannot bypass 15min cooldown.
-- 3. EXPLAIN (ANALYZE, BUFFERS) on representative synthetic data.
-- 4. Candidate read RPC must enforce visibility, author blocks, hides,
--    follows, recent engagement, policy filters and opt-out preferences.
-- 5. Populate novel candidates only after reviewing novel privacy/status.
-- 6. Do not switch For You API to this cache until equivalent quality tests.
