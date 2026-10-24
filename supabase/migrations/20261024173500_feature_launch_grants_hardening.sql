-- Supabase's schema-default table grants can include TRUNCATE and TRIGGER.
-- RLS does not protect TRUNCATE: explicitly narrow privileges on the new tables.
REVOKE ALL PRIVILEGES ON TABLE public.feature_launches FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.feature_launch_subscriptions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.feature_launches TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.feature_launches TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.feature_launch_subscriptions TO authenticated;

-- Public visitors must never see subscriber IDs, while users can only see and
-- cancel their own subscriptions under the existing RLS policies.
