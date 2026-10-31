-- Bounded retention for referral guess-attempt counters.
-- Keeps anti-abuse limits short lived on Supabase's small database tiers.
create or replace function private.blip_referral_prune_attempts()
returns integer language plpgsql security definer set search_path = '' as $$
declare cleaned integer;
begin
 with expired as (
  select user_id,attempt_day from private.blip_referral_claim_attempts
  where attempt_day < current_date-14
  order by attempt_day
  limit 10000
 )
 delete from private.blip_referral_claim_attempts p using expired e
 where p.user_id=e.user_id and p.attempt_day=e.attempt_day;
 get diagnostics cleaned = row_count;
 return cleaned;
end $$;
revoke all on function private.blip_referral_prune_attempts() from public,anon,authenticated;
-- Process a bounded batch every two hours, protecting the service on tiny plans.
select cron.schedule('blip-earn-prune-attempts','27 */2 * * *',
 'select private.blip_referral_prune_attempts();');
