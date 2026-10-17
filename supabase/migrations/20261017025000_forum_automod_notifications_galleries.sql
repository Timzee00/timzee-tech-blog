-- An owner may attach a gallery while a flagged topic awaits moderator review.
DROP POLICY IF EXISTS community_thread_media_insert ON public.community_thread_media;
CREATE POLICY community_thread_media_insert ON public.community_thread_media FOR INSERT TO authenticated
WITH CHECK(added_by=auth.uid() AND EXISTS(
 SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.author_id=auth.uid()
 AND t.status IN ('published','pending')
));
-- Avoid sending mentions/notifications from content quarantined by automod.
CREATE OR REPLACE FUNCTION public.forum_suppress_flagged_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF new.moderation_status<>'published' THEN
  RETURN NULL;
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS forum_suppress_flagged_notifications ON public.discussion_messages;
-- AFTER INSERT statement trigger? Guard the existing notification trigger instead in its source.

CREATE OR REPLACE FUNCTION public.notify_discussion_message_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  recipient uuid;
  recipient_pref boolean;
  target_username text;
  target_user uuid;
  display_author text := coalesce(new.author_name, 'Someone');
begin
  if new.moderation_status IS DISTINCT FROM 'published' THEN RETURN new; END IF;
  if new.author_id is null then
    return new;
  end if;

  if new.reply_to is not null then
    select dm.author_id
      into recipient
    from public.discussion_messages dm
    where dm.id = new.reply_to
      and dm.author_id is not null;

    if recipient is not null and recipient <> new.author_id then
      select coalesce(p.notify_replies, true)
        into recipient_pref
      from public.profiles p
      where p.id = recipient;

      if coalesce(recipient_pref, true) then
        perform public.emit_user_notification(
          recipient,
          'reply',
          'New discussion reply',
          display_author || ' replied to your discussion message.',
          '/discussion.html?thread=' || coalesce(new.thread_id::text, ''),
          jsonb_build_object(
            'message_id', new.id,
            'reply_to', new.reply_to,
            'topic_id', new.topic_id,
            'thread_id', new.thread_id,
            'actor_id', new.author_id
          )
        );
      end if;
    end if;
  end if;

  if new.body is not null then
    for target_username in
      select distinct lower(m[1])
      from regexp_matches(new.body, '@([a-zA-Z0-9_]+)', 'g') as m
    loop
      select p.id
        into target_user
      from public.profiles p
      where lower(p.username) = target_username
      limit 1;

      if target_user is null or target_user = new.author_id then
        continue;
      end if;

      select coalesce(p.notify_mentions, true)
        into recipient_pref
      from public.profiles p
      where p.id = target_user;

      if coalesce(recipient_pref, true) then
        perform public.emit_user_notification(
          target_user,
          'mention',
          'You were mentioned',
          display_author || ' mentioned you in a discussion.',
          '/discussion.html?thread=' || coalesce(new.thread_id::text, ''),
          jsonb_build_object(
            'message_id', new.id,
            'topic_id', new.topic_id,
            'thread_id', new.thread_id,
            'actor_id', new.author_id
          )
        );
      end if;
    end loop;
  end if;

  return new;
end;
$function$
;