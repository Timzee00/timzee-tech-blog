-- Private onboarding details are not part of public_profiles.
CREATE TABLE IF NOT EXISTS public.member_onboarding(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 age_years smallint CHECK(age_years BETWEEN 13 AND 120),
 gender text CHECK(gender IN ('female','male','prefer_not_to_say')),
 interests text[] NOT NULL DEFAULT '{}',
 avatar_style text CHECK(avatar_style IN ('female','male','neutral')),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.member_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_onboarding FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.member_onboarding TO authenticated;
GRANT ALL ON public.member_onboarding TO service_role;
DROP POLICY IF EXISTS "Owner reads onboarding" ON public.member_onboarding;
CREATE POLICY "Owner reads onboarding" ON public.member_onboarding FOR SELECT TO authenticated
 USING ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS "Owner inserts onboarding" ON public.member_onboarding;
CREATE POLICY "Owner inserts onboarding" ON public.member_onboarding FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid())=user_id);
DROP POLICY IF EXISTS "Owner updates onboarding" ON public.member_onboarding;
CREATE POLICY "Owner updates onboarding" ON public.member_onboarding FOR UPDATE TO authenticated
 USING ((SELECT auth.uid())=user_id) WITH CHECK ((SELECT auth.uid())=user_id);
