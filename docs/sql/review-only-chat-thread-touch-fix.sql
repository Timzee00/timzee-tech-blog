-- Review-only: fixes the confirmed direct-message INSERT failure.
-- public.direct_messages.thread_id is text; public.chat_threads.id is uuid.
-- Do NOT compare ct.id = NEW.thread_id directly.
-- Validate in staging, back up, and deploy through an approved migration.
CREATE OR REPLACE FUNCTION public.touch_chat_thread_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.thread_id IS NULL THEN RETURN NEW; END IF;
  -- Avoid casting arbitrary text thread IDs, including legacy DM keys.
  -- Cast the UUID column to text instead, which never throws.
  UPDATE public.chat_threads
     SET updated_at = now()
   WHERE id::text = NEW.thread_id;
  RETURN NEW;
END;
$$;
