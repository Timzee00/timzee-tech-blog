-- Admin-controlled feature launch board and opt-in, server-owned reminders.
-- A timer is not an access-control boundary. Feature status becomes live only
-- on explicit staff publication, or when staff enables auto-launch.
CREATE TABLE public.feature_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 64),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1200),
  status text NOT NULL DEFAULT 'coming_soon'
    CHECK (status IN ('coming_soon','in_progress','paused','live')),
  target_path text CHECK (
    target_path IS NULL OR (
      length(target_path) <= 180
      AND target_path ~ '^/[a-zA-Z0-9/_-]+[.]html(#[a-zA-Z][a-zA-Z0-9_-]{1,63})?$'
      AND target_path NOT LIKE '%..%'
    )
  ),
  launch_at timestamptz,
  auto_launch boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT true,
  notify_enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_launch_has_time CHECK (NOT auto_launch OR launch_at IS NOT NULL)
);
CREATE INDEX feature_launches_public_index ON public.feature_launches (status, launch_at)
  WHERE is_public = true;
CREATE INDEX feature_launches_auto_index ON public.feature_launches (launch_at)
  WHERE is_public = true AND auto_launch = true AND status IN ('coming_soon','in_progress');
CREATE INDEX feature_launches_target_index ON public.feature_launches (target_path)
  WHERE is_public = true AND target_path IS NOT NULL;

CREATE TABLE public.feature_launch_subscriptions (
  launch_id uuid NOT NULL REFERENCES public.feature_launches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  PRIMARY KEY (launch_id, user_id)
);
CREATE INDEX feature_launch_subscriptions_pending_index
  ON public.feature_launch_subscriptions (created_at, launch_id)
  WHERE notified_at IS NULL;
CREATE INDEX feature_launch_subscriptions_user_index
  ON public.feature_launch_subscriptions (user_id, launch_id);

ALTER TABLE public.feature_launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_launch_subscriptions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.feature_launches TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feature_launches TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.feature_launch_subscriptions TO authenticated;

CREATE POLICY feature_launch_public_read ON public.feature_launches
  FOR SELECT TO anon, authenticated
  USING (is_public = true);
CREATE POLICY feature_launch_staff_read ON public.feature_launches
  FOR SELECT TO authenticated
  USING ((SELECT public.has_role_secure('admin')) OR (SELECT public.has_role_secure('super')));
CREATE POLICY feature_launch_staff_insert ON public.feature_launches
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role_secure('admin')) OR (SELECT public.has_role_secure('super')));
CREATE POLICY feature_launch_staff_update ON public.feature_launches
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_role_secure('admin')) OR (SELECT public.has_role_secure('super')))
  WITH CHECK ((SELECT public.has_role_secure('admin')) OR (SELECT public.has_role_secure('super')));
CREATE POLICY feature_launch_staff_delete ON public.feature_launches
  FOR DELETE TO authenticated
  USING ((SELECT public.has_role_secure('admin')) OR (SELECT public.has_role_secure('super')));

CREATE POLICY feature_launch_subscriptions_self_read ON public.feature_launch_subscriptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY feature_launch_subscriptions_self_insert ON public.feature_launch_subscriptions
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.feature_launches l
      WHERE l.id = launch_id AND l.is_public = true AND l.status <> 'live'
    )
  );
CREATE POLICY feature_launch_subscriptions_self_delete ON public.feature_launch_subscriptions
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION private.touch_feature_launch()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION private.touch_feature_launch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER feature_launch_touch BEFORE UPDATE ON public.feature_launches
  FOR EACH ROW EXECUTE FUNCTION private.touch_feature_launch();

-- Batch release and delivery to avoid spikes when a feature has many followers.
-- A row lock protects against duplicate notifications from overlapping cron runs.
CREATE OR REPLACE FUNCTION private.process_feature_launches(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  item record;
  launched_count integer := 0;
  notified_count integer := 0;
BEGIN
  UPDATE public.feature_launches
  SET status = 'live'
  WHERE status IN ('coming_soon','in_progress')
    AND is_public AND auto_launch AND launch_at <= now();
  GET DIAGNOSTICS launched_count = ROW_COUNT;

  FOR item IN
    SELECT s.launch_id, s.user_id, l.slug, l.title
    FROM public.feature_launch_subscriptions s
    JOIN public.feature_launches l ON l.id = s.launch_id
    WHERE s.notified_at IS NULL AND l.status = 'live'
      AND l.is_public AND l.notify_enabled
    ORDER BY s.created_at, s.launch_id
    LIMIT greatest(1, least(coalesce(p_limit, 200), 500))
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    PERFORM public.emit_user_notification(
      item.user_id,
      'feature_launch',
      'Now available: ' || left(item.title, 110),
      'A feature you followed is now live on Timzee Tech Hub.',
      '/launches.html?feature=' || item.slug,
      jsonb_build_object('launch_id', item.launch_id, 'slug', item.slug)
    );
    UPDATE public.feature_launch_subscriptions
    SET notified_at = now()
    WHERE launch_id = item.launch_id AND user_id = item.user_id;
    notified_count := notified_count + 1;
  END LOOP;

  RETURN jsonb_build_object('launched', launched_count, 'notified', notified_count);
END
$$;
REVOKE ALL ON FUNCTION private.process_feature_launches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_feature_launches(integer) TO postgres, service_role;

-- Database-local five-minute cron also runs when the Netlify site is not open.
SELECT cron.schedule(
  'timzee-feature-launches-five-min',
  '*/5 * * * *',
  'SELECT private.process_feature_launches()'
);