-- Prevent user-defined topic flair text from impersonating Timzee staff or verified companies.
ALTER TABLE public.community_threads DROP CONSTRAINT IF EXISTS community_flair_no_impersonation;
ALTER TABLE public.community_threads ADD CONSTRAINT community_flair_no_impersonation
CHECK(flair IS NULL OR lower(btrim(flair)) !~ '^(official|verified|administrator|admin|staff|moderator|timzee[ -]team)(\W|$)');
