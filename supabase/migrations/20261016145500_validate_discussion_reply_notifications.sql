-- Validate discussion reply notifications against actual parent-child messages.
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
