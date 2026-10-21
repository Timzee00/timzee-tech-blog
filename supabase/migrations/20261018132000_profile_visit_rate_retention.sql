CREATE INDEX IF NOT EXISTS profile_visits_viewer_daily_idx
 ON public.profile_visit_events(viewer_id,visit_date DESC);
CREATE OR REPLACE FUNCTION public.record_profile_visit(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_viewer uuid:=auth.uid();v_day date:=(now() at time zone 'UTC')::date;
 v_owner_opt_in boolean:=true;v_record boolean:=true;v_share boolean:=false;
 v_inserted boolean:=false;v_status text;
BEGIN
 IF v_viewer IS NULL OR p_profile_id IS NULL OR p_profile_id=v_viewer THEN RETURN false; END IF;
 SELECT p.account_status INTO v_status FROM public.profiles p WHERE p.id=p_profile_id;
 IF NOT FOUND OR coalesce(v_status,'active')<>'active' THEN RETURN false; END IF;
 SELECT coalesce((s.preferences#>>'{privacy,recordProfileVisits}')::boolean,true),
        coalesce((s.preferences#>>'{privacy,shareProfileVisits}')::boolean,false)
 INTO v_record,v_share FROM public.user_settings s WHERE s.user_id=v_viewer;
 IF coalesce(v_record,true)=false THEN RETURN false; END IF;
 -- Serialize a visitor's daily quota so many concurrent requests cannot bypass it.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_viewer::text,90216));
 IF (SELECT count(*) FROM public.profile_visit_events v
      WHERE v.viewer_id=v_viewer AND v.visit_date=v_day)>=100 THEN
   RETURN false;
 END IF;
 INSERT INTO public.profile_visit_events(profile_id,viewer_id,visit_date,share_identity)
 VALUES(p_profile_id,v_viewer,v_day,coalesce(v_share,false))
 ON CONFLICT DO NOTHING RETURNING true INTO v_inserted;
 IF NOT coalesce(v_inserted,false) THEN RETURN false; END IF;
 SELECT coalesce((s.preferences#>>'{notifications,profileViews}')::boolean,true)
 INTO v_owner_opt_in FROM public.user_settings s WHERE s.user_id=p_profile_id;
 IF coalesce(v_owner_opt_in,true) THEN
   INSERT INTO public.notifications(id,user_id,type,title,body,link_url,data,created_at)
   VALUES(gen_random_uuid(),p_profile_id,'profile_view',
     'New profile activity','Someone viewed your profile today. Open your profile for weekly insights.',
     '/profile.html',jsonb_build_object('visit_day',v_day::text,'profile_id',p_profile_id::text),now())
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN true;
END $function$
;
CREATE OR REPLACE FUNCTION public.cleanup_profile_visit_events()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE removed integer;
BEGIN
 IF current_user NOT IN ('postgres','service_role') THEN
   RAISE EXCEPTION 'Server maintenance only' USING ERRCODE='42501';
 END IF;
 -- Bound each maintenance tick so old-account cleanup does not lock millions of rows.
 DELETE FROM public.profile_visit_events WHERE ctid IN(
   SELECT ctid FROM public.profile_visit_events
   WHERE visit_date<(now() AT TIME ZONE 'UTC')::date-30
   LIMIT 5000
 );
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $function$
;
