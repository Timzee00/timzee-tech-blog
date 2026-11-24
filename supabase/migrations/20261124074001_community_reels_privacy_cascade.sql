-- Resync child media when a parent thread or community changes publication/privacy state.
CREATE OR REPLACE FUNCTION private.sync_community_reel_children_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE x record;
BEGIN
  IF TG_TABLE_NAME='community_threads' THEN
    FOR x IN
      SELECT m.thread_id,m.position,m.media_url,m.media_type,t.author_id,t.author_name,
        t.title,t.body,c.category,t.created_at
      FROM public.community_thread_media m
      JOIN public.community_threads t ON t.id=m.thread_id
      JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE t.id=NEW.id
    LOOP
      PERFORM private.sync_community_reel_source(
        'community_thread_media',
        'community_thread_media:'||x.thread_id::text||':'||x.position::text,
        x.media_url,x.media_type,x.author_id,x.author_name,x.title,x.body,x.category,x.created_at
      );
    END LOOP;
    FOR x IN
      SELECT m.id,m.media_url,m.media_type,m.author_id,m.author_name,m.body,m.created_at,
        coalesce(d.category,c.category) category,coalesce(d.title,t.title) title
      FROM public.discussion_messages m
      LEFT JOIN public.discussion_topics d ON d.id=m.topic_id
      LEFT JOIN public.community_threads t ON t.id=m.thread_id
      LEFT JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE m.thread_id=NEW.id AND m.media_type='video'
    LOOP
      PERFORM private.sync_community_reel_source(
        'discussion_message','discussion_message:'||x.id::text,
        x.media_url,x.media_type,x.author_id,x.author_name,x.title,x.body,x.category,x.created_at
      );
    END LOOP;
  ELSIF TG_TABLE_NAME='discussion_topics' THEN
    FOR x IN
      SELECT t.id,t.media_url,t.media_type,t.author_id,t.author_name,t.title,t.body,c.category,t.created_at
      FROM public.community_threads t JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE t.community_id=NEW.id
    LOOP
      PERFORM private.sync_community_reel_source(
        'community_thread','community_thread:'||x.id::text,
        x.media_url,x.media_type,x.author_id,x.author_name,x.title,x.body,x.category,x.created_at
      );
    END LOOP;
    FOR x IN
      SELECT m.thread_id,m.position,m.media_url,m.media_type,t.author_id,t.author_name,
        t.title,t.body,c.category,t.created_at
      FROM public.community_thread_media m
      JOIN public.community_threads t ON t.id=m.thread_id
      JOIN public.discussion_topics c ON c.id=t.community_id
      WHERE t.community_id=NEW.id
    LOOP
      PERFORM private.sync_community_reel_source(
        'community_thread_media',
        'community_thread_media:'||x.thread_id::text||':'||x.position::text,
        x.media_url,x.media_type,x.author_id,x.author_name,x.title,x.body,x.category,x.created_at
      );
    END LOOP;
    FOR x IN
      SELECT m.id,m.media_url,m.media_type,m.author_id,m.author_name,m.body,m.created_at,
        d.category,d.title
      FROM public.discussion_messages m
      JOIN public.discussion_topics d ON d.id=m.topic_id
      WHERE m.topic_id=NEW.id AND m.media_type='video'
    LOOP
      PERFORM private.sync_community_reel_source(
        'discussion_message','discussion_message:'||x.id::text,
        x.media_url,x.media_type,x.author_id,x.author_name,x.title,x.body,x.category,x.created_at
      );
    END LOOP;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.sync_community_reel_children_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_threads_reel_children_sync ON public.community_threads;
CREATE TRIGGER community_threads_reel_children_sync
AFTER UPDATE OF status, community_id ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION private.sync_community_reel_children_trigger();

DROP TRIGGER IF EXISTS discussion_topics_reel_children_sync ON public.discussion_topics;
CREATE TRIGGER discussion_topics_reel_children_sync
AFTER UPDATE OF visibility, community_state ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION private.sync_community_reel_children_trigger();
