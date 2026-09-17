CREATE OR REPLACE FUNCTION public.notify_friendship_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_name text;
  recipient_id uuid;
  target_id uuid;
  notification_link text;
BEGIN
  IF TG_OP = 'INSERT' AND lower(coalesce(NEW.status,'')) = 'pending' THEN
    recipient_id := NEW.addressee_id;
    target_id := NEW.requester_id;
    SELECT coalesce(p.display_name,p.username,'Someone') INTO actor_name
    FROM public.profiles p WHERE p.id=NEW.requester_id;

    IF recipient_id IS NOT NULL AND target_id IS NOT NULL AND recipient_id <> target_id THEN
      notification_link := '/profile.html?id=' || target_id::text;
      PERFORM public.emit_user_notification(
        recipient_id,
        'friend_request',
        'New Friend Request',
        coalesce(actor_name,'Someone') || ' sent you a friend request',
        notification_link,
        '{}'::jsonb
      );
    END IF;
  ELSIF TG_OP = 'UPDATE'
     AND NEW.status = 'accepted'
     AND coalesce(OLD.status, '') <> 'accepted'
     AND NEW.requester_id IS NOT NULL
     AND NEW.addressee_id IS NOT NULL
  THEN
    SELECT coalesce(p.display_name, p.username, 'Your friend')
      INTO actor_name
    FROM public.profiles p
    WHERE p.id = NEW.addressee_id;

    PERFORM public.emit_user_notification(
      NEW.requester_id,
      'friend_request_accepted',
      'Friend request accepted',
      coalesce(actor_name, 'Your friend') || ' accepted your friend request.',
      '/chat.html',
      jsonb_build_object('friendship_id', NEW.id, 'accepter_id', NEW.addressee_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notification_after_insert ON public.friendships;
CREATE TRIGGER friendships_notification_after_insert
AFTER INSERT ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friendship_event();

DROP TRIGGER IF EXISTS friendships_notification_after_update ON public.friendships;
CREATE TRIGGER friendships_notification_after_update
AFTER UPDATE OF status ON public.friendships
FOR EACH ROW EXECUTE FUNCTION public.notify_friendship_event();
