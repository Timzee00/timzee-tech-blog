const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const read=path=>readFileSync(path,"utf8");

test("optional email categories start off and are independently user-owned",()=>{
  const sql=read("supabase/migrations/20261014234500_email_notification_preferences.sql");
  for(const name of ["message_digest","mention_digest","marketplace_alerts","community_digest"]) {
    assert.match(sql,new RegExp(name+" boolean not null default false"));
  }
  assert.match(sql,/user_id=\(select auth\.uid\(\)\)/);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on public.email_notification_preferences from public,anon,authenticated/i);
});
test("settings UI explains optional mail is not live and marketing requires separate consent",()=>{
  const src=read("assets/js/settings-page.js");
  assert.match(src,/data-email-notification="message_digest"/);
  assert.match(src,/data-email-notification="mention_digest"/);
  assert.match(src,/data-email-notification="marketplace_alerts"/);
  assert.match(src,/data-email-notification="community_digest"/);
  assert.match(src,/Marketing mail requires separate consent/);
  assert.match(src,/saveEmailPreferences\(\)/);
});
test("audited manual reviews never mutate the send queue or replay an email",()=>{
  const sql=read("supabase/migrations/20261014223000_email_manual_review_audit.sql");
  assert.match(sql,/record_email_review_action/);
  assert.match(sql,/private.email_review_actions/);
  assert.match(sql,/for update/);
  assert.doesNotMatch(sql,/set status='pending'/i);
  assert.doesNotMatch(sql,/reset.*email.*send/i);
});
test("admin case listing never requests recipient addresses or content",()=>{
  const sql=read("supabase/migrations/20261014223000_email_manual_review_audit.sql");
  const list=sql.slice(sql.indexOf("create or replace function public.list_email_review_cases"),sql.indexOf("create or replace function public.record_email_review_action"));
  assert.doesNotMatch(list,/recipient_email|\bpayload\b/);
  assert.match(list,/Manual reconciliation required:/);
});
