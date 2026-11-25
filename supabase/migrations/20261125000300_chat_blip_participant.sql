-- Blip is a first-class participant in direct and group chat.
-- AI sessions and processing claims are private to the server-side function.
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS is_blip boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS direct_messages_blip_context_idx
  ON public.direct_messages(thread_id, created_at DESC, id DESC)
  WHERE is_blip = false;

CREATE TABLE IF NOT EXISTS public.chat_ai_sessions (
  thread_id text PRIMARY KEY,
  invoked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoked_at timestamptz NOT NULL,
  last_blip_message_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_ai_events (
  source_message_id uuid PRIMARY KEY REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','sent','failed')),
  response_message_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.chat_ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_ai_events ENABLE ROW LEVEL SECURITY;

-- Deliberately no client policies: only the server's service-role function
-- can read or mutate invocation state and idempotency claims.
