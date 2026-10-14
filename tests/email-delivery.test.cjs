const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHandler } = require("./helpers.cjs");

const workerEnv = {
  EMAIL_DELIVERY_ENABLED: "true",
  BREVO_API_KEY: "test-only",
  BREVO_SENDER_EMAIL: "sender@example.test",
  BREVO_SENDER_NAME: "Timzee Tech Hub",
  EMAIL_WORKER_DAILY_CAP: "50"
};
const job = {
  id: "2b984c39-3056-47c8-bbc1-58b9012efaf1",
  template: "contact_received",
  recipient_email: "member@example.test",
  payload: { name: "Test Member", reference: "receipt-1" }
};

test("worker never sends without explicit enable flag", async () => {
  const handler = loadHandler("email-worker", { rpc: () => { throw Error("No calls allowed"); } });
  const response = await handler();
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /paused/);
});

test("worker fails closed when provider credentials are missing", async () => {
  const handler = loadHandler("email-worker", {}, { env: { EMAIL_DELIVERY_ENABLED: "true" } });
  const response = await handler();
  assert.equal(response.statusCode, 503);
});

test("worker enforces daily cap before claiming", async () => {
  const calls = [];
  const handler = loadHandler("email-worker", { rpc: async name => {
    calls.push(name);
    if (name === "email_delivery_statistics") return { data: { sent_last_24h: 50 }, error: null };
    throw Error("No other RPC allowed");
  }}, { env: workerEnv });
  const response = await handler();
  assert.match(response.body, /cap reached/);
  assert.deepEqual(calls, ["email_delivery_statistics"]);
});

test("suppressed email never reaches Brevo", async () => {
  const calls = [];
  const handler = loadHandler("email-worker", { rpc: async name => {
    calls.push(name);
    if(name === "email_delivery_statistics") return { data: { sent_last_24h: 0 }, error: null };
    if(name === "claim_email_jobs") return { data: [job], error: null };
    if(name === "is_email_suppressed") return { data: true, error: null };
    if(name === "suppress_email_job") return { data: true, error: null };
    throw Error("Unexpected RPC "+name);
  }}, { env: workerEnv, fetch: () => { throw Error("Suppressed recipient must not be emailed"); } });
  const response = await handler();
  const result=JSON.parse(response.body);
  assert.equal(result.sent,0);
  assert.equal(result.suppressed,1);
  assert.ok(calls.includes("suppress_email_job"));
});

test("worker reuses job UUID as provider idempotency key", async () => {
  let payload, requestCount=0, completed;
  const handler = loadHandler("email-worker", { rpc: async (name,args) => {
    if(name === "email_delivery_statistics") return { data: { sent_last_24h: 0 }, error: null };
    if(name === "claim_email_jobs") return { data: [job], error: null };
    if(name === "is_email_suppressed") return { data: false, error: null };
    if(name === "complete_email_job") { completed=args; return { data: null, error: null }; }
    throw Error("Unexpected RPC "+name);
  }}, { env: workerEnv, fetch: async (url,request) => {
    assert.equal(url,"https://api.brevo.com/v3/smtp/email");
    assert.equal(request.method,"POST");
    requestCount++;
    payload=JSON.parse(request.body);
    return { ok:true,status:201,json:async()=>({messageId:"mock-brevo-id"}) };
  }});
  const result=JSON.parse((await handler()).body);
  assert.equal(requestCount,1);
  assert.equal(payload.headers["Idempotency-Key"],job.id);
  assert.equal(payload.to[0].email,job.recipient_email);
  assert.equal(result.sent,1);
  assert.equal(completed.p_success,true);
});

test("webhook rejects missing bearer token without touching DB", async () => {
  const handler = loadHandler("brevo-webhook", { rpc:()=>{throw Error("Database touched without authentication"); } }, {
    env:{ BREVO_WEBHOOK_TOKEN:"webhook-test" }
  });
  const response=await handler({httpMethod:"POST",headers:{},body:JSON.stringify({event:"spam",email:"a@example.com"})});
  assert.equal(response.statusCode,401);
});

test("webhook records documented invalid_email event and ignores unrelated events", async () => {
  const calls=[];
  const handler=loadHandler("brevo-webhook",{rpc:async (name,args)=>{
    calls.push([name,args]);return {data:true,error:null};
  }},{env:{BREVO_WEBHOOK_TOKEN:"webhook-test"}});
  const response=await handler({
    httpMethod:"POST",
    headers:{authorization:"Bearer webhook-test"},
    body:JSON.stringify([
      {event:"invalid_email",email:"a@example.com"},
      {event:"opened",email:"a@example.com"}
    ])
  });
  assert.equal(response.statusCode,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"register_email_suppression");
  assert.equal(calls[0][1].p_reason,"invalid");
});

test("Brevo complaint label triggers spam suppression", async () => {
  const calls=[];
  const handler=loadHandler("brevo-webhook",{rpc:async (name,args)=>{
    calls.push([name,args]);return {data:true,error:null};
  }},{env:{BREVO_WEBHOOK_TOKEN:"webhook-test"}});
  const response=await handler({
    httpMethod:"POST",
    headers:{authorization:"Bearer webhook-test"},
    body:JSON.stringify({event:"complaint",email:"example@test.invalid"})
  });
  assert.equal(response.statusCode,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].p_reason,"spam");
});
