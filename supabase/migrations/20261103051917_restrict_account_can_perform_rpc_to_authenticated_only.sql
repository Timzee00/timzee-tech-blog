-- Supabase default function ACL also grants anon directly.
-- Keep this SECURITY DEFINER RLS helper callable by authenticated users only.
REVOKE EXECUTE ON FUNCTION public.account_can_perform(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_can_perform(text) TO authenticated;
