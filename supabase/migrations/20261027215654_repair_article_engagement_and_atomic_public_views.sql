-- Applied on 2026-10-27 as migration repair_article_engagement_and_atomic_public_views.
-- Public article engagement is bounded and RLS-aware; views are atomic and
-- idempotent per browser token/day. It must not permit unpublished post views.
CREATE OR REPLACE FUNCTION public.get_post_engagement(p_post_ids uuid[])
RETURNS TABLE(post_id uuid,like_count bigint,comment_count bigint,liked_by_me boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
  SELECT visible.id,
    (SELECT count(*) FROM public.post_likes pl WHERE pl.post_id=visible.id),
    (SELECT count(*) FROM public.comments c
       WHERE c.post_id=visible.id AND c.status='approved'),
    EXISTS (SELECT 1 FROM public.post_likes pl
      WHERE pl.post_id=visible.id AND pl.user_id=(SELECT auth.uid()))
  FROM (
    SELECT DISTINCT p.id
    FROM unnest(coalesce(p_post_ids,'{}'::uuid[])) ids(id)
    JOIN public.posts p ON p.id=ids.id
    LIMIT 24
  ) visible;
$function$;
REVOKE ALL ON FUNCTION public.get_post_engagement(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_post_engagement(uuid[]) TO anon,authenticated;

CREATE TABLE IF NOT EXISTS private.post_view_dedupe (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  visit_token uuid NOT NULL,
  viewed_on date NOT NULL DEFAULT (timezone('utc',now()))::date,
  PRIMARY KEY(post_id,visit_token,viewed_on)
);
REVOKE ALL ON private.post_view_dedupe FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_post_view(
  p_post_id uuid,p_visit_token uuid
) RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
 v_views bigint;
 v_inserted boolean := false;
BEGIN
 IF p_post_id IS NULL OR p_visit_token IS NULL THEN
   RAISE EXCEPTION 'Invalid article view' USING ERRCODE='22023';
 END IF;
 SELECT p.views INTO v_views FROM public.posts p
 WHERE p.id=p_post_id AND p.status='published'
   AND (p.publish_at IS NULL OR p.publish_at<=timezone('utc',now()))
 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO private.post_view_dedupe(post_id,visit_token,viewed_on)
 VALUES(p_post_id,p_visit_token,(timezone('utc',now()))::date)
 ON CONFLICT DO NOTHING
 RETURNING true INTO v_inserted;
 IF coalesce(v_inserted,false) THEN
   UPDATE public.posts SET views=coalesce(views,0)+1
   WHERE id=p_post_id RETURNING views INTO v_views;
 END IF;
 RETURN v_views;
END
$function$;
REVOKE ALL ON FUNCTION public.record_post_view(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_view(uuid,uuid) TO anon,authenticated;
