REVOKE ALL ON FUNCTION public.notify_comment_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_direct_message_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_follow_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_friendship_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_post_like_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_verification_application_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_video_comment_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_video_like_event() FROM PUBLIC, anon, authenticated;
