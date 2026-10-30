
-- DB-enforced country rollout for supported write actions. Existing permitted
-- features stay allowed by default; no public content is removed.
drop policy if exists "Blipmood video storage feature gate" on storage.objects;
create policy "Blipmood video storage feature gate" on storage.objects
as restrictive for insert to authenticated with check (
 not (bucket_id='media' and
 (name like 'videos/%' or name like 'video-thumbnails/%'))
 or (select public.blipmood_feature_allowed('video_uploads'))
);
drop policy if exists "Blipmood marketplace create gate" on public.marketplace_items;
create policy "Blipmood marketplace create gate" on public.marketplace_items
as restrictive for insert to authenticated with check(
 (select public.blipmood_feature_allowed('marketplace'))
);
drop policy if exists "Blipmood Spaces create gate" on public.spaces_rooms;
create policy "Blipmood Spaces create gate" on public.spaces_rooms
as restrictive for insert to authenticated with check(
 (select public.blipmood_feature_allowed('live_spaces'))
);
drop policy if exists "Blipmood FX create gate" on public.member_profile_effects;
create policy "Blipmood FX create gate" on public.member_profile_effects
as restrictive for insert to authenticated with check(
 (select public.blipmood_feature_allowed('profile_fx'))
);
drop policy if exists "Blipmood FX update gate" on public.member_profile_effects;
create policy "Blipmood FX update gate" on public.member_profile_effects
as restrictive for update to authenticated
 using((select public.blipmood_feature_allowed('profile_fx')))
 with check((select public.blipmood_feature_allowed('profile_fx')));
-- FYP off is also enforced on the RPC. Following subscriptions remain accessible.
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
 where v.is_public=true
   and (p_mode='following' or public.blipmood_feature_allowed('fyp_recommendations'))
   and (p_mode='for-you' or (p_mode='following' and exists(
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
