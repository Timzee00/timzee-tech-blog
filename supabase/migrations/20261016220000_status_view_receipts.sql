
-- Status view receipts respect the viewer's receipt privacy choice.
CREATE TABLE IF NOT EXISTS public.story_views(
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 first_viewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(story_id,user_id)
);
CREATE INDEX IF NOT EXISTS story_views_author_lookup ON public.story_views(story_id,first_viewed_at DESC);
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_views FROM anon,authenticated;
GRANT SELECT ON public.story_views TO authenticated;
DROP POLICY IF EXISTS "View own and creator-visible status receipts" ON public.story_views;
CREATE POLICY "View own and creator-visible status receipts" ON public.story_views FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR (
 EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id AND s.user_id=auth.uid()) AND
 NOT EXISTS(SELECT 1 FROM public.chat_privacy cp WHERE cp.user_id=story_views.user_id AND cp.read_receipts=false)
 ));
CREATE OR REPLACE FUNCTION public.record_status_view(p_story_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_story public.stories%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RETURN; END IF;
 SELECT s.* INTO v_story FROM public.stories s WHERE s.id=p_story_id AND s.expires_at>now();
 IF NOT FOUND OR v_story.user_id=v_actor THEN RETURN; END IF;
 IF NOT(v_story.visibility='public' OR EXISTS(SELECT 1 FROM public.friendships f
 WHERE f.status='accepted' AND ((f.requester_id=v_actor AND f.addressee_id=v_story.user_id)
 OR(f.addressee_id=v_actor AND f.requester_id=v_story.user_id)))) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.chat_privacy cp WHERE cp.user_id=v_actor AND cp.read_receipts=false) THEN RETURN; END IF;
 INSERT INTO public.story_views(story_id,user_id) VALUES(p_story_id,v_actor)
 ON CONFLICT(story_id,user_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_status_view(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_status_view(uuid) TO authenticated;
