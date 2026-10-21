-- Profile view insights: one visit per viewer/profile/day, private, anonymous
-- by default, owner notification capped at one per UTC day. Visitors may opt out.
CREATE TABLE IF NOT EXISTS public.profile_visit_events(
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 visit_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
 created_at timestamptz NOT NULL DEFAULT now(),
 share_identity boolean NOT NULL DEFAULT false,
 PRIMARY KEY(profile_id,viewer_id,visit_date),
 CHECK(profile_id<>viewer_id)
);
CREATE INDEX IF NOT EXISTS profile_visits_owner_daily ON public.profile_visit_events(profile_id,visit_date DESC);
CREATE INDEX IF NOT EXISTS profile_visits_cleanup ON public.profile_visit_events(visit_date);
ALTER TABLE public.profile_visit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_visit_events FROM PUBLIC,anon,authenticated;
-- Direct SELECT is intentionally forbidden; owners use the limited summary RPC.
-- Daily notification idempotency is guaranteed even under concurrent visits.
CREATE UNIQUE INDEX IF NOT EXISTS profile_view_one_notification_per_day
 ON public.notifications(user_id, ((data->>'visit_day')))
 WHERE type='profile_view';

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
REVOKE EXECUTE ON FUNCTION public.validate_notification_insert() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_profile_visit(p_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.record_profile_visit(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_profile_visit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_visit_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE v_owner uuid:=auth.uid();v_data jsonb;
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
   'today',count(*) FILTER(WHERE v.visit_date=(now() AT TIME ZONE 'UTC')::date),
   'last_7_days',count(*) FILTER(WHERE v.visit_date>=(now() AT TIME ZONE 'UTC')::date-6),
   'shared_viewers',(
     SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name)
       ORDER BY x.latest DESC),'[]'::jsonb)
     FROM (SELECT pp.id,pp.display_name,max(visit.created_at) latest
      FROM public.profile_visit_events visit
      JOIN public.public_profiles pp ON pp.id=visit.viewer_id
      WHERE visit.profile_id=v_owner AND visit.share_identity
      AND visit.visit_date>=(now() AT TIME ZONE 'UTC')::date-6
      GROUP BY pp.id,pp.display_name ORDER BY latest DESC LIMIT 10) x
   )
 ) INTO v_data
 FROM public.profile_visit_events v WHERE v.profile_id=v_owner
 AND v.visit_date>=(now() AT TIME ZONE 'UTC')::date-6;
 RETURN coalesce(v_data,'{"today":0,"last_7_days":0,"shared_viewers":[]}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_profile_visit_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_profile_visit_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_profile_visit_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE removed integer;
BEGIN
 IF current_user NOT IN ('postgres','service_role') THEN
   RAISE EXCEPTION 'Server maintenance only' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.profile_visit_events
 WHERE visit_date<(now() AT TIME ZONE 'UTC')::date-30;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_profile_visit_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_profile_visit_events() TO service_role;
