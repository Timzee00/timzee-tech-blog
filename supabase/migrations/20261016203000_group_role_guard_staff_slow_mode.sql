
-- Close membership-role escalation, add validated group owner/mod controls and slow mode.
CREATE OR REPLACE FUNCTION public.enforce_chat_group_membership_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid;
BEGIN
 IF TG_OP='INSERT' THEN
   SELECT ct.created_by INTO v_owner FROM public.chat_threads ct WHERE ct.id=NEW.thread_id AND ct.is_group;
   IF v_owner IS NULL OR v_actor IS DISTINCT FROM v_owner THEN
     RAISE EXCEPTION 'Only group owner can add new group members' USING ERRCODE='42501';
   END IF;
   IF NEW.role NOT IN ('owner','admin','moderator','member') OR
      (NEW.role='owner' AND NEW.user_id<>v_owner) OR
      (NEW.role<>'owner' AND NEW.user_id=v_owner) THEN
     RAISE EXCEPTION 'Invalid membership role' USING ERRCODE='42501';
   END IF;
 ELSIF TG_OP='UPDATE' THEN
   IF NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
     RAISE EXCEPTION 'Membership identity cannot change' USING ERRCODE='42501';
   END IF;
   SELECT ct.created_by INTO v_owner FROM public.chat_threads ct WHERE ct.id=NEW.thread_id;
   IF NEW.role IS DISTINCT FROM OLD.role AND
      (v_actor IS DISTINCT FROM v_owner OR OLD.user_id=v_owner OR NEW.role='owner') THEN
     RAISE EXCEPTION 'Only group owner can assign roles, and ownership cannot be changed here' USING ERRCODE='42501';
   END IF;
   IF OLD.user_id<>v_actor AND v_actor<>v_owner THEN
     RAISE EXCEPTION 'Cannot change another member settings' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_member_write_security ON public.chat_members;
CREATE TRIGGER chat_member_write_security BEFORE INSERT OR UPDATE ON public.chat_members
 FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_group_membership_write();

CREATE OR REPLACE FUNCTION public.manage_chat_group_member(p_group uuid,p_member uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_owner uuid;v_actor_role text;v_target_role text;
BEGIN
 SELECT ct.created_by INTO v_owner FROM public.chat_threads ct WHERE ct.id=p_group AND ct.is_group;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='22023'; END IF;
 SELECT m.role INTO v_actor_role FROM public.chat_members m WHERE m.thread_id=p_group AND m.user_id=v_actor;
 SELECT m.role INTO v_target_role FROM public.chat_members m WHERE m.thread_id=p_group AND m.user_id=p_member;
 IF v_actor IS NULL OR v_actor_role NOT IN ('owner','admin','moderator') THEN
   RAISE EXCEPTION 'Group staff access required' USING ERRCODE='42501'; END IF;
 IF v_target_role IS NULL OR p_member=v_owner THEN
   RAISE EXCEPTION 'Cannot modify the owner or a missing member' USING ERRCODE='42501'; END IF;
 IF p_action IN ('admin','moderator','member') THEN
   IF v_actor<>v_owner THEN RAISE EXCEPTION 'Owner approval required to change roles' USING ERRCODE='42501'; END IF;
   UPDATE public.chat_members cm SET role=p_action WHERE cm.thread_id=p_group AND cm.user_id=p_member;
 ELSIF p_action='remove' THEN
   IF v_actor<>v_owner AND v_target_role IN ('owner','admin') THEN
     RAISE EXCEPTION 'Only owner can remove administrators' USING ERRCODE='42501'; END IF;
   DELETE FROM public.chat_members cm WHERE cm.thread_id=p_group AND cm.user_id=p_member;
 ELSE RAISE EXCEPTION 'Unsupported group member action' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.manage_chat_group_member(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_chat_group_member(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_group_posting_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_group uuid;v_settings jsonb;v_role text;v_seconds int;
BEGIN
 IF NEW.recipient_id IS NOT NULL THEN RETURN NEW; END IF;
 BEGIN v_group:=NEW.thread_id::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
 SELECT ct.settings INTO v_settings FROM public.chat_threads ct WHERE ct.id=v_group AND ct.is_group;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT cm.role INTO v_role FROM public.chat_members cm WHERE cm.thread_id=v_group AND cm.user_id=v_actor;
 IF v_actor IS NULL OR v_actor<>NEW.sender_id OR v_role IS NULL THEN
  RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501'; END IF;
 IF coalesce((v_settings->>'only_admins_post')::boolean,false)
   AND v_role NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Only group admins can post right now' USING ERRCODE='42501'; END IF;
 IF coalesce((v_settings->>'allow_media')::boolean,true)=false
  AND (nullif(NEW.media_url,'') IS NOT NULL OR nullif(NEW.media_path,'') IS NOT NULL) THEN
  RAISE EXCEPTION 'Media is disabled in this group' USING ERRCODE='42501'; END IF;
 v_seconds:=greatest(0,least(3600,coalesce((v_settings->>'slow_mode_seconds')::int,0)));
 IF v_role NOT IN ('owner','admin','moderator') AND v_seconds>0
  AND EXISTS(SELECT 1 FROM public.direct_messages dm WHERE dm.thread_id=NEW.thread_id
    AND dm.sender_id=v_actor AND dm.created_at>now()-make_interval(secs=>v_seconds)) THEN
  RAISE EXCEPTION 'Slow mode active. Wait before posting again.' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chat_group_posting_rules ON public.direct_messages;
CREATE TRIGGER chat_group_posting_rules BEFORE INSERT ON public.direct_messages
 FOR EACH ROW EXECUTE FUNCTION public.enforce_group_posting_rules();
