-- Blipmood: conservative production repairs, no RLS weakening or trigger disabling.
-- 1. Avoid alias "old" conflicting with the PL/pgSQL OLD trigger record.
-- 2. Allow post-owner comment alerts only if a persisted comment matches the
--    acting author and the notification recipient is the real post owner.
CREATE OR REPLACE FUNCTION public.community_reply_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE thread public.community_threads%ROWTYPE;board public.discussion_topics%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR new.author_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in to participate' USING ERRCODE='42501';
 END IF;
 IF new.thread_id IS NULL AND new.topic_id IS NOT NULL THEN
  SELECT id INTO new.thread_id FROM public.community_threads
  WHERE community_id=new.topic_id AND is_legacy_room LIMIT 1;
  -- Legacy clients may still post into an old topic ID after reclassification.
  IF new.thread_id IS NULL THEN
   SELECT map.thread_id INTO new.thread_id FROM public.community_legacy_redirects map
   WHERE map.old_topic_id=new.topic_id;
  END IF;
 END IF;
 SELECT * INTO thread FROM public.community_threads WHERE id=new.thread_id;
 IF NOT FOUND OR thread.status<>'published' OR thread.is_locked THEN
  RAISE EXCEPTION 'Thread unavailable or locked' USING ERRCODE='42501';
 END IF;
 IF new.topic_id IS DISTINCT FROM thread.community_id AND NOT EXISTS(
  SELECT 1 FROM public.community_legacy_redirects map
  WHERE map.old_topic_id=new.topic_id AND map.thread_id=new.thread_id
 ) THEN
  RAISE EXCEPTION 'Reply belongs to another community' USING ERRCODE='42501';
 END IF;
 SELECT * INTO board FROM public.discussion_topics WHERE id=thread.community_id;
 IF board.community_state<>'active' THEN
  RAISE EXCEPTION 'Community is read-only' USING ERRCODE='42501';
 END IF;
 IF board.posting_policy='members' AND NOT EXISTS(SELECT 1 FROM public.community_members cm
 WHERE cm.community_id=thread.community_id AND cm.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Join the community to post' USING ERRCODE='42501';
 END IF;
 IF board.posting_policy='staff' AND NOT EXISTS(SELECT 1 FROM public.community_members cm
 WHERE cm.community_id=thread.community_id AND cm.user_id=auth.uid() AND cm.role IN ('owner','moderator')) THEN
  RAISE EXCEPTION 'Staff-only discussion' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=thread.community_id
 AND b.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Banned from this community' USING ERRCODE='42501';
 END IF;
 IF new.reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.discussion_messages parent_reply
 WHERE parent_reply.id=new.reply_to AND parent_reply.thread_id=new.thread_id) THEN
  RAISE EXCEPTION 'Reply reference is from another thread' USING ERRCODE='22023';
 END IF;
 IF length(btrim(coalesce(new.body,'')))<1 AND new.media_url IS NULL THEN
  RAISE EXCEPTION 'Write a reply' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(new.body,''))>10000 THEN
  RAISE EXCEPTION 'Reply is too long' USING ERRCODE='22023';
 END IF;
 new.created_at:=now();
 RETURN new;
END $function$
;
CREATE OR REPLACE FUNCTION public.validate_notification_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  caller uuid := auth.uid();
  payload jsonb := coalesce(new.data, '{}'::jsonb);
  privileged boolean := false;
  v_post_id uuid;
  v_comment_id uuid;
  v_video_id uuid;
  v_sender_id uuid;
  v_topic_id uuid;
  v_discussion_message_id uuid;
  v_parent_message_id uuid;
begin
  -- Backend/service-role writers have no end-user auth.uid() and are trusted here.
  if caller is null then
    return new;
  end if;

  privileged := exists (
    select 1 from public.profiles p
    where p.id = caller
      and lower(coalesce(p.role, '')) in ('moderator', 'admin', 'super')
  ) or exists (
    select 1 from public.user_roles ur
    where ur.user_id = caller
      and lower(coalesce(ur.role, '')) in ('moderator', 'admin', 'super')
  );

  if new.user_id is null then
    raise exception 'Notification recipient is required';
  end if;

  -- If the app has no event metadata for a new notification type, only allow
  -- a user to create a notification for themselves. This is safe by default.
  if lower(coalesce(new.type, '')) = 'friend_request' then
    if not exists (
      select 1 from public.friendships f
      where f.requester_id = caller
        and f.addressee_id = new.user_id
        and f.status = 'pending'
    ) then
      raise exception 'Notification is not backed by a pending friend request';
    end if;

  elsif lower(coalesce(new.type, '')) = 'friend_request_accepted' then
    if not exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = caller and f.addressee_id = new.user_id)
          or (f.addressee_id = caller and f.requester_id = new.user_id))
    ) then
      raise exception 'Notification is not backed by an accepted friendship';
    end if;

  elsif lower(coalesce(new.type, '')) = 'mention' then
    v_topic_id := nullif(payload->>'topic_id','')::uuid;
    v_discussion_message_id := nullif(payload->>'message_id','')::uuid;
    if v_topic_id is not null and v_discussion_message_id is not null then
      if not exists (
        select 1 from public.discussion_messages dm
        join public.profiles p on p.id=new.user_id
        where dm.id=v_discussion_message_id
          and dm.topic_id=v_topic_id
          and dm.author_id=caller
          and p.username ~ '^[A-Za-z0-9_]+$'
          and regexp_like(coalesce(dm.body,''), '(^|[^[:alnum:]_])@' || p.username || '([^[:alnum:]_]|$)', 'i')
      ) then
        raise exception 'Discussion mention is not backed by a matching message';
      end if;
    else
      v_post_id := nullif(payload->>'post_id', '')::uuid;
      v_comment_id := nullif(payload->>'comment_id', '')::uuid;
      if v_post_id is null or v_comment_id is null or not exists (
        select 1 from public.comments c
        where c.id=v_comment_id
          and c.post_id=v_post_id
          and c.author_id=caller
          and new.user_id=any(coalesce(c.mentions,'{}'::uuid[]))
      ) then
        raise exception 'Mention notification is not backed by the referenced comment';
      end if;
    end if;

  elsif lower(coalesce(new.type, '')) = 'reply' then
    v_topic_id := nullif(payload->>'topic_id','')::uuid;
    v_discussion_message_id := nullif(payload->>'message_id','')::uuid;
    v_parent_message_id := nullif(payload->>'reply_to','')::uuid;
    if v_topic_id is null or v_discussion_message_id is null or v_parent_message_id is null
       or not exists (
         select 1
           from public.discussion_messages dm
           join public.discussion_messages parent on parent.id=dm.reply_to
          where dm.id=v_discussion_message_id
            and dm.topic_id=v_topic_id
            and dm.reply_to=v_parent_message_id
            and dm.author_id=caller
            and parent.author_id=new.user_id
            and parent.topic_id=dm.topic_id
       ) then
       raise exception 'Discussion reply notification is not backed by the referenced conversation';
    end if;

  -- A comment can notify the actual owner of the referenced post only.
  -- The AFTER INSERT comment trigger supplies both IDs and the actor.
  elsif lower(coalesce(new.type, '')) = 'comment' then
    v_post_id := nullif(payload->>'post_id', '')::uuid;
    v_comment_id := nullif(payload->>'comment_id', '')::uuid;
    if v_post_id is null or v_comment_id is null or not exists (
      select 1 from public.comments c
      join public.posts p on p.id = c.post_id
      where c.id = v_comment_id
        and c.post_id = v_post_id
        and c.author_id = caller
        and p.author_id = new.user_id
        and p.author_id <> caller
    ) then
      raise exception 'Comment notification is not backed by an authored comment on recipient post';
    end if;

  elsif lower(coalesce(new.type, '')) = 'comment_reply' then
    v_post_id := nullif(payload->>'post_id', '')::uuid;
    v_comment_id := nullif(payload->>'comment_id', '')::uuid;
    if v_post_id is null or v_comment_id is null or not exists (
      select 1
      from public.comments c
      join public.posts p on p.id = c.post_id
      where c.id = v_comment_id
        and c.post_id = v_post_id
        and c.author_id = caller
        and p.author_id = new.user_id
    ) then
      raise exception 'Comment-reply notification is not backed by the referenced comment';
    end if;

  elsif lower(coalesce(new.type, '')) = 'direct_message' then
    v_sender_id := nullif(payload->>'sender_id', '')::uuid;
    if v_sender_id is null or v_sender_id <> caller or not exists (
      select 1 from public.direct_messages dm
      where dm.sender_id = caller
        and dm.recipient_id = new.user_id
    ) then
      raise exception 'Direct-message notification is not backed by a sent message';
    end if;

  elsif lower(coalesce(new.type, '')) in
      ('group_mention','status_mention','video_mention','status_comment_mention') then
    if not public.valid_social_mention(lower(new.type),payload,new.user_id,caller) then
      raise exception 'Social mention is not backed by visible authored content';
    end if;

  elsif lower(coalesce(new.type, '')) = 'post_like' then
    v_post_id := nullif(payload->>'post_id', '')::uuid;
    if v_post_id is null or not exists (
      select 1 from public.post_likes pl
      where pl.post_id = v_post_id
        and pl.user_id = caller
    ) or not exists (
      select 1 from public.posts p
      where p.id = v_post_id
        and p.author_id = new.user_id
    ) then
      raise exception 'Post-like notification is not backed by the referenced like';
    end if;

  elsif lower(coalesce(new.type, '')) = 'video_like' then
    v_video_id := nullif(payload->>'video_id', '')::uuid;
    if v_video_id is null or not exists (
      select 1 from public.video_likes vl
      where vl.video_id = v_video_id
        and vl.user_id = caller
    ) or not exists (
      select 1 from public.videos v
      where v.id = v_video_id
        and v.user_id = new.user_id
    ) then
      raise exception 'Video-like notification is not backed by the referenced like';
    end if;

  elsif lower(coalesce(new.type, '')) = 'video_comment' then
    v_video_id := nullif(payload->>'video_id', '')::uuid;
    if v_video_id is null or not exists (
      select 1 from public.video_comments vc
      where vc.video_id = v_video_id
        and vc.user_id = caller
    ) or not exists (
      select 1 from public.videos v
      where v.id = v_video_id
        and v.user_id = new.user_id
    ) then
      raise exception 'Video-comment notification is not backed by the referenced comment';
    end if;

  elsif lower(coalesce(new.type, '')) in ('admin_promotion', 'verification_status', 'announcement') then
    if not privileged then
      raise exception 'Only privileged users can create this notification type';
    end if;

  elsif lower(coalesce(new.type, '')) = 'profile_view' then
    -- The trigger can only accept a profile-view alert backed by the visitor's
    -- actual daily server-side visit record. No username/identity is injected
    -- from client-supplied notification text.
    if new.user_id = caller OR (new.data->>'visit_day') is null
      OR NOT EXISTS(
        SELECT 1 FROM public.profile_visit_events v
        WHERE v.viewer_id=caller AND v.profile_id=new.user_id
          AND v.visit_date::text=(new.data->>'visit_day')
      ) then
      raise exception 'Profile view alert requires a confirmed visit'
        using errcode='42501';
    end if;
    new.title := 'New profile activity';
    new.body := 'Someone viewed your profile today. Open your profile for weekly insights.';
    new.link_url := '/profile.html';
    new.link := '/profile.html';
    new.data := jsonb_build_object('visit_day',new.data->>'visit_day',
      'profile_id',new.user_id::text);
    elsif new.user_id <> caller then
    raise exception 'Unsupported notification type cannot target another user';
  end if;

  return new;
exception
  when invalid_text_representation then
    raise exception 'Invalid notification event metadata';
end;
$function$
;
