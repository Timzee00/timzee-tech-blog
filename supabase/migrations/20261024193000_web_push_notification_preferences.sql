-- Queue browser push only where the owner allows that notification class.
-- Browser push additionally requires explicit registered device permission.
CREATE OR REPLACE FUNCTION public.enqueue_web_push_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $push$
DECLARE kind text; member public.profiles%ROWTYPE; opted_in boolean;
BEGIN
 SELECT * INTO member FROM public.profiles WHERE id=NEW.user_id;
 IF NOT FOUND OR member.account_status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
 kind:=lower(coalesce(nullif(NEW.type,''),nullif(NEW.notification_type,''),''));
 IF kind IN ('direct_message','group_message','chat_message','message','message_request')
     AND NOT coalesce(member.notify_messages,true) THEN RETURN NEW; END IF;
 IF kind IN ('reply','discussion_reply','comment_reply','post_comment','forum_reply')
     AND NOT coalesce(member.notify_replies,true) THEN RETURN NEW; END IF;
 IF kind IN ('follow','new_follow','friend_request','friend_accept')
     AND NOT coalesce(member.notify_follows,true) THEN RETURN NEW; END IF;
 IF kind IN ('mention','chat_mention','discussion_mention')
     AND NOT coalesce(member.notify_mentions,true) THEN RETURN NEW; END IF;
 IF kind='profile_view' THEN
   SELECT (preferences #>> '{notifications,profileViews}')::boolean INTO opted_in
   FROM public.user_settings WHERE user_id=NEW.user_id;
   IF opted_in IS DISTINCT FROM true THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO public.web_push_deliveries(notification_id,subscription_id)
 SELECT NEW.id,s.id FROM public.web_push_subscriptions s
 WHERE s.user_id=NEW.user_id AND s.disabled_at IS NULL
 ON CONFLICT (notification_id,subscription_id) DO NOTHING;
 RETURN NEW;
END $push$;
REVOKE ALL ON FUNCTION public.enqueue_web_push_notification() FROM PUBLIC,anon,authenticated;
