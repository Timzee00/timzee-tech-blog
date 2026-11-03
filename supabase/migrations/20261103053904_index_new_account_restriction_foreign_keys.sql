-- Cover the four remaining foreign-key columns added with timed restrictions.
CREATE INDEX IF NOT EXISTS account_restrictions_created_by_idx
  ON public.account_restrictions (created_by);
CREATE INDEX IF NOT EXISTS account_restrictions_revoked_by_idx
  ON public.account_restrictions (revoked_by);
CREATE INDEX IF NOT EXISTS account_restriction_appeals_user_id_idx
  ON public.account_restriction_appeals (user_id);
CREATE INDEX IF NOT EXISTS account_restriction_appeals_reviewed_by_idx
  ON public.account_restriction_appeals (reviewed_by);
