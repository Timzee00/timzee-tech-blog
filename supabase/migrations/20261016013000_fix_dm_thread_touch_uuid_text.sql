-- Repair UUID/text mismatch caused by the chat thread touch trigger.
-- Direct conversations use stable text keys; chat_threads.id remains UUID.
CREATE OR REPLACE FUNCTION public.touch_chat_thread_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.recipient_id IS NULL AND NEW.thread_id IS NOT NULL THEN
    UPDATE public.chat_threads
    SET updated_at=now()
    WHERE id::text=NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;
