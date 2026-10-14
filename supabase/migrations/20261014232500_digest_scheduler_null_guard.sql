-- Explicitly reject NULL parameters rather than allowing ambiguous scheduling flags.
-- The defaults still support prepare_email_digests() as a dry run.
alter function public.prepare_email_digests(boolean,integer)
  returns null on null input;
