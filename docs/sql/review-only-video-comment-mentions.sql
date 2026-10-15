-- REVIEW ONLY — do not apply to the production database without staged verification.
-- Adds bounded @mention notifications to existing video comment trigger.
-- Preserves existing owner/reply notifications; consult post/comment permission policy
-- before applying. Requires public.profiles.username unique index and
-- public.emit_user_notification() present.
-- Rollback: restore the prior pg_get_functiondef(public.notify_video_comment_event)
-- captured in the staging backup and redeploy through a reviewed migration.
CREATE OR REPLACE FUNCTION public.notify_video_comment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  owner_id uuid;
  title_text text;
  parent_owner uuid;
  mention_handle text;
  mentioned_id uuid;
BEGIN
  SELECT v.user_id,v.title INTO owner_id,title_text
  FROM public.videos v WHERE v.id=NEW.video_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    PERFORM public.emit_user_notification(
      owner_id,'video_comment','New comment on your video',
      coalesce(NEW.author_name,'Someone') || ' commented on “' ||
      left(coalesce(title_text,'your video'),100) || '”.',
      '/video.html?id=' || NEW.video_id::text,
      jsonb_build_object('video_id',NEW.video_id,'comment_id',NEW.id,'actor_id',NEW.user_id)
    );
  END IF;

  IF NEW.reply_to IS NOT NULL THEN
    SELECT vc.user_id INTO parent_owner
    FROM public.video_comments vc WHERE vc.id=NEW.reply_to;
    IF parent_owner IS NOT NULL AND parent_owner <> NEW.user_id
       AND parent_owner IS DISTINCT FROM owner_id THEN
      PERFORM public.emit_user_notification(
        parent_owner,'video_comment_reply','Someone replied to your video comment',
        coalesce(NEW.author_name,'Someone') || ' replied to your comment.',
        '/video.html?id=' || NEW.video_id::text,
        jsonb_build_object('video_id',NEW.video_id,'comment_id',NEW.id,'actor_id',NEW.user_id)
      );
    END IF;
  END IF;

  -- Mentions are parsed from the persisted comment, not client-supplied IDs.
  -- 500-character input cap and maximum eight distinct recipients prevent fan-out.
  -- Boundary prevents interpreting domains in user@example.com as mentions.
  FOR mention_handle IN
    SELECT DISTINCT lower((hit.parts)[2])
    FROM regexp_matches(
      left(coalesce(NEW.body,''),500),
      '(^|[^[:alnum:]_@])@([[:alnum:]_]{2,32})\M','g'
    ) AS hit(parts)
    LIMIT 8
  LOOP
    mentioned_id := NULL;
    SELECT p.id INTO mentioned_id
      FROM public.profiles p
      WHERE lower(p.username)=mention_handle
        AND p.account_status='active'
        AND p.notify_mentions IS DISTINCT FROM false
      LIMIT 1;

    IF mentioned_id IS NULL OR mentioned_id=NEW.user_id
       OR mentioned_id IS NOT DISTINCT FROM owner_id
       OR mentioned_id IS NOT DISTINCT FROM parent_owner THEN
      CONTINUE;
    END IF;

    PERFORM public.emit_user_notification(
      mentioned_id,'video_mention','Mentioned in a video comment',
      left(coalesce(NEW.author_name,'Someone'),120) ||
      ' mentioned you in a video comment.',
      '/video.html?id=' || NEW.video_id::text,
      jsonb_build_object('video_id',NEW.video_id,'comment_id',NEW.id,
                         'actor_id',NEW.user_id)
    );
  END LOOP;
  RETURN NEW;
END;
$function$;
