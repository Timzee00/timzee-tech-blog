-- GUARDED_MIGRATIONS_AND_RLS_FIXES.sql
-- Run this script in your Supabase SQL editor (or psql) to:
-- 1) Add missing columns (mentions, reply_to, is_edited, edited_at) to comments/direct_messages
-- 2) Create indexes for mentions array columns
-- 3) Add helper functions to safely resolve user roles from JWT or profiles
-- 4) Create a SECURITY DEFINER helper to add chat members (avoids RLS insert failures by trusted function)
-- 5) Create/replace a safe insert policy for chat_members that lets thread owners or admins add members

-- IMPORTANT: Review before running. These commands use "IF NOT EXISTS" and guarded constructs where possible.

-- 1) Add missing columns and indexes
ALTER TABLE IF EXISTS public.comments
  ADD COLUMN IF NOT EXISTS mentions uuid[];

CREATE INDEX IF NOT EXISTS comments_mentions_idx ON public.comments USING gin (mentions);

ALTER TABLE IF EXISTS public.direct_messages
  ADD COLUMN IF NOT EXISTS mentions uuid[];

CREATE INDEX IF NOT EXISTS direct_messages_mentions_idx ON public.direct_messages USING gin (mentions);

ALTER TABLE IF EXISTS public.comments
  ADD COLUMN IF NOT EXISTS reply_to uuid,
  ADD COLUMN IF NOT EXISTS is_edited boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE IF EXISTS public.direct_messages
  ADD COLUMN IF NOT EXISTS reply_to uuid;

-- 2) Add a helper to robustly resolve role for the current auth user
CREATE OR REPLACE FUNCTION public.get_jwt_role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role'),
    (auth.jwt() -> 'user_metadata') ->> 'role',
    (SELECT role::text FROM public.profiles WHERE id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is(role_text text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT public.get_jwt_role() = role_text;
$$;

-- Grant usage: function is stable and readable by policies; no special grants are strictly required, but it's fine to make it public
GRANT EXECUTE ON FUNCTION public.get_jwt_role() TO public;
GRANT EXECUTE ON FUNCTION public.auth_is(text) TO public;

-- 3) Add a SECURITY DEFINER helper to add chat members in batch (trusted function)
-- This lets your application call a single RPC to add members and avoids per-row RLS insert failures.
CREATE OR REPLACE FUNCTION public.add_chat_members(thread uuid, members jsonb[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  m jsonb;
BEGIN
  FOREACH m IN ARRAY members LOOP
    INSERT INTO public.chat_members (id, thread_id, user_id, role, joined_at, created_by)
    VALUES (
      COALESCE((m->>'id')::uuid, gen_random_uuid()),
      thread,
      (m->>'user_id')::uuid,
      COALESCE(m->>'role', 'member'),
      COALESCE((m->>'joined_at')::timestamptz, now()),
      auth.uid()
    )
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END LOOP;
END;
$$;

-- Restrict direct public execution then grant to authenticated role used by Supabase
REVOKE ALL ON FUNCTION public.add_chat_members(uuid, jsonb[]) FROM public;
GRANT EXECUTE ON FUNCTION public.add_chat_members(uuid, jsonb[]) TO authenticated; 

-- 4) Ensure there's a clear policy allowing thread owners or admins to insert members
-- Drop and recreate a safe policy for chat_members insert. Adjust names to match your conventions.
-- NOTE: This policy is intentionally permissive for thread owners (owner_id = auth.uid()).
DROP POLICY IF EXISTS allow_thread_owner_insert ON public.chat_members;

CREATE POLICY allow_thread_owner_insert ON public.chat_members
  FOR INSERT
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM public.chat_threads
        WHERE id = thread_id
          AND created_by = auth.uid()
      )
    )
    OR public.auth_is('admin')
    OR auth.uid() = user_id
  );

-- 5) Optional: create/update helpful indexes for chat lookups
CREATE INDEX IF NOT EXISTS chat_members_thread_idx ON public.chat_members (thread_id);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON public.chat_members (user_id);

-- 6) Add guidance output comment
-- After running this script, do the following tests:
-- - Test posting a comment containing mentions (verify no "could not find column 'mentions'" error)
-- - Create a chat thread and use RPC: SELECT public.add_chat_members('<thread-uuid>'::uuid, ARRAY[jsonb_build_object('user_id','<user-uuid>')::jsonb]); to add members
-- - Retry the UI flow for adding members; if you want the client to call the RPC, wire it to call the function instead of inserting directly
-- - If you have existing policies that reference auth.jwt() -> 'user_metadata' (raw text), consider editing them to use public.get_jwt_role() for robustness.

-- End of script

