-- Fix PL/pgSQL trigger record-field lookup across settings, claims and awards.
-- CASE expressions plan field access eagerly; JSONB field lookup is safe for each record type.
create or replace function private.blip_reward_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare data_now jsonb:=to_jsonb(new);
 data_before jsonb;
 actor uuid;
 reward uuid;
 referrer uuid;
 referee uuid;
 note text;
begin
 data_before:=case when TG_OP='INSERT' then null else to_jsonb(old) end;
 actor:=coalesce(nullif(data_now->>'reviewed_by',''),nullif(data_now->>'updated_by',''))::uuid;
 reward:=nullif(data_now->>'id','')::uuid;
 referrer:=nullif(data_now->>'referrer_id','')::uuid;
 referee:=nullif(data_now->>'referred_user_id','')::uuid;
 note:=coalesce(nullif(data_now->>'review_note',''),nullif(data_now->>'confirmation_note',''));
 insert into private.blip_reward_audit(
  event_type,actor_id,reward_id,referrer_id,referral_user_id,previous,current,explanation
 ) values(TG_TABLE_NAME||':'||TG_OP,actor,reward,referrer,referee,data_before,data_now,note);
 return new;
end $$;
revoke all on function private.blip_reward_audit_change() from public,anon,authenticated;
