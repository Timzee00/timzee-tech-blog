-- All existing member onboarding rows were checked for mismatches before validation.
-- A selected male/female gender cannot persist a missing or opposite starter avatar.
alter table public.member_onboarding drop constraint if exists member_onboarding_gender_avatar_consistent;
alter table public.member_onboarding add constraint member_onboarding_gender_avatar_consistent
check (
  gender not in ('male','female')
  or (avatar_style is not null and avatar_style=gender)
);
