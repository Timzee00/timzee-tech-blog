-- Verified creator insights are aggregated server-side and scoped to the caller.
CREATE OR REPLACE FUNCTION public.verified_story_insights(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_verified boolean;
 v_result jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT p.is_verified INTO v_verified FROM public.profiles p WHERE p.id=v_actor;
 IF coalesce(v_verified,false)=false THEN RAISE EXCEPTION 'Verified creator insights require verification' USING ERRCODE='42501'; END IF;
 IF p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Choose 1 to 90 days' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object(
 'days',p_days,
 'total_stories',count(*),
 'likes',coalesce(sum(x.likes),0),
 'visible_views',coalesce(sum(x.views),0),
 'public_comments',coalesce(sum(x.comments),0),
 'reshares',coalesce(sum(x.reshares),0),
 'top_statuses',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'id',top.id,'created_at',top.created_at,'likes',top.likes,
    'views',top.views,'comments',top.comments,'reshares',top.reshares))
   FROM(
    SELECT s2.id,s2.created_at,
     (SELECT count(*) FROM public.story_likes l WHERE l.story_id=s2.id) AS likes,
     (SELECT count(*) FROM public.story_views v WHERE v.story_id=s2.id) AS views,
     (SELECT count(*) FROM public.story_comments c WHERE c.story_id=s2.id) AS comments,
     (SELECT count(*) FROM public.stories r WHERE r.original_story_id=s2.id) AS reshares
    FROM public.stories s2 WHERE s2.user_id=v_actor
      AND s2.created_at>=now()-make_interval(days=>p_days)
    ORDER BY likes DESC,views DESC LIMIT 5
   ) top),'[]'::jsonb)
 ) INTO v_result
 FROM(
  SELECT s.id,
    (SELECT count(*) FROM public.story_likes l WHERE l.story_id=s.id) AS likes,
    (SELECT count(*) FROM public.story_views v WHERE v.story_id=s.id) AS views,
    (SELECT count(*) FROM public.story_comments c WHERE c.story_id=s.id) AS comments,
    (SELECT count(*) FROM public.stories r WHERE r.original_story_id=s.id) AS reshares
  FROM public.stories s WHERE s.user_id=v_actor
    AND s.created_at>=now()-make_interval(days=>p_days)
 ) x;
 RETURN v_result||jsonb_build_object('view_note','Only opted-in status views are counted');
END $$;
REVOKE ALL ON FUNCTION public.verified_story_insights(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.verified_story_insights(integer) TO authenticated;