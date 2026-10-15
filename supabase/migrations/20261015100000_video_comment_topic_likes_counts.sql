-- Likes for video comments and for the topic itself, separate from message votes.
create table if not exists public.video_comment_likes(
 id uuid primary key default gen_random_uuid(),
 comment_id uuid not null references public.video_comments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(comment_id,user_id)
);
create index if not exists video_comment_likes_comment_idx on public.video_comment_likes(comment_id);
alter table public.video_comment_likes enable row level security;
grant select on public.video_comment_likes to anon,authenticated;
grant insert,delete on public.video_comment_likes to authenticated;
drop policy if exists video_comment_likes_public_read on public.video_comment_likes;
create policy video_comment_likes_public_read on public.video_comment_likes
 for select using(true);
drop policy if exists video_comment_likes_author_insert on public.video_comment_likes;
create policy video_comment_likes_author_insert on public.video_comment_likes
 for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists video_comment_likes_author_delete on public.video_comment_likes;
create policy video_comment_likes_author_delete on public.video_comment_likes
 for delete to authenticated using(user_id=(select auth.uid()));

create table if not exists public.discussion_topic_likes(
 id uuid primary key default gen_random_uuid(),
 topic_id uuid not null references public.discussion_topics(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(topic_id,user_id)
);
create index if not exists discussion_topic_likes_topic_idx on public.discussion_topic_likes(topic_id);
alter table public.discussion_topic_likes enable row level security;
grant select on public.discussion_topic_likes to anon,authenticated;
grant insert,delete on public.discussion_topic_likes to authenticated;
drop policy if exists discussion_topic_likes_public_read on public.discussion_topic_likes;
create policy discussion_topic_likes_public_read on public.discussion_topic_likes for select using(true);
drop policy if exists discussion_topic_likes_author_insert on public.discussion_topic_likes;
create policy discussion_topic_likes_author_insert on public.discussion_topic_likes
 for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists discussion_topic_likes_author_delete on public.discussion_topic_likes;
create policy discussion_topic_likes_author_delete on public.discussion_topic_likes
 for delete to authenticated using(user_id=(select auth.uid()));

-- Bounded batched video counters for Reels and FYP; no N+1 count queries.
create or replace function public.video_social_counts(p_video_ids uuid[])
returns table(video_id uuid,like_count bigint,comment_count bigint)
language sql stable security invoker set search_path=pg_catalog,public
as $$
with ids as(
 select distinct unnest(p_video_ids[1:50]) as id
),likes as(
 select vl.video_id,count(*)::bigint n from public.video_likes vl join ids on ids.id=vl.video_id group by vl.video_id
),comments as(
 select vc.video_id,count(*)::bigint n from public.video_comments vc join ids on ids.id=vc.video_id group by vc.video_id
)
select ids.id,coalesce(likes.n,0),coalesce(comments.n,0)
from ids left join likes on likes.video_id=ids.id left join comments on comments.video_id=ids.id
$$;
revoke execute on function public.video_social_counts(uuid[]) from public;
grant execute on function public.video_social_counts(uuid[]) to anon,authenticated,service_role;