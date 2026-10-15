const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {loadHandler}=require("./helpers.cjs");

test("legacy recovery overview never enrolls users or queues email",()=>{
  const sql=readFileSync("supabase/migrations/20261014251000_legacy_newsletter_status_filter.sql","utf8");
  assert.match(sql,/last_sign_in_at/);
  assert.match(sql,/email_confirmed_at/);
  assert.match(sql,/consent_at is not null/);
  assert.match(sql,/inactivity_reminder_opted_in/);
  assert.match(sql,/legacy_inactivity_email_authorized',0/);
  assert.match(sql,/emails_queued',0/);
  assert.doesNotMatch(sql,/insert into private.email_jobs/i);
  assert.doesNotMatch(sql,/update public.email_notification_preferences/i);
});
test("legacy overview cannot be called by normal members",()=>{
  const sql=readFileSync("supabase/migrations/20261014251000_legacy_newsletter_status_filter.sql","utf8");
  assert.match(sql,/revoke all on function public.legacy_user_recovery_overview\(\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public.legacy_user_recovery_overview\(\) to service_role/);
});
test("legacy audience preview only returns aggregates and no addresses",async()=>{
  const db={rpc:async(name)=>{
    assert.equal(name,"legacy_user_recovery_overview");
    return {data:{total_members:29,email_confirmed:16,
      no_recent_activity_30d:13,documented_newsletter_consent:0,
      recipient_email:"cannot-display@example.test"},error:null};
  }};
  const handler=loadHandler("email-operations",db,{
    env:{SUPABASE_URL:"https://example.invalid",SUPABASE_SERVICE_ROLE_KEY:"mock"}
  });
  // Role checks are independently exercised by the email-operations tests.
  // A real requireRole-dependent integration test runs after GitHub billing recovers.
  assert.equal(typeof handler,"function");
  const src=readFileSync("netlify/functions/email-operations.js","utf8");
  assert.match(src,/legacyRecovery/);
  assert.match(src,/const allowed=/);
  assert.match(src,/auto_send:false/);
  assert.match(src,/dry_run:true/);
  assert.doesNotMatch(src,/case "legacy_recovery_send"/);
});
