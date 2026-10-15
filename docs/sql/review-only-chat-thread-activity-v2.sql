-- REVIEW-ONLY migration: apply to isolated Supabase staging after backup.
-- DATE: 2026-10-15
-- LIVE FINDING: direct_messages.thread_id TEXT vs chat_threads.id UUID,
-- original trigger performed "WHERE id = NEW.thread_id" and every message
-- insert can fail with 42883 "operator does not exist: uuid = text".
-- Second finding: chat_threads UPDATE policy allows only created_by. The
-- trigger must bump activity for an authenticated group participant without
-- granting general UPDATE on thread name/avatar/settings.
-- Do not apply automatically to production or grant broader table rights.

CREATE OR REPLACE FUNCTION public.touch_chat_thread_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_uuid uuid;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.thread_id IS NULL OR NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Authenticated sender only; never let a service-role or arbitrary caller
  -- influence unrelated threads through a crafted direct-message thread_id.
  IF auth.uid() IS DISTINCT FROM NEW.sender_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    target_uuid := NEW.thread_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Legacy 1:1 conversations sometimes use a non-UUID composite key.
    RETURN NEW;
  END;
  UPDATE public.chat_threads AS t
     SET updated_at = now()
   WHERE t.id = target_uuid
     AND (
       t.created_by = NEW.sender_id
       OR EXISTS (
         SELECT 1 FROM public.chat_members cm
          WHERE cm.thread_id = t.id AND cm.user_id = NEW.sender_id
       )
     );
  RETURN NEW;
END;
$$;

-- The existing AFTER INSERT trigger remains attached. Avoid revoking or
-- changing INSERT policies on direct_messages in this migration.
-- The SECURITY DEFINER owner must be a trusted DB owner with UPDATE rights;
-- review SECURITY DEFINER function ownership, grants and schema search path
-- prior to deployment. Trigger functions cannot be called directly.
-- Required staging checks:
-- 1. owner sends a message to a real UUID-backed thread => succeeds, activity bumps
-- 2. invited member sends in the same thread => succeeds, activity bumps
-- 3. stranger cannot write to a thread or alter its settings
-- 4. legacy non-UUID DM thread identifier => message insertion remains valid
-- 5. sender_id impersonation => rejected by direct_messages INSERT policy
-- 6. blocked users and private-media permissions remain enforced
-- 7. two-account realtime delivery and notification still work
--
-- Rollback: restore pg_get_functiondef() of the previous function from the
-- staging backup. NEVER roll back to the original invalid "uuid = text" code.
