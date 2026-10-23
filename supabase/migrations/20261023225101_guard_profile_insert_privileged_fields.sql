-- Guard initial profile inserts without modifying data or the existing UPDATE trigger.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Backend/service-role writes have no auth.uid() and are allowed to perform
  -- moderation/account-management changes. Normal signed-in users may only
  -- create/update their own presentation and preference fields.
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      if new.id is distinct from (select auth.uid()) then
        raise exception 'Profile identity cannot be changed';
      end if;
      if lower(coalesce(new.role, 'user')) <> 'user'
         or coalesce(new.is_verified, false)
         or lower(coalesce(new.verification_tier, 'standard')) <> 'standard'
         or lower(coalesce(new.account_status, 'active')) <> 'active'
         or coalesce(new.verified_at, null) is not null
         or new.verification_expires_at is not null
         or coalesce(new.points, 0) <> 0
         or new.level is not null
         or coalesce(new.is_featured, false)
         or coalesce(new.is_staff_pick, false) then
        raise exception 'Protected profile fields can only be initialized by the server';
      end if;
    else
      if new.id is distinct from old.id then
        raise exception 'Profile identity cannot be changed';
      end if;
      if new.role is distinct from old.role
         or new.is_verified is distinct from old.is_verified
         or new.verification_tier is distinct from old.verification_tier
         or new.account_status is distinct from old.account_status
         or new.verified_at is distinct from old.verified_at
         or new.verification_expires_at is distinct from old.verification_expires_at
         or new.points is distinct from old.points
         or new.level is distinct from old.level
         or new.is_featured is distinct from old.is_featured
         or new.is_staff_pick is distinct from old.is_staff_pick
         or new.created_at is distinct from old.created_at then
        raise exception 'Protected profile fields can only be changed by the server';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
CREATE TRIGGER protect_profile_privileged_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();
