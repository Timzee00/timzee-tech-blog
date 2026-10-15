-- Bounded comment-like hydration for Reels; counts and viewer reaction together.
create or replace function public.video_comment_like_counts(p_comment_ids uuid[])
returns table(comment_id uuid, like_count bigint, viewer_liked boolean)
language sql stable security invoker set search_path=pg_catalog,public
as $$
with ids as(select distinct unnest(p_comment_ids[1:80]) id)
select ids.id,
       count(l.id)::bigint,
       bool_or(l.user_id=(select auth.uid())) is true
from ids left join public.video_comment_likes l on l.comment_id=ids.id
group by ids.id
$$;
revoke execute on function public.video_comment_like_counts(uuid[]) from public;
grant execute on function public.video_comment_like_counts(uuid[]) to anon,authenticated,service_role;