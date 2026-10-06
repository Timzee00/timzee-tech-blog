const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonObject } = require("../netlify/functions/_lib/request.js");
const { requireRole } = require("../netlify/functions/_lib/auth-role.js");
const { loadHandler, query, event } = require("./helpers.cjs");

function database(profile = { role: "super", account_status: "active" }, error = null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "actor", app_metadata: { role: "super" }, user_metadata: { role: "super" } } } }) },
    from: () => query({ data: profile, error })
  };
}

test("request parser rejects non-object, invalid, and oversized JSON", () => {
  for (const body of ["null", "[]", "42", '"text"', "{"]) assert.equal(parseJsonObject({ body }).statusCode, 400);
  assert.equal(parseJsonObject({ body: "x".repeat(65537) }).statusCode, 413);
  assert.equal(parseJsonObject({ body: '"é"'.repeat(32769) }).statusCode, 413);
  assert.deepEqual(parseJsonObject({ body: Buffer.from('{"path":"abc"}').toString("base64"), isBase64Encoded: true }).payload, { path: "abc" });
});

test("privileged role checks fail closed on missing, suspended, or unavailable profiles", async () => {
  for (const db of [database(null), database(null, { message: "unavailable" }), database({ role: "super", account_status: "suspended" })]) {
    assert.ok((await requireRole(db, "token", ["super"], "Forbidden")).error);
  }
  assert.equal((await requireRole(database({ role: "user", account_status: "active" }), "token", ["super"], "Forbidden")).error, "Forbidden");
  assert.equal((await requireRole(database(), "token", ["super"], "Forbidden")).role, "super");
  assert.ok((await requireRole(database(), "", ["super"], "Forbidden")).error);
});

for (const name of ["create-admin", "update-admin", "update-admin-role", "update-user", "moderate-content", "chat-media-sign", "llm-proxy"]) {
  test(`${name} rejects null JSON instead of throwing a server error`, async () => {
    const response = await loadHandler(name, database())(event(null));
    assert.equal(response.statusCode, 400);
    assert.match(response.headers["Cache-Control"], /no-store/);
  });
}

test("demotion does not report success when auth metadata synchronization returns an error", async () => {
  const db = database();
  db.auth.admin = {
    getUserById: async () => ({ data: { user: { id: "target", app_metadata: { role: "admin" } } } }),
    updateUserById: async () => ({ error: { message: "Auth unavailable" } })
  };
  let reads = 0;
  db.from = () => query({ data: ++reads === 1 ? { role: "super", account_status: "active" } : { id: "target", role: "admin" }, error: null });
  const response = await loadHandler("update-admin-role", db)(event({ userId: "target", action: "remove_admin" }));
  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /synchronization failed/);
});

test("admin creation reports a failed profile write", async () => {
  const db = database();
  db.auth.admin = {
    listUsers: async () => ({ data: { users: [] } }),
    createUser: async () => ({ data: { user: { id: "created" } } })
  };
  let reads = 0;
  db.from = () => query(++reads === 1 ? { data: { role: "super", account_status: "active" } } : { error: { message: "write unavailable" } });
  const response = await loadHandler("create-admin", db)(event({ email: "admin@example.com", password: "test-only-long-password" }));
  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /profile synchronization failed/);
});

test("chat media signing denies unrelated users and grants a verified group member", async () => {
  for (const member of [false, true]) {
    const db = database(); let signed = false;
    db.from = table => query({ data: table === "direct_messages" ? { sender_id: "owner", thread_id: "thread", recipient_id: "recipient" } : (member ? { user_id: "actor" } : null) });
    db.storage = { from: () => ({ createSignedUrl: async () => { signed = true; return { data: { signedUrl: "https://example.test/media" } }; } }) };
    const response = await loadHandler("chat-media-sign", db)(event({ path: "direct-messages/owner/file.png" }));
    assert.equal(response.statusCode, member ? 200 : 403);
    assert.equal(signed, member);
  }
});

test("referencing another sender's storage path does not authorize signing", async () => {
  const db = database();
  const filters = [];
  db.from = () => query({ data: null }, filters);
  db.storage = { from: () => { throw new Error("Must not sign an unauthorized path"); } };
  const response = await loadHandler("chat-media-sign", db)(event({ path: "direct-messages/owner/file.png" }));
  assert.equal(response.statusCode, 403);
  assert.ok(filters.some(([method, column, value]) => method === "eq" && column === "sender_id" && value === "owner"));
});

test("moderation rejects inherited object names and reports missing content", async () => {
  assert.equal((await loadHandler("moderate-content", database())(event({ type: "constructor", action: "name", id: "x" }))).statusCode, 400);
  const db = database(); let reads = 0;
  db.from = () => query({ data: ++reads === 1 ? { role: "super", account_status: "active" } : null });
  assert.equal((await loadHandler("moderate-content", db)(event({ type: "posts", action: "publish", id: "x" }))).statusCode, 404);
});
