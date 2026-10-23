-- Already applied to linked Timzee Tech Blog Supabase on 2026-10-23.
-- This security-definer RPC must not expose posts with NULL status.
-- Preserve the function's original permissions, return type and publish_at gate.
CREATE OR REPLACE FUNCTION public.my_tech_brief(p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, title text, slug text, cover text, category_name text, teaser text, created_at timestamp without time zone, interest_match boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT p.id,p.title,p.slug,p.cover,coalesce(c.name,'Technology') AS category_name,
 left(btrim(regexp_replace(coalesce(p.content,''),'<[^>]*>|\s+',' ','g')),260) AS teaser,
 p.created_at,
 EXISTS(SELECT 1 FROM public.community_user_interests i
 WHERE i.user_id=auth.uid() AND
 (lower(i.topic)=lower(coalesce(c.name,'')) OR
  lower(coalesce(p.title,'')) LIKE '%'||lower(i.topic)||'%')) AS interest_match
 FROM public.posts p
 LEFT JOIN public.categories c ON c.id=p.category_id
 WHERE p.status='published'
 AND (p.publish_at IS NULL OR p.publish_at<=timezone('utc',now()))
 ORDER BY
 EXISTS(SELECT 1 FROM public.community_user_interests i
 WHERE i.user_id=auth.uid() AND
 (lower(i.topic)=lower(coalesce(c.name,'')) OR
  lower(coalesce(p.title,'')) LIKE '%'||lower(i.topic)||'%')) DESC,
 p.created_at DESC,p.id DESC
 LIMIT least(greatest(coalesce(p_limit,5),1),5);
$function$

