
-- A suspended/banned account must not bypass core restrictions through stories,
-- reading comments or published novel content using a still-valid auth token.
-- Keep this small: don't block settings/privacy updates or support appeals.
DO $extra$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['stories','story_comments','novels','novel_comments'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS moderation_account_write_guard ON public.%I',tbl);
   EXECUTE format('CREATE TRIGGER moderation_account_write_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.block_restricted_account_writes()',tbl);
 END LOOP;
END $extra$;
