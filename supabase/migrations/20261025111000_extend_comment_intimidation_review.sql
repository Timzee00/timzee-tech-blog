-- Conservative extension of the existing automatic comment triage.
-- 35+ is a review flag; 65+ temporarily holds content until a moderator checks
-- the context. No automated account bans, deletions or punishment.
CREATE OR REPLACE FUNCTION private.classify_comment_for_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE content text:=coalesce(new.body,'');v_score integer:=0;
 v_signals text[]:=ARRAY[]::text[];v_links integer:=0;v_repeats boolean:=false;
BEGIN
 -- Always recompute risk on the server; the browser cannot assign trusted scores.
 SELECT count(*) INTO v_links FROM regexp_matches(content,'https?://','gi');
 IF v_links>=3 THEN
  v_score:=v_score+65;v_signals:=array_append(v_signals,'excessive_links');
 END IF;
 IF content ~* '(free money|guaranteed returns|double your money|click here now|send your password)' THEN
  v_score:=v_score+40;v_signals:=array_append(v_signals,'possible_scam');
 END IF;
 -- These phrases are narrow, actionable indicators. A human decides guilt.
 IF content ~* '(kill yourself|i will kill you|i am going to hurt you|i will hurt you)' THEN
  v_score:=v_score+85;v_signals:=array_append(v_signals,'possible_direct_threat');
 END IF;
 -- Additional high-confidence safety signals. Reports are not proof of guilt:
 -- lower-severity intimidation is flagged for review, not automatically hidden.
 IF content ~* '(i will track you down|i know where you live and|i will find you and hurt you|i am coming to hurt you)' THEN
  v_score:=v_score+80;v_signals:=array_append(v_signals,'possible_targeted_threat');
 END IF;
 IF content ~* '(you are worthless|nobody likes you|everyone hates you|you should disappear)' THEN
  v_score:=v_score+35;v_signals:=array_append(v_signals,'possible_targeted_harassment');
 END IF;
 IF content ~* '(send (me|us) (your )?(otp|one.time password|verification code)|give me your (otp|verification code))' THEN
  v_score:=v_score+50;v_signals:=array_append(v_signals,'possible_credential_phishing');
 END IF;
 IF length(content)>=40 AND length(regexp_replace(content,'[^!]','','g'))>=18 THEN
  v_score:=v_score+25;v_signals:=array_append(v_signals,'excessive_punctuation');
 END IF;
 IF new.author_id IS NOT NULL THEN
  SELECT EXISTS(
   SELECT 1 FROM public.comments c WHERE c.author_id=new.author_id
     AND c.created_at>now()-interval '30 minutes' AND length(btrim(coalesce(c.body,'')))>=25
     AND lower(btrim(c.body))=lower(btrim(content))
  ) INTO v_repeats;
  IF v_repeats THEN
   v_score:=v_score+65;v_signals:=array_append(v_signals,'repeated_identical_comment');
  END IF;
  IF (SELECT count(*) FROM public.comments c
     WHERE c.author_id=new.author_id AND c.created_at>now()-interval '2 minutes')>=7 THEN
   v_score:=v_score+35;v_signals:=array_append(v_signals,'high_comment_frequency');
  END IF;
 END IF;
 new.automod_score:=least(v_score,100);new.automod_signals:=v_signals;
 IF new.automod_score>=65 THEN
  new.status:='pending';
  new.moderation_reason:='Temporarily held for automated safety review';
 ELSIF new.automod_score>=35 THEN
  new.moderation_reason:='Flagged for moderator review';
 ELSE
  new.moderation_reason:=NULL;
 END IF;
 RETURN new;
END $function$
;
REVOKE ALL ON FUNCTION private.classify_comment_for_review() FROM PUBLIC,anon,authenticated;
