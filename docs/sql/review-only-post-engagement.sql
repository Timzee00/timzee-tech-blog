-- REVIEW ONLY. Generate a proper migration after stage testing. No live SQL.
-- SECURITY INVOKER enforces existing RLS for public posts, approved comments
-- and public likes. Authenticated users' own liked-state uses auth.uid().
create or replace function public.get_post_engagement(p_post_ids uuid[])
returns table(post_id uuid, like_count bigint, comment_count bigint, liked_by_me boolean)
language sql stable security invoker set search_path = ''
as $$
  select visible.id,
    (select count(*) from public.post_likes pl where pl.post_id = visible.id),
    (select count(*) from public.comments c where c.post_id = visible.id and c.status = 'approved'),
    coalesce((select bool_or(pl.user_id = (select auth.uid()))
              from public.post_likes pl where pl.post_id = visible.id), false)
  from (
    select distinct p.id
    from unnest(p_post_ids) ids(post_id)
    join public.posts p on p.id = ids.post_id
    limit 24
  ) visible;
$$;
revoke all on function public.get_post_engagement(uuid[]) from public;
grant execute on function public.get_post_engagement(uuid[]) to anon, authenticated;
-- Verify with anon, member and admin under realistic RLS plus EXPLAIN
-- ANALYZE, then migrate and test 24 viral posts before promotion.
