-- Event-driven notifications + scheduled maintenance.
-- Keep the browser as a presentation layer; important side effects belong here.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

DROP POLICY IF EXISTS "Announcements are public" ON public.announcements;
CREATE POLICY "Announcements are public when published"
  ON public.announcements
  FOR SELECT
  TO public
  USING (
    coalesce(status, 'published') = 'published'
    AND (publish_at IS NULL OR publish_at <= now())
  );

CREATE OR REPLACE FUNCTION public.normalize_announcement_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) <> 'archived' THEN
    IF NEW.publish_at IS NOT NULL AND NEW.publish_at > now() THEN
      NEW.status := 'scheduled';
    ELSE
      NEW.status := 'published';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcements_lifecycle_normalize ON public.announcements;
CREATE TRIGGER announcements_lifecycle_normalize
BEFORE INSERT OR UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.normalize_announcement_lifecycle();

UPDATE public.announcements
SET notified_at = coalesce(publish_at, created_at, now())
WHERE notified_at IS NULL
  AND coalesce(status, 'published') = 'published'
  AND (publish_at IS NULL OR publish_at <= now());

CREATE OR REPLACE FUNCTION public.emit_user_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.type = p_type
      AND n.created_at >= (now() AT TIME ZONE 'UTC') - interval '15 seconds'
      AND coalesce(n.data, '{}'::jsonb) = coalesce(p_data, '{}'::jsonb)
      AND coalesce(n.link, '') = coalesce(p_link, '')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    id, user_id, type, title, body, link, data, created_at, read_at
  ) VALUES (
    gen_random_uuid(),
    p_user_id,
    p_type,
    left(coalesce(p_title, 'Notification'), 180),
    left(coalesce(p_body, ''), 1000),
    p_link,
    coalesce(p_data, '{}'::jsonb),
    now() AT TIME ZONE 'UTC',
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_follow_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  recipient uuid;
  target_name text;
  pref boolean := true;
BEGIN
  IF NEW.follower_id IS NULL OR NEW.target_id IS NULL THEN RETURN NEW; END IF;

  IF lower(coalesce(NEW.target_type, '')) = 'author' THEN
    SELECT a.user_id, coalesce(a.full_name, a.username, 'your profile')
      INTO recipient, target_name
    FROM public.authors a
    WHERE a.id::text = NEW.target_id
    LIMIT 1;
  ELSIF lower(coalesce(NEW.target_type, '')) IN ('profile', 'user') THEN
    BEGIN
      recipient := NEW.target_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      recipient := NULL;
    END;
    SELECT coalesce(p.display_name, p.username, 'your profile')
      INTO target_name
    FROM public.profiles p
    WHERE p.id = recipient;
  ELSIF lower(coalesce(NEW.target_type, '')) = 'topic' THEN
    SELECT t.author_id, coalesce(t.title, 'your discussion')
      INTO recipient, target_name
    FROM public.discussion_topics t
    WHERE t.id::text = NEW.target_id
    LIMIT 1;
  END IF;

  IF recipient IS NULL OR recipient = NEW.follower_id THEN RETURN NEW; END IF;

  SELECT coalesce(p.notify_follows, true)
    INTO pref
  FROM public.profiles p
  WHERE p.id = recipient;

  IF coalesce(pref, true) THEN
    PERFORM public.emit_user_notification(
      recipient,
      CASE WHEN lower(coalesce(NEW.target_type, '')) = 'topic' THEN 'topic_follow' ELSE 'follow' END,
      CASE WHEN lower(coalesce(NEW.target_type, '')) = 'topic' THEN 'New follower on your topic' ELSE 'New follower' END,
      'Someone followed ' || coalesce(target_name, 'you') || '.',
      CASE
        WHEN lower(coalesce(NEW.target_type, '')) = 'topic' THEN '/discussion.html?topic=' || NEW.target_id
        ELSE '/profile.html?id=' || NEW.follower_id::text
      END,
      jsonb_build_object('follower_id', NEW.follower_id, 'target_type', NEW.target_type, 'target_id', NEW.target_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_notification_after_insert ON public.follows;
CREATE TRIGGER follows_notification_after_insert
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_follow_event();

CREATE OR REPLACE FUNCTION public.notify_friendship_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  accepter_name text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'accepted'
     AND coalesce(OLD.status, '') <> 'accepted'
     AND NEW.requester_id IS NOT NULL
     AND NEW.addressee_id IS NOT NULL
  THEN
    SELECT coalesce(p.display_name, p.username, 'Your friend')
      INTO accepter_name
    FROM public.profiles p
    WHERE p.id = NEW.addressee_id;

    PERFORM public.emit_user_notification(
      NEW.requester_id,
      'friend_request_accepted',
      'Friend request accepted',
      coalesce(accepter_name, 'Your friend') || ' accepted your friend request.',
      '/chat.html',
      jsonb_build_object('friendship_id', NEW.id, 'accepter_id', NEW.addressee_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notification_after_update ON public.friendships;
CREATE TRIGGER friendships_notification_after_update
AFTER UPDATE OF status ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friendship_event();

CREATE OR REPLACE FUNCTION public.notify_comment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  post_owner uuid;
  post_title text;
  parent_owner uuid;
  mentioned_user uuid;
  author_label text := coalesce(NEW.author_name, 'Someone');
  recipient_pref boolean := true;
BEGIN
  IF NEW.author_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS NOT NULL AND lower(NEW.status) NOT IN ('approved', 'published') THEN RETURN NEW; END IF;

  SELECT p.author_id, p.title
    INTO post_owner, post_title
  FROM public.posts p
  WHERE p.id = NEW.post_id;

  IF post_owner IS NOT NULL AND post_owner <> NEW.author_id THEN
    PERFORM public.emit_user_notification(
      post_owner,
      'comment',
      'New comment on your post',
      author_label || ' commented on “' || left(coalesce(post_title, 'your post'), 100) || '”.',
      '/post.html?id=' || NEW.post_id::text || '#comment-' || NEW.id::text,
      jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id, 'actor_id', NEW.author_id)
    );
  END IF;

  IF NEW.reply_to IS NOT NULL THEN
    SELECT c.author_id INTO parent_owner
    FROM public.comments c
    WHERE c.id = NEW.reply_to;

    IF parent_owner IS NOT NULL
       AND parent_owner <> NEW.author_id
       AND parent_owner IS DISTINCT FROM post_owner
    THEN
      PERFORM public.emit_user_notification(
        parent_owner,
        'comment_reply',
        'Someone replied to your comment',
        author_label || ' replied to your comment.',
        '/post.html?id=' || NEW.post_id::text || '#comment-' || NEW.id::text,
        jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id, 'actor_id', NEW.author_id)
      );
    END IF;
  END IF;

  IF NEW.mentions IS NOT NULL THEN
    FOREACH mentioned_user IN ARRAY NEW.mentions LOOP
      IF mentioned_user IS NULL OR mentioned_user = NEW.author_id THEN CONTINUE; END IF;
      SELECT coalesce(p.notify_mentions, true) INTO recipient_pref
      FROM public.profiles p WHERE p.id = mentioned_user;
      IF coalesce(recipient_pref, true) THEN
        PERFORM public.emit_user_notification(
          mentioned_user,
          'mention',
          'You were mentioned',
          author_label || ' mentioned you in a comment.',
          '/post.html?id=' || NEW.post_id::text || '#comment-' || NEW.id::text,
          jsonb_build_object('post_id', NEW.post_id, 'comment_id', NEW.id, 'actor_id', NEW.author_id)
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_notifications_after_insert ON public.comments;
CREATE TRIGGER comments_notifications_after_insert
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.notify_comment_event();

DROP TRIGGER IF EXISTS comments_notifications_after_approval ON public.comments;
CREATE TRIGGER comments_notifications_after_approval
AFTER UPDATE OF status ON public.comments
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status AND lower(coalesce(NEW.status, '')) IN ('approved', 'published'))
EXECUTE FUNCTION public.notify_comment_event();

CREATE OR REPLACE FUNCTION public.notify_post_like_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  owner_id uuid;
  title_text text;
BEGIN
  SELECT p.author_id, p.title INTO owner_id, title_text
  FROM public.posts p WHERE p.id = NEW.post_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    PERFORM public.emit_user_notification(
      owner_id,
      'post_like',
      'New like on your post',
      'Someone liked “' || left(coalesce(title_text, 'your post'), 100) || '”.',
      '/post.html?id=' || NEW.post_id::text,
      jsonb_build_object('post_id', NEW.post_id, 'actor_id', NEW.user_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS post_likes_notification_after_insert ON public.post_likes;
CREATE TRIGGER post_likes_notification_after_insert
AFTER INSERT ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION public.notify_post_like_event();

CREATE OR REPLACE FUNCTION public.notify_video_like_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE owner_id uuid; title_text text;
BEGIN
  SELECT v.user_id, v.title INTO owner_id, title_text FROM public.videos v WHERE v.id = NEW.video_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    PERFORM public.emit_user_notification(
      owner_id, 'video_like', 'New like on your video',
      'Someone liked “' || left(coalesce(title_text, 'your video'), 100) || '”.',
      '/video.html?id=' || NEW.video_id::text,
      jsonb_build_object('video_id', NEW.video_id, 'actor_id', NEW.user_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS video_likes_notification_after_insert ON public.video_likes;
CREATE TRIGGER video_likes_notification_after_insert
AFTER INSERT ON public.video_likes
FOR EACH ROW EXECUTE FUNCTION public.notify_video_like_event();

CREATE OR REPLACE FUNCTION public.notify_video_comment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  owner_id uuid;
  title_text text;
  parent_owner uuid;
BEGIN
  SELECT v.user_id, v.title INTO owner_id, title_text FROM public.videos v WHERE v.id = NEW.video_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    PERFORM public.emit_user_notification(
      owner_id, 'video_comment', 'New comment on your video',
      coalesce(NEW.author_name, 'Someone') || ' commented on “' || left(coalesce(title_text, 'your video'), 100) || '”.',
      '/video.html?id=' || NEW.video_id::text,
      jsonb_build_object('video_id', NEW.video_id, 'comment_id', NEW.id, 'actor_id', NEW.user_id)
    );
  END IF;

  IF NEW.reply_to IS NOT NULL THEN
    SELECT vc.user_id INTO parent_owner FROM public.video_comments vc WHERE vc.id = NEW.reply_to;
    IF parent_owner IS NOT NULL AND parent_owner <> NEW.user_id AND parent_owner IS DISTINCT FROM owner_id THEN
      PERFORM public.emit_user_notification(
        parent_owner, 'video_comment_reply', 'Someone replied to your video comment',
        coalesce(NEW.author_name, 'Someone') || ' replied to your comment.',
        '/video.html?id=' || NEW.video_id::text,
        jsonb_build_object('video_id', NEW.video_id, 'comment_id', NEW.id, 'actor_id', NEW.user_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS video_comments_notification_after_insert ON public.video_comments;
CREATE TRIGGER video_comments_notification_after_insert
AFTER INSERT ON public.video_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_video_comment_event();

CREATE OR REPLACE FUNCTION public.notify_direct_message_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  recipient_pref boolean := true;
  sender_name text;
  thread_name text;
  ntype text := 'direct_message';
  ntitle text := 'New message';
  nbody text;
BEGIN
  IF NEW.recipient_id IS NULL OR NEW.sender_id IS NULL OR NEW.sender_id = NEW.recipient_id THEN RETURN NEW; END IF;

  SELECT coalesce(p.display_name, p.username, 'Someone') INTO sender_name
  FROM public.profiles p WHERE p.id = NEW.sender_id;
  SELECT ct.name INTO thread_name FROM public.chat_threads ct WHERE ct.id::text = NEW.thread_id LIMIT 1;

  SELECT coalesce(p.notify_messages, true) INTO recipient_pref
  FROM public.profiles p WHERE p.id = NEW.recipient_id;
  IF NOT coalesce(recipient_pref, true) THEN RETURN NEW; END IF;

  IF thread_name LIKE 'Marketplace:%' THEN
    ntype := 'marketplace_inquiry';
    ntitle := 'New marketplace inquiry';
    nbody := 'You received a marketplace inquiry.';
  ELSE
    nbody := coalesce(sender_name, 'Someone') || ' sent you a message.';
  END IF;

  PERFORM public.emit_user_notification(
    NEW.recipient_id,
    ntype,
    ntitle,
    nbody,
    '/chat.html?thread=' || coalesce(NEW.thread_id, ''),
    jsonb_build_object('message_id', NEW.id, 'sender_id', NEW.sender_id, 'thread_id', NEW.thread_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS direct_messages_notification_after_insert ON public.direct_messages;
CREATE TRIGGER direct_messages_notification_after_insert
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_direct_message_event();

CREATE OR REPLACE FUNCTION public.handle_marketplace_inquiry_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  seller uuid;
  listing_title text;
  thread uuid;
BEGIN
  SELECT mi.user_id, mi.title INTO seller, listing_title
  FROM public.marketplace_items mi WHERE mi.id = new.item_id;

  seller := coalesce(new.seller_id, seller);
  new.seller_id := seller;

  IF seller IS NOT NULL AND seller <> new.buyer_id THEN
    thread := gen_random_uuid();

    INSERT INTO public.chat_threads (id, name, is_group, created_by, created_at)
    VALUES (thread, 'Marketplace: ' || left(coalesce(listing_title, 'Listing'), 80), false, new.buyer_id, now());

    INSERT INTO public.chat_members (id, thread_id, user_id, role, joined_at)
    VALUES
      (gen_random_uuid(), thread, new.buyer_id, 'member', now()),
      (gen_random_uuid(), thread, seller, 'member', now());

    INSERT INTO public.direct_messages (id, thread_id, sender_id, recipient_id, body, created_at)
    VALUES (
      gen_random_uuid(),
      thread::text,
      new.buyer_id,
      seller,
      'Marketplace inquiry about ' || coalesce(listing_title, 'your listing') || E'\n\n' || coalesce(new.message, ''),
      now()
    );

    new.thread_id := thread;
  END IF;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_verification_application_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  admin_id uuid;
  status_text text;
  label text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR admin_id IN
      SELECT DISTINCT p.id
      FROM public.profiles p
      WHERE lower(coalesce(p.role, '')) IN ('admin', 'super')
      UNION
      SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
      WHERE lower(coalesce(ur.role, '')) IN ('admin', 'super')
    LOOP
      PERFORM public.emit_user_notification(
        admin_id,
        'verification_application',
        'New verification application',
        coalesce(NEW.user_name, NEW.user_email, 'A member') || ' submitted a verification application.',
        '/admin/',
        jsonb_build_object('application_id', NEW.id, 'user_id', NEW.user_id)
      );
    END LOOP;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.user_id IS NOT NULL THEN
    status_text := lower(coalesce(NEW.status, 'updated'));
    label := replace(initcap(status_text), '_', ' ');
    PERFORM public.emit_user_notification(
      NEW.user_id,
      'verification_status',
      'Verification ' || label,
      'Your verification application status is now ' || label || '.',
      '/profile.html',
      jsonb_build_object('application_id', NEW.id, 'status', status_text)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS verification_application_notification_insert ON public.verification_applications;
CREATE TRIGGER verification_application_notification_insert
AFTER INSERT ON public.verification_applications
FOR EACH ROW EXECUTE FUNCTION public.notify_verification_application_event();
DROP TRIGGER IF EXISTS verification_application_notification_update ON public.verification_applications;
CREATE TRIGGER verification_application_notification_update
AFTER UPDATE OF status ON public.verification_applications
FOR EACH ROW EXECUTE FUNCTION public.notify_verification_application_event();

CREATE OR REPLACE FUNCTION public.process_automation_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  published_count integer := 0;
  notification_count integer := 0;
  stories_deleted integer := 0;
  notifications_deleted integer := 0;
BEGIN
  WITH due AS (
    SELECT a.*
    FROM public.announcements a
    WHERE a.notified_at IS NULL
      AND coalesce(a.status, 'published') = 'published'
      AND (a.publish_at IS NULL OR a.publish_at <= now())
    FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.announcements a
    SET notified_at = now(), updated_at = now(), status = 'published'
    FROM due d
    WHERE a.id = d.id
    RETURNING a.*
  )
  INSERT INTO public.notifications (id, user_id, type, title, body, link, data, created_at, read_at)
  SELECT
    gen_random_uuid(),
    p.id,
    'announcement',
    left(m.title, 180),
    left(coalesce(m.body, m.message, ''), 1000),
    '/announcements.html',
    jsonb_build_object('announcement_id', m.id),
    now() AT TIME ZONE 'UTC',
    NULL
  FROM marked m
  CROSS JOIN public.profiles p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notifications prior
    WHERE prior.user_id = p.id
      AND prior.type = 'announcement'
      AND prior.title = m.title
      AND prior.body = coalesce(m.body, m.message, '')
      AND prior.link = '/announcements.html'
      AND prior.created_at >= m.created_at
  );
  GET DIAGNOSTICS notification_count = ROW_COUNT;

  SELECT count(*) INTO published_count
  FROM public.announcements
  WHERE notified_at >= (now() - interval '1 second');

  DELETE FROM public.stories WHERE expires_at < now();
  GET DIAGNOSTICS stories_deleted = ROW_COUNT;

  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND read_at < (now() AT TIME ZONE 'UTC') - interval '180 days';
  GET DIAGNOSTICS notifications_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'published_or_processed_announcements', published_count,
    'announcement_notifications_created', notification_count,
    'expired_stories_deleted', stories_deleted,
    'old_read_notifications_deleted', notifications_deleted,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_automation_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_automation_tick() TO service_role;
REVOKE ALL ON FUNCTION public.emit_user_notification(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_user_notification(uuid, text, text, text, text, jsonb) TO service_role;

CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON public.notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS announcements_publish_state_idx
  ON public.announcements (status, publish_at, notified_at);
