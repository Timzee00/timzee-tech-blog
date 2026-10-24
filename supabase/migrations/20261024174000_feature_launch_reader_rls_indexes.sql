-- Keep guest visibility and staff visibility independent by role instead of
-- stacking permissive authenticated SELECT policies on the same table.
DROP POLICY IF EXISTS feature_launch_public_read ON public.feature_launches;
DROP POLICY IF EXISTS feature_launch_staff_read ON public.feature_launches;

CREATE POLICY feature_launch_public_read ON public.feature_launches
  FOR SELECT TO anon
  USING (is_public = true);

CREATE POLICY feature_launch_authenticated_read ON public.feature_launches
  FOR SELECT TO authenticated
  USING (
    is_public = true
    OR (SELECT public.has_role_secure('admin'))
    OR (SELECT public.has_role_secure('super'))
  );

-- Covers creator-account deletion and foreign-key checks without scanning all launches.
CREATE INDEX IF NOT EXISTS feature_launches_created_by_idx
  ON public.feature_launches (created_by)
  WHERE created_by IS NOT NULL;
