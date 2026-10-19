-- Small partial indexes for the work queues a solo founder actually reviews.
-- Existing indexes begin with community_id and are not optimal for a
-- site-wide pending-items inbox as the number of communities grows.
CREATE INDEX IF NOT EXISTS community_reports_pending_ops_idx
 ON public.community_reports(created_at DESC,id)
 WHERE status IN ('pending','open');

CREATE INDEX IF NOT EXISTS community_auto_mod_pending_ops_idx
 ON public.community_auto_moderation(created_at DESC,id)
 WHERE state='pending';

CREATE INDEX IF NOT EXISTS verification_pending_ops_idx
 ON public.verification_applications(created_at,id)
 WHERE status='pending';

CREATE INDEX IF NOT EXISTS content_reports_open_ops_idx
 ON public.content_reports(created_at DESC,id)
 WHERE status='open';
