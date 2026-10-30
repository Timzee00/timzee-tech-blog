-- Preserve the original personalized feed logic; add only server-enforced region availability.
CREATE OR REPLACE FUNCTION public.get_personalized_feed(p_limit integer DEFAULT 30, p_content_type text DEFAULT 'all'::text)
 RETURNS TABLE(content_type text, content_id uuid, title text, excerpt text, image_url text, author_id uuid, author_name text, category text, tags text[], score numeric, created_at timestamp with time zone, reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with viewer as (select auth.uid()::uuid as user_id),
  followed_authors as (select target_id from public.follows where follower_id=(select user_id from viewer) and target_type='author'),
  followed_topics as (select target_id from public.follows where follower_id=(select user_id from viewer) and target_type='topic'),
  liked_tags as (select distinct unnest(coalesce(p.tags,'{}'::text[])) as tag from public.post_likes l join public.posts p on p.id=l.post_id where l.user_id=(select user_id from viewer)),
  negative as (select ucf.content_type,ucf.content_id from public.user_content_feedback ucf where ucf.user_id=(select user_id from viewer) and ucf.action in('not_interested','hide')),
  post_feed as (
    select 'post'::text as content_type,p.id as content_id,p.title as title,
      left(regexp_replace(coalesce(p.content,''),'<[^>]+>',' ','g'),180) as excerpt,p.cover as image_url,p.author_id as author_id,
      coalesce(p.author_name,'Member') as author_name,coalesce(c.name,'General') as category,coalesce(p.tags,'{}'::text[]) as tags,
      (8*(1.0/(1.0+greatest(extract(epoch from(now()-coalesce(p.publish_at,p.created_at)))/86400.0,0)))+
       case when exists(select 1 from followed_authors f where f.target_id=p.author_id::text) then 7 else 0 end+
       case when exists(select 1 from public.bookmarks b where b.user_id=(select user_id from viewer) and b.post_id=p.id) then 4 else 0 end+
       case when exists(select 1 from unnest(coalesce(p.tags,'{}'::text[])) z where z in(select tag from liked_tags)) then 5 else 0 end+
       ln(greatest(coalesce(p.views,0),0)+1)*0.55+coalesce((select count(*) from public.post_likes x where x.post_id=p.id),0)*1.4+
       coalesce((select count(*) from public.comments x where x.post_id=p.id and coalesce(x.status,'approved')<>'deleted'),0)*2.0+
       coalesce((select count(*) from public.post_shares x where x.post_id=p.id),0)*1.2)::numeric as score,
      coalesce(p.publish_at,p.created_at)::timestamptz as created_at,
      case when exists(select 1 from followed_authors f where f.target_id=p.author_id::text) then 'From an author you follow'
           when exists(select 1 from unnest(coalesce(p.tags,'{}'::text[])) z where z in(select tag from liked_tags)) then 'Based on topics you engage with'
           else 'Popular and recent in Tech Hub' end as reason
    from public.posts p left join public.categories c on c.id=p.category_id
    where lower(coalesce(p.status,''))='published' and coalesce(p.publish_at,p.created_at)<=now() and not exists(select 1 from negative n where n.content_type='post' and n.content_id=p.id)
  ),
  discussion_feed as (
    select 'discussion'::text as content_type,t.id as content_id,t.title as title,left(regexp_replace(coalesce(t.description,''),'<[^>]+>',' ','g'),180) as excerpt,t.media_url as image_url,
      t.author_id as author_id,coalesce(t.author_name,'Member') as author_name,coalesce(tt.name,'Discussion') as category,'{}'::text[] as tags,
      (7*(1.0/(1.0+greatest(extract(epoch from(now()-coalesce(t.updated_at,t.created_at)))/86400.0,0)))+
       case when exists(select 1 from followed_topics f where f.target_id=t.id::text) then 8 else 0 end+
       case when exists(select 1 from followed_authors f where f.target_id=t.author_id::text) then 4 else 0 end+
       coalesce((select count(*) from public.discussion_messages m where m.topic_id=t.id),0)*1.6)::numeric as score,
      coalesce(t.updated_at,t.created_at)::timestamptz as created_at,
      case when exists(select 1 from followed_topics f where f.target_id=t.id::text) then 'From a community you follow' else 'Active discussion' end as reason
    from public.discussion_topics t left join public.topic_types tt on tt.id=t.topic_type_id
    where not exists(select 1 from negative n where n.content_type='discussion' and n.content_id=t.id)
  ),
  video_feed as (
    select 'video'::text as content_type,v.id as content_id,v.title as title,left(coalesce(v.description,''),180) as excerpt,v.thumbnail_url as image_url,v.user_id as author_id,
      coalesce(v.author_name,'Member') as author_name,coalesce(v.category,'Videos') as category,coalesce(v.tags,'{}'::text[]) as tags,
      (6*(1.0/(1.0+greatest(extract(epoch from(now()-v.created_at))/86400.0,0)))+coalesce(v.like_count,0)*1.6+coalesce(v.comment_count,0)*2.0+
       ln(greatest(coalesce(v.view_count,0),0)+1)*0.7+case when exists(select 1 from followed_authors f where f.target_id=v.user_id::text) then 6 else 0 end)::numeric as score,
      v.created_at::timestamptz as created_at,
      case when exists(select 1 from followed_authors f where f.target_id=v.user_id::text) then 'From a creator you follow' else 'Recommended for you' end as reason
    from public.videos v where coalesce(v.is_public,true) and not exists(select 1 from negative n where n.content_type='video' and n.content_id=v.id)
  ),
  novel_feed as (
    select 'novel'::text as content_type,n.id as content_id,n.title as title,left(coalesce(n.synopsis,''),180) as excerpt,n.cover_url as image_url,n.author_id as author_id,
      coalesce(n.author_name,'Author') as author_name,coalesce(n.genre,'Novels') as category,coalesce(n.tags,'{}'::text[]) as tags,
      (5*(1.0/(1.0+greatest(extract(epoch from(now()-n.created_at))/86400.0,0)))+coalesce(n.likes,0)*1.3+ln(greatest(coalesce(n.views,0),0)+1)*0.7+
       case when exists(select 1 from public.novel_subscriptions s where s.user_id=(select user_id from viewer) and s.novel_id=n.id) then 6 else 0 end+
       case when exists(select 1 from followed_authors f where f.target_id=n.author_id::text) then 5 else 0 end)::numeric as score,
      n.updated_at::timestamptz as created_at,
      case when exists(select 1 from public.novel_subscriptions s where s.user_id=(select user_id from viewer) and s.novel_id=n.id) then 'From a story you follow' else 'Recommended reading' end as reason
    from public.novels n where not exists(select 1 from negative x where x.content_type='novel' and x.content_id=n.id)
  ),
  marketplace_feed as (
    select 'marketplace'::text as content_type,m.id as content_id,m.title as title,left(coalesce(m.description,''),180) as excerpt,coalesce(m.images[1],null) as image_url,m.user_id as author_id,
      coalesce(m.seller_name,'Seller') as author_name,coalesce(m.category,'Marketplace') as category,'{}'::text[] as tags,
      (4*(1.0/(1.0+greatest(extract(epoch from(now()-m.created_at))/86400.0,0)))+ln(greatest(coalesce(m.view_count,0),0)+1)*1.2+case when m.user_id=(select user_id from viewer) then -5 else 0 end)::numeric as score,
      m.created_at::timestamptz as created_at,
      case when m.user_id=(select user_id from viewer) then 'Your listing' else 'Fresh marketplace listing' end as reason
    from public.marketplace_items m where coalesce(m.is_available,true) and not exists(select 1 from negative x where x.content_type='marketplace' and x.content_id=m.id)
  ),
  all_content as (
    select * from post_feed union all select * from discussion_feed union all select * from video_feed union all select * from novel_feed union all select * from marketplace_feed
  )
  select * from all_content
  where (coalesce(p_content_type,'all')='all' or content_type=p_content_type)
    and public.blipmood_feature_allowed('fyp_recommendations')
  order by score desc,created_at desc
  limit greatest(1,least(coalesce(p_limit,30),50));
$function$
