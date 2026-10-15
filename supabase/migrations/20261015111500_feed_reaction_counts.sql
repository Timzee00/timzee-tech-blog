-- One bounded RPC to display reaction totals and viewer state on mixed feeds.
create or replace function public.feed_reaction_counts(p_type text,p_ids uuid[])
returns table(content_id uuid,like_count bigint,viewer_liked boolean)
language sql stable security invoker set search_path=pg_catalog,public
as $$
with ids as(select distinct unnest(p_ids[1:50]) id),
votes as(
 select pl.post_id as id,pl.user_id from public.post_likes pl where p_type='post'
 union all
 select vl.video_id,vl.user_id from public.video_likes vl where p_type='video'
 union all
 select dl.topic_id,dl.user_id from public.discussion_topic_likes dl where p_type='discussion'
)
select ids.id,count(v.user_id)::bigint,
       bool_or(v.user_id=(select auth.uid())) is true
from ids left join votes v on v.id=ids.id
where p_type in ('post','video','discussion')
group by ids.id
$$;
revoke execute on function public.feed_reaction_counts(text,uuid[]) from public;
grant execute on function public.feed_reaction_counts(text,uuid[]) to anon,authenticated,service_role;