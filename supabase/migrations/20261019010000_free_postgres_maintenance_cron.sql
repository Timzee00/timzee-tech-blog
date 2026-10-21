-- Free database-local housekeeping. Supabase Cron runs within PostgreSQL,
-- so it does not depend on GitHub Actions billing or a running Netlify deploy.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Reuse the existing idempotent, lock-aware automation functions.
-- We schedule sparingly to protect free-tier database CPU resources.
SELECT cron.schedule(
  'timzee-core-maintenance-hourly',
  '17 * * * *',
  'SELECT public.process_automation_tick()'
);
SELECT cron.schedule(
  'timzee-verification-maintenance-daily',
  '35 4 * * *',
  'SELECT public.process_verification_maintenance()'
);
