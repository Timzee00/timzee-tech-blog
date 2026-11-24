-- Extend Reels discovery to public Community and Discussion media.
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS videos_source_key_unique
  ON public.videos(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS videos_source_kind_created_idx
  ON public.videos(source_kind, created_at DESC) WHERE source_kind IS NOT NULL;

CREATE OR REPLACE FUNCTION private.is_public_reel_source(
  p_kind text, p_key text, p_url text, p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE a uuid; b text;
BEGIN
  IF p_kind = 'community_thread' THEN
    a := split_part(p_key, ':', 2)::uuid;
    RETURN EXISTS (
      SELECT 1 FROM public.community_threads t
      JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE t.id=a AND t.media_type='video' AND t.media_url=p_url
        AND t.author_id=p_user_id AND t.status='published'
        AND c.visibility='public' AND c.community_state='active'
    );
  ELSIF p_kind = 'community_thread_media' THEN
    a := split_part(p_key, ':', 2)::uuid;
    b := split_part(p_key, ':', 3);
    RETURN EXISTS (
      SELECT 1 FROM public.community_thread_media m
      JOIN public.community_threads t ON t.id=m.thread_id
      JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE m.thread_id=a AND m.position::text=b AND m.media_type='video'
        AND m.media_url=p_url AND m.added_by=p_user_id
        AND t.status='published' AND c.visibility='public'
        AND c.community_state='active'
    );
  ELSIF p_kind = 'discussion_message' THEN
    a := split_part(p_key, ':', 2)::uuid;
    RETURN EXISTS (
      SELECT 1 FROM public.discussion_messages m
      WHERE m.id=a AND m.media_type='video' AND m.media_url=p_url
        AND m.author_id=p_user_id AND m.moderation_status='published'
        AND (
          EXISTS (SELECT 1 FROM public.discussion_topics d
            WHERE d.id=m.topic_id AND d.visibility='public' AND d.community_state='active')
          OR EXISTS (SELECT 1 FROM public.community_threads t
            JOIN public.discussion_topics c ON c.id=t.community_id
            WHERE t.id=m.thread_id AND t.status='published'
              AND c.visibility='public' AND c.community_state='active')
        )
    );
  ELSIF p_kind = 'discussion_topic' THEN
    a := split_part(p_key, ':', 2)::uuid;
    RETURN EXISTS (
      SELECT 1 FROM public.discussion_topics d
      WHERE d.id=a AND d.media_type='video' AND d.media_url=p_url
        AND d.author_id=p_user_id AND d.visibility='public'
        AND d.community_state='active'
    );
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END
$fn$;
REVOKE ALL ON FUNCTION private.is_public_reel_source(text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- Extend the existing upload gate without weakening direct-upload ownership checks.
CREATE OR REPLACE FUNCTION private.platform_video_upload_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
DECLARE file_path text; bytes bigint; max_bytes bigint; total_bytes bigint;
        budget bigint; pause_pct integer;
BEGIN
  IF NEW.source_kind IS NOT NULL THEN
    IF NEW.source_key IS NULL OR NOT private.is_public_reel_source(
      NEW.source_kind, NEW.source_key, NEW.video_url, NEW.user_id
    ) THEN
      RAISE EXCEPTION 'Invalid public community/discussion video source' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_media_id IS NOT NULL OR NEW.source_post_id IS NOT NULL THEN
    IF NEW.source_media_id IS NULL OR NEW.source_post_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.post_media pm JOIN public.posts p ON p.id=pm.post_id
      WHERE pm.id=NEW.source_media_id AND pm.post_id=NEW.source_post_id
        AND pm.media_type='video' AND pm.url=NEW.video_url
        AND p.author_id=NEW.user_id AND p.status='published'
        AND (p.publish_at IS NULL OR p.publish_at <= (now() AT TIME ZONE 'UTC'))
    ) THEN
      RAISE EXCEPTION 'Invalid public post video source' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS DISTINCT FROM NEW.user_id OR NOT public.blipmood_feature_allowed('video_uploads') THEN
    RAISE EXCEPTION 'Video uploads are unavailable for this account or region' USING ERRCODE='42501';
  END IF;
  SELECT max_video_upload_bytes, media_budget_bytes, upload_pause_pct
    INTO max_bytes, budget, pause_pct FROM public.platform_capacity_settings WHERE singleton=true;
  IF NEW.video_url NOT LIKE '%/storage/v1/object/public/media/videos/%' THEN
    RAISE EXCEPTION 'New videos must come from managed public video storage' USING ERRCODE='22023';
  END IF;
  file_path := split_part(NEW.video_url, '/storage/v1/object/public/media/', 2);
  file_path := split_part(file_path, '?', 1);
  IF file_path NOT LIKE 'videos/' || NEW.user_id::text || '/%' THEN
    RAISE EXCEPTION 'Video does not belong to this uploader' USING ERRCODE='42501';
  END IF;
  SELECT (o.metadata->>'size')::bigint INTO bytes FROM storage.objects o
    WHERE o.bucket_id='media' AND o.name=file_path LIMIT 1;
  IF bytes IS NULL OR bytes<=0 THEN
    RAISE EXCEPTION 'Video object not found in managed storage' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum((o.metadata->>'size')::bigint),0) INTO total_bytes
    FROM storage.objects o WHERE o.bucket_id='media';
  IF total_bytes*100 >= budget*pause_pct THEN
    RAISE EXCEPTION 'Media upload capacity safeguard is active' USING ERRCODE='54000';
  END IF;
  IF total_bytes*100 >= budget*80 THEN max_bytes := least(max_bytes,6291456); END IF;
  IF bytes>max_bytes THEN
    RAISE EXCEPTION 'Video file exceeds the available storage upload limit' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$function$;

-- Mirrors are database-owned and cannot be forged by clients.
DROP POLICY IF EXISTS "Blipmood client cannot insert post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot insert post video mirrors" ON public.videos
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (source_post_id IS NULL AND source_media_id IS NULL AND source_kind IS NULL);
DROP POLICY IF EXISTS "Blipmood client cannot update post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot update post video mirrors" ON public.videos
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (source_post_id IS NULL AND source_media_id IS NULL AND source_kind IS NULL)
  WITH CHECK (source_post_id IS NULL AND source_media_id IS NULL AND source_kind IS NULL);
DROP POLICY IF EXISTS "Blipmood client cannot delete post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot delete post video mirrors" ON public.videos
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (source_post_id IS NULL AND source_media_id IS NULL AND source_kind IS NULL);

CREATE OR REPLACE FUNCTION private.sync_community_reel_source(
  p_kind text, p_key text, p_url text, p_media_type text, p_user_id uuid,
  p_author_name text, p_title text, p_description text, p_category text,
  p_created_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
  IF lower(coalesce(p_media_type,'')) <> 'video' OR p_url IS NULL OR p_user_id IS NULL
     OR NOT private.is_public_reel_source(p_kind,p_key,p_url,p_user_id) THEN
    DELETE FROM public.videos WHERE source_key=p_key;
    RETURN;
  END IF;
  INSERT INTO public.videos(
    id,user_id,author_name,title,description,video_url,thumbnail_url,duration,
    tags,category,is_public,view_count,like_count,comment_count,created_at,updated_at,
    source_kind,source_key
  ) VALUES (
    gen_random_uuid(),p_user_id,p_author_name,left(coalesce(p_title,'Community video'),180),
    left(coalesce(p_description,''),1800),p_url,NULL,NULL,ARRAY[]::text[],
    coalesce(nullif(p_category,''),'Community'),true,0,0,0,coalesce(p_created_at,now()),now(),
    p_kind,p_key
  )
  ON CONFLICT (source_key) WHERE source_key IS NOT NULL
  DO UPDATE SET user_id=EXCLUDED.user_id,author_name=EXCLUDED.author_name,
    title=EXCLUDED.title,description=EXCLUDED.description,video_url=EXCLUDED.video_url,
    category=EXCLUDED.category,is_public=true,updated_at=now();
END
$fn$;
REVOKE ALL ON FUNCTION private.sync_community_reel_source(text,text,text,text,uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.community_reel_media_sync_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE r jsonb; k text; u text; mt text; uid uuid; an text; ttl text;
        descr text; cat text; ts timestamptz; parent_id uuid; pos text;
BEGIN
  r := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='community_threads' THEN
    k := 'community_thread:'||(r->>'id'); u:=r->>'media_url'; mt:=r->>'media_type';
    uid:=nullif(r->>'author_id','')::uuid; an:=r->>'author_name'; ttl:=r->>'title';
    descr:=r->>'body'; parent_id:=nullif(r->>'community_id','')::uuid;
    SELECT category INTO cat FROM public.discussion_topics WHERE id=parent_id;
    ts:=nullif(r->>'created_at','')::timestamptz;
  ELSIF TG_TABLE_NAME='community_thread_media' THEN
    parent_id:=nullif(r->>'thread_id','')::uuid; pos:=r->>'position';
    k:='community_thread_media:'||parent_id::text||':'||pos;
    u:=r->>'media_url'; mt:=r->>'media_type';
    SELECT t.author_name,t.title,t.body,c.category,t.author_id,t.created_at
      INTO an,ttl,descr,cat,uid,ts
      FROM public.community_threads t JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE t.id=parent_id;
  ELSIF TG_TABLE_NAME='discussion_messages' THEN
    k:='discussion_message:'||(r->>'id'); u:=r->>'media_url'; mt:=r->>'media_type';
    uid:=nullif(r->>'author_id','')::uuid; an:=r->>'author_name'; descr:=r->>'body';
    ttl:=left(coalesce(r->>'body','Community discussion'),120);
    SELECT coalesce(d.category,c.category),coalesce(d.title,t.title)
      INTO cat,ttl FROM public.discussion_topics d
      LEFT JOIN public.community_threads t ON t.id=nullif(r->>'thread_id','')::uuid
      LEFT JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE d.id=nullif(r->>'topic_id','')::uuid OR t.id=nullif(r->>'thread_id','')::uuid
      LIMIT 1;
    ts:=nullif(r->>'created_at','')::timestamptz;
  ELSE
    k:='discussion_topic:'||(r->>'id'); u:=r->>'media_url'; mt:=r->>'media_type';
    uid:=nullif(r->>'author_id','')::uuid; an:=r->>'author_name'; ttl:=r->>'title';
    descr:=r->>'description'; cat:=r->>'category';
    ts:=nullif(r->>'created_at','')::timestamptz;
  END IF;
  IF TG_OP='DELETE' THEN
    DELETE FROM public.videos WHERE source_key=k;
    RETURN OLD;
  END IF;
  PERFORM private.sync_community_reel_source(
    CASE TG_TABLE_NAME WHEN 'community_threads' THEN 'community_thread'
      WHEN 'community_thread_media' THEN 'community_thread_media'
      WHEN 'discussion_messages' THEN 'discussion_message'
      ELSE 'discussion_topic' END,
    k,u,mt,uid,an,ttl,descr,cat,ts
  );
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.community_reel_media_sync_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_threads_reel_sync ON public.community_threads;
CREATE TRIGGER community_threads_reel_sync AFTER INSERT OR UPDATE OR DELETE ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION private.community_reel_media_sync_trigger();
DROP TRIGGER IF EXISTS community_thread_media_reel_sync ON public.community_thread_media;
CREATE TRIGGER community_thread_media_reel_sync AFTER INSERT OR UPDATE OR DELETE ON public.community_thread_media
FOR EACH ROW EXECUTE FUNCTION private.community_reel_media_sync_trigger();
DROP TRIGGER IF EXISTS discussion_messages_reel_sync ON public.discussion_messages;
CREATE TRIGGER discussion_messages_reel_sync AFTER INSERT OR UPDATE OR DELETE ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION private.community_reel_media_sync_trigger();
DROP TRIGGER IF EXISTS discussion_topics_reel_sync ON public.discussion_topics;
CREATE TRIGGER discussion_topics_reel_sync AFTER INSERT OR UPDATE OR DELETE ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION private.community_reel_media_sync_trigger();

DO $fn$
DECLARE x record;
BEGIN
  FOR x IN
    SELECT 'community_thread'::text kind,'community_thread:'||t.id::text skey,
      t.media_url url,t.media_type mt,t.author_id uid,t.author_name an,t.title ttl,t.body descr,
      c.category cat,t.created_at ts
    FROM public.community_threads t JOIN public.discussion_topics c ON c.id=t.community_id
    WHERE t.media_type='video' AND t.status='published' AND c.visibility='public' AND c.community_state='active'
    UNION ALL
    SELECT 'community_thread_media','community_thread_media:'||m.thread_id::text||':'||m.position::text,
      m.media_url,m.media_type,t.author_id,t.author_name,t.title,t.body,c.category,t.created_at
    FROM public.community_thread_media m JOIN public.community_threads t ON t.id=m.thread_id
    JOIN public.discussion_topics c ON c.id=t.community_id
    WHERE m.media_type='video' AND t.status='published' AND c.visibility='public' AND c.community_state='active'
    UNION ALL
    SELECT 'discussion_message','discussion_message:'||m.id::text,m.media_url,m.media_type,
      m.author_id,m.author_name,left(coalesce(m.body,'Discussion video'),120),m.body,
      coalesce(d.category,c.category),m.created_at
    FROM public.discussion_messages m
    LEFT JOIN public.discussion_topics d ON d.id=m.topic_id
    LEFT JOIN public.community_threads t ON t.id=m.thread_id
    LEFT JOIN public.discussion_topics c ON c.id=t.community_id
    WHERE m.media_type='video' AND m.moderation_status='published'
      AND ((d.id IS NOT NULL AND d.visibility='public' AND d.community_state='active')
        OR (t.id IS NOT NULL AND t.status='published' AND c.visibility='public' AND c.community_state='active'))
    UNION ALL
    SELECT 'discussion_topic','discussion_topic:'||d.id::text,d.media_url,d.media_type,
      d.author_id,d.author_name,d.title,d.description,d.category,d.created_at
    FROM public.discussion_topics d
    WHERE d.media_type='video' AND d.visibility='public' AND d.community_state='active'
  LOOP
    PERFORM private.sync_community_reel_source(x.kind,x.skey,x.url,x.mt,x.uid,x.an,x.ttl,x.descr,x.cat,x.ts);
  END LOOP;
END
$fn$;

SELECT private.refresh_blipmood_video_candidates();
