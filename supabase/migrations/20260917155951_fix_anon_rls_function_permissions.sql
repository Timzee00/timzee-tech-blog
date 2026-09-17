-- RLS policy predicates are evaluated by anonymous visitors too. These helper
-- functions are safe for anonymous execution because they only return a boolean
-- derived from auth.uid(); anonymous auth.uid() is NULL, so they return false.
GRANT EXECUTE ON FUNCTION public.has_role(text) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role_secure(text) TO anon;

-- Chat membership is used inside RLS policies that may be evaluated by anon.
-- Keep the helper callable for policy evaluation, but never reveal another
-- user's membership to anonymous callers (or allow cross-user membership checks).
CREATE OR REPLACE FUNCTION private.is_chat_member_impl(thread_id text, member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  thread_uuid uuid;
  current_user_id uuid;
begin
  current_user_id := (select auth.uid());
  if current_user_id is null or member_id is null or member_id <> current_user_id then
    return false;
  end if;
  if thread_id is null then return false; end if;
  begin
    thread_uuid := thread_id::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1 from public.chat_members cm
    where cm.thread_id = thread_uuid and cm.user_id = member_id
  );
end;
$function$;

GRANT EXECUTE ON FUNCTION public.is_chat_member(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_chat_member(text, uuid) TO authenticated;
