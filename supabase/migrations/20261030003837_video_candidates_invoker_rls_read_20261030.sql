-- The invoker feed RPC needs read access to the candidate index.
-- RLS exposes only IDs of currently public videos, never any private metadata.
grant select on public.blipmood_video_candidates to anon,authenticated;
drop policy if exists "Candidates only for public videos" on public.blipmood_video_candidates;
create policy "Candidates only for public videos" on public.blipmood_video_candidates
 for select to anon,authenticated using(
 exists(select 1 from public.videos v where v.id=video_id and v.is_public=true)
);