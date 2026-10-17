
-- Re-home original one-topic chat rooms into lasting category boards.
-- Keep original records for referential integrity and legacy /discussion.html?topic=id links.
CREATE TABLE IF NOT EXISTS public.community_legacy_redirects(
 old_topic_id uuid PRIMARY KEY REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 thread_id uuid NOT NULL UNIQUE REFERENCES public.community_threads(id) ON DELETE CASCADE,
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id),
 moved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_legacy_redirects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.community_legacy_redirects TO anon,authenticated;
DROP POLICY IF EXISTS community_legacy_redirects_read ON public.community_legacy_redirects;
CREATE POLICY community_legacy_redirects_read ON public.community_legacy_redirects
FOR SELECT TO anon,authenticated USING(true);

INSERT INTO public.discussion_topics(id,title,description,category,author_id,author_name,
 created_at,updated_at,posting_policy,icon_emoji)
VALUES
(gen_random_uuid(),'AI & Machine Learning','AI models, practical tools, automation, research, and applied machine learning.','AI & ML',NULL,'Timzee Communities',now(),now(),'everyone','🤖'),
(gen_random_uuid(),'Programming & Web Development','Discuss JavaScript, Python, Git, architecture, databases, and software development.','Programming',NULL,'Timzee Communities',now(),now(),'everyone','💻'),
(gen_random_uuid(),'Tech News & Discussions','Meaningful technology updates, launches, industry changes and informed discussion.','Technology',NULL,'Timzee Communities',now(),now(),'everyone','📰'),
(gen_random_uuid(),'Phones & Gadgets','Phones, laptops, devices, accessories, repairs and buying advice.','Gadgets',NULL,'Timzee Communities',now(),now(),'everyone','📱'),
(gen_random_uuid(),'Cybersecurity & Privacy','Safe computing, digital privacy, online security and defensive research.','Cybersecurity',NULL,'Timzee Communities',now(),now(),'everyone','🛡️'),
(gen_random_uuid(),'Tech Jobs & Opportunities','Jobs, internships, scholarships, grants and training opportunities.','Tech Jobs',NULL,'Timzee Communities',now(),now(),'everyone','💼'),
(gen_random_uuid(),'Gaming & Gaming Tech','Games, gaming hardware, reviews, development and esports.','Gaming',NULL,'Timzee Communities',now(),now(),'everyone','🎮'),
(gen_random_uuid(),'Startups & Digital Business','Product ideas, entrepreneurship, business growth and building companies.','Startups',NULL,'Timzee Communities',now(),now(),'everyone','🚀'),
(gen_random_uuid(),'Project Showcase & Feedback','Share useful projects, ask for constructive reviews, and find collaborators.','Project Showcase',NULL,'Timzee Communities',now(),now(),'everyone','🛠️'),
(gen_random_uuid(),'Learn & Build Together','Tutorial help, project challenges, courses and study partnerships.','Learning',NULL,'Timzee Communities',now(),now(),'everyone','📚'),
(gen_random_uuid(),'Sports','Football, major sporting events, athlete discussions and fan opinions.','Sports',NULL,'Timzee Communities',now(),now(),'everyone','⚽'),
(gen_random_uuid(),'Entertainment & Creators','Movies, anime, internet creators, livestreams and popular culture.','Entertainment',NULL,'Timzee Communities',now(),now(),'everyone','🎬'),
(gen_random_uuid(),'World News & Affairs','International affairs and news analysis with careful sourcing and respectful debate.','World Affairs',NULL,'Timzee Communities',now(),now(),'everyone','🌍'),
(gen_random_uuid(),'General Lounge','Interesting conversations that do not belong in a more specific community.','General',NULL,'Timzee Communities',now(),now(),'everyone','💬');

WITH categories AS(
SELECT old.id,
CASE
 WHEN lower(old.title) ~ '(ronaldo|messi|fifa|arsenal|football)' THEN 'Sports'
 WHEN lower(old.title) ~ '(peller|ishowspeed|solo.leveling|anime)' THEN 'Entertainment & Creators'
 WHEN lower(old.title) ~ '(russia|ukraine|war|nato|foreign affairs)' THEN 'World News & Affairs'
 WHEN lower(old.title) ~ '(website|swisskit|personal site|project)' THEN 'Project Showcase & Feedback'
 ELSE 'General Lounge'
END AS destination
FROM public.discussion_topics old
WHERE old.author_name IS DISTINCT FROM 'Timzee Communities'
)
INSERT INTO public.community_legacy_redirects(old_topic_id,thread_id,community_id)
SELECT categories.id,archive.id,board.id
FROM categories
JOIN public.community_threads archive ON archive.community_id=categories.id AND archive.is_legacy_room
JOIN public.discussion_topics board ON board.title=categories.destination AND board.author_name='Timzee Communities'
ON CONFLICT DO NOTHING;

-- Reassign archived top-level thread to the relevant evergreen community.
UPDATE public.community_threads archive SET
 community_id=map.community_id,
 title=left(coalesce(old.title,'Community discussion'),180),
 body=left(coalesce(old.description,''),12000),
 is_legacy_room=false,
 is_pinned=false,
 last_activity_at=greatest(archive.last_activity_at,coalesce(old.updated_at,archive.created_at))
FROM public.community_legacy_redirects map
JOIN public.discussion_topics old ON old.id=map.old_topic_id
WHERE archive.id=map.thread_id;

-- People who followed or created the original topic become members of its new board.
INSERT INTO public.community_members(community_id,user_id,role)
SELECT DISTINCT map.community_id,m.user_id,'member'
FROM public.community_legacy_redirects map
JOIN public.community_members m ON m.community_id=map.old_topic_id
JOIN auth.users a ON a.id=m.user_id
ON CONFLICT(community_id,user_id) DO NOTHING;

-- Original topic rows remain as immutable history, not as misleading new communities.
UPDATE public.discussion_topics old SET community_state='archived'
WHERE EXISTS(SELECT 1 FROM public.community_legacy_redirects map WHERE map.old_topic_id=old.id);

-- Admins must be able to appoint moderators to system-created community boards.
CREATE OR REPLACE FUNCTION public.community_set_member_role(p_community uuid,p_member uuid,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_admin boolean:=coalesce(public.has_role_secure('super'),false)
 OR coalesce(public.has_role_secure('admin'),false);
BEGIN
 IF p_role NOT IN ('member','moderator') THEN RAISE EXCEPTION 'Invalid member role' USING ERRCODE='22023'; END IF;
 IF NOT v_admin AND NOT EXISTS(
  SELECT 1 FROM public.discussion_topics t WHERE t.id=p_community AND t.author_id=auth.uid()) THEN
  RAISE EXCEPTION 'Community owner or site administrator required' USING ERRCODE='42501';
 END IF;
 UPDATE public.community_members SET role=p_role
 WHERE community_id=p_community AND user_id=p_member AND role<>'owner';
 IF NOT FOUND THEN RAISE EXCEPTION 'Member not found; ask them to join first' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_set_member_role(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_set_member_role(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_manage_thread(p_thread uuid,p_action text)
RETURNS public.community_threads LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();board uuid;res public.community_threads%ROWTYPE;
 v_admin boolean:=coalesce(public.has_role_secure('super'),false)
 OR coalesce(public.has_role_secure('admin'),false);
BEGIN
 SELECT community_id INTO board FROM public.community_threads WHERE id=p_thread;
 IF board IS NULL THEN RAISE EXCEPTION 'Thread unavailable' USING ERRCODE='22023'; END IF;
 IF NOT v_admin AND NOT EXISTS(SELECT 1 FROM public.community_members m
 WHERE m.community_id=board AND m.user_id=v_actor AND m.role IN ('owner','moderator')) THEN
  RAISE EXCEPTION 'Moderator required' USING ERRCODE='42501';
 END IF;
 IF p_action NOT IN ('pin','unpin','lock','unlock','remove','restore') THEN
  RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
 END IF;
 UPDATE public.community_threads SET
 is_pinned=CASE WHEN p_action='pin' THEN true WHEN p_action='unpin' THEN false ELSE is_pinned END,
 is_locked=CASE WHEN p_action='lock' THEN true WHEN p_action='unlock' THEN false ELSE is_locked END,
 status=CASE WHEN p_action='remove' THEN 'removed' WHEN p_action='restore' THEN 'published' ELSE status END,
 updated_at=now() WHERE id=p_thread RETURNING * INTO res;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.community_manage_thread(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_manage_thread(uuid,text) TO authenticated;
