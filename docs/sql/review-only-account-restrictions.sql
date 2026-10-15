-- REVIEW BEFORE APPLYING. Server-enforced temporary account restrictions.
-- Additive RESTRICTIVE RLS INSERT policies compose with existing permissive policies.
-- Only trusted server actions (service_role) can create/revoke a restriction.
CREATE TABLE IF NOT EXISTS public.account_restrictions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK (scope IN ('all','posts','comments','videos','marketplace','messages')),
 reason_code text NOT NULL CHECK (reason_code IN ('spam','harassment','fraud','impersonation','abuse','security','other')),
 explanation text NOT NULL CHECK (length(trim(explanation)) BETWEEN 8 AND 1000),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 origin text NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','automatic')),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revoked_by uuid REFERENCES auth.users(id),
 revoke_note text,
 CHECK (expires_at > created_at),
 CHECK ((status='active' AND revoked_at IS NULL) OR status='revoked')
);
CREATE INDEX IF NOT EXISTS account_restrictions_lookup_idx
 ON public.account_restrictions(user_id,expires_at DESC,scope) WHERE status='active';
ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_restrictions FROM anon,authenticated;
GRANT SELECT ON public.account_restrictions TO authenticated;
-- User can inspect reasons, dates and appeal information for own account.
CREATE POLICY "users_read_own_restrictions" ON public.account_restrictions
 FOR SELECT TO authenticated USING ((select auth.uid())=user_id);
-- No INSERT/UPDATE/DELETE to authenticated; service_role handles all writes.
CREATE OR REPLACE FUNCTION public.account_can_perform(p_scope text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM public.account_restrictions r
  WHERE r.user_id=(select auth.uid())
    AND r.status='active'
    AND r.expires_at > now()
    AND r.scope IN ('all',p_scope)
 );
$$;
REVOKE ALL ON FUNCTION public.account_can_perform(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_can_perform(text) TO authenticated;
-- Apply only to INSERT, never SELECT or UPDATE: users keep their data, can
-- appeal and delete content, and see exactly what was restricted.
CREATE POLICY "restricted_user_posts_insert" ON public.posts
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('posts'));
CREATE POLICY "restricted_user_comments_insert" ON public.comments
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('comments'));
CREATE POLICY "restricted_user_video_comments_insert" ON public.video_comments
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('comments'));
CREATE POLICY "restricted_user_discussion_insert" ON public.discussion_messages
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('comments'));
CREATE POLICY "restricted_user_videos_insert" ON public.videos
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('videos'));
CREATE POLICY "restricted_user_marketplace_insert" ON public.marketplace_items
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('marketplace'));
CREATE POLICY "restricted_user_messages_insert" ON public.direct_messages
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.account_can_perform('messages'));
-- Optional appeal system with owner-only access. Restriction id must belong to filer.
CREATE TABLE IF NOT EXISTS public.account_restriction_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restriction_id uuid NOT NULL REFERENCES public.account_restrictions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(length(trim(body)) BETWEEN 20 AND 2000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','overturned')),
 reviewed_by uuid REFERENCES auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restriction_id,user_id)
);
ALTER TABLE public.account_restriction_appeals ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.account_restriction_appeals TO authenticated;
CREATE POLICY "appeals_view_own" ON public.account_restriction_appeals
 FOR SELECT TO authenticated USING(user_id=(select auth.uid()));
CREATE POLICY "appeals_create_own" ON public.account_restriction_appeals
 FOR INSERT TO authenticated WITH CHECK(
 user_id=(select auth.uid()) AND EXISTS(
 SELECT 1 FROM public.account_restrictions r
 WHERE r.id=restriction_id AND r.user_id=(select auth.uid())
 ));
-- Revoke on overturned appeal through service-role action, not client SQL.
