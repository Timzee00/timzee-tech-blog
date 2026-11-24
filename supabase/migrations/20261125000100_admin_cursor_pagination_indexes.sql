-- Support the stable (created_at, id) keyset pages used by the admin UI.
-- Public post indexes are partial by status; staff can see drafts and scheduled
-- records too, so the all-status post list needs its own ordering index.
-- B-tree indexes can serve both forward and backward scans of this order.
CREATE INDEX IF NOT EXISTS posts_admin_cursor_idx
  ON public.posts (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS comments_admin_cursor_idx
  ON public.comments (created_at ASC NULLS LAST, id ASC);

CREATE INDEX IF NOT EXISTS contact_requests_admin_cursor_idx
  ON public.contact_requests (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS support_requests_admin_cursor_idx
  ON public.support_requests (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS newsletter_signups_admin_cursor_idx
  ON public.newsletter_signups (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS ad_applications_admin_cursor_idx
  ON public.ad_applications (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS admin_requests_admin_cursor_idx
  ON public.admin_requests (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS content_requests_admin_cursor_idx
  ON public.content_requests (created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS announcements_admin_cursor_idx
  ON public.announcements (created_at DESC NULLS LAST, id DESC);
