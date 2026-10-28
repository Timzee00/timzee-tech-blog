-- Keep the stored video engagement fields consistent with actual reactions.
-- The personalized feed's first candidate-selection step uses these fields;
-- previously they stayed at zero even after confirmed likes/comments.
-- Trigger functions live in an unexposed, RLS-isolated schema.
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.adjust_video_like_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE public.videos SET like_count=greatest(0,coalesce(like_count,0)+1)
    WHERE id=NEW.video_id;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    UPDATE public.videos SET like_count=greatest(0,coalesce(like_count,0)-1)
    WHERE id=OLD.video_id;
    RETURN OLD;
  ELSIF NEW.video_id IS DISTINCT FROM OLD.video_id THEN
    UPDATE public.videos SET like_count=greatest(0,coalesce(like_count,0)-1)
    WHERE id=OLD.video_id;
    UPDATE public.videos SET like_count=greatest(0,coalesce(like_count,0)+1)
    WHERE id=NEW.video_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.adjust_video_comment_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE public.videos SET comment_count=greatest(0,coalesce(comment_count,0)+1)
    WHERE id=NEW.video_id;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    UPDATE public.videos SET comment_count=greatest(0,coalesce(comment_count,0)-1)
    WHERE id=OLD.video_id;
    RETURN OLD;
  ELSIF NEW.video_id IS DISTINCT FROM OLD.video_id THEN
    UPDATE public.videos SET comment_count=greatest(0,coalesce(comment_count,0)-1)
    WHERE id=OLD.video_id;
    UPDATE public.videos SET comment_count=greatest(0,coalesce(comment_count,0)+1)
    WHERE id=NEW.video_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.adjust_video_like_counter() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION app_private.adjust_video_comment_counter() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS videos_likes_count_sync ON public.video_likes;
CREATE TRIGGER videos_likes_count_sync
AFTER INSERT OR DELETE OR UPDATE OF video_id ON public.video_likes
FOR EACH ROW EXECUTE FUNCTION app_private.adjust_video_like_counter();

DROP TRIGGER IF EXISTS videos_comments_count_sync ON public.video_comments;
CREATE TRIGGER videos_comments_count_sync
AFTER INSERT OR DELETE OR UPDATE OF video_id ON public.video_comments
FOR EACH ROW EXECUTE FUNCTION app_private.adjust_video_comment_counter();

-- Backfill only actual historical interactions, not guessed views.
UPDATE public.videos v
SET like_count=(SELECT count(*)::integer FROM public.video_likes l WHERE l.video_id=v.id),
    comment_count=(SELECT count(*)::integer FROM public.video_comments c WHERE c.video_id=v.id)
WHERE coalesce(v.like_count,-1) IS DISTINCT FROM
  (SELECT count(*)::integer FROM public.video_likes l WHERE l.video_id=v.id)
 OR coalesce(v.comment_count,-1) IS DISTINCT FROM
  (SELECT count(*)::integer FROM public.video_comments c WHERE c.video_id=v.id);
