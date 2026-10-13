const test=require("node:test");
const assert=require("node:assert/strict");
const {isScheduledInvocation}=require("../netlify/functions/_lib/scheduled-event.cjs");
test("Netlify scheduled payload is accepted on the cron function",()=>{
 assert.equal(isScheduledInvocation({httpMethod:"POST",body:JSON.stringify({next_run:"2026-10-13T10:00:00Z"})}),true);
 assert.equal(isScheduledInvocation({headers:{"X-Nf-Event":"schedule"}}),true);
});
test("ordinary POSTs do not bypass manual authentication",()=>{
 assert.equal(isScheduledInvocation({httpMethod:"POST",body:"{}"}),false);
 assert.equal(isScheduledInvocation({httpMethod:"GET",body:'{"next_run":"2026-10-13T10:00:00Z"}'}),false);
 assert.equal(isScheduledInvocation({httpMethod:"POST",body:'{"next_run":"not-a-date"}'}),false);
});
