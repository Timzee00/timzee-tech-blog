const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const teamFix = read("supabase/migrations/20261103052612_fix_shared_team_immutable_trigger_record_fields.sql");
const restrictions = read("supabase/migrations/20261103051817_enable_audited_staff_account_restrictions.sql");
const revokeAnon = read("supabase/migrations/20261103051917_restrict_account_can_perform_rpc_to_authenticated_only.sql");
const chatPreview = read("supabase/migrations/20261103052153_install_rls_safe_batched_chat_previews.sql");

test("workspace and team project updates use separate PostgreSQL record-field branches", () => {
  assert.match(teamFix, /IF TG_TABLE_NAME = 'team_workspaces' THEN\s+IF OLD\.owner_id/i);
  assert.match(teamFix, /ELSIF TG_TABLE_NAME = 'team_studio_projects' THEN\s+IF OLD\.workspace_id/i);
  assert.doesNotMatch(teamFix, /TG_TABLE_NAME\s*=\s*'team_workspaces'\s+AND\s+OLD\./i);
  assert.doesNotMatch(teamFix, /TG_TABLE_NAME\s*=\s*'team_studio_projects'\s+AND\s+OLD\./i);
  assert.match(teamFix, /NEW\.updated_at\s*=\s*now\(\)/);
  assert.match(teamFix, /Unexpected workspace trigger table/);
  assert.doesNotMatch(teamFix, /SECURITY DEFINER/i);
});

test("super-admin user fallback references the actual profiles status column", () => {
  const html = read("super/professional-panel.html");
  assert.match(html, /\.from\("profiles"\)\s*\.select\("id, display_name, username, role, account_status, created_at"\)/);
  assert.match(html, /Status: \$\{escapeHTML\(user\.account_status \|\| "active"\)\}/);
  assert.doesNotMatch(html, /\.select\("id, display_name, username, role, status, created_at"\)/);
});

test("account restriction schema cannot grant browser users restriction write privileges", () => {
  assert.match(restrictions, /CREATE TABLE IF NOT EXISTS public\.account_restrictions/);
  assert.match(restrictions, /ALTER TABLE public\.account_restrictions ENABLE ROW LEVEL SECURITY/);
  assert.match(restrictions, /REVOKE ALL ON public\.account_restrictions FROM PUBLIC,anon,authenticated/);
  assert.match(restrictions, /GRANT SELECT ON public\.account_restrictions TO authenticated/);
  assert.doesNotMatch(restrictions, /GRANT (?:INSERT|UPDATE|DELETE).*public\.account_restrictions TO authenticated/i);
  assert.match(restrictions, /users_read_own_restrictions/);
  assert.match(restrictions, /CREATE TABLE IF NOT EXISTS public\.account_restriction_appeals/);
  assert.match(restrictions, /appeals_create_own/);
});

test("restrictions cannot expand access by replacing INSERT allow policies", () => {
  const expected = ["posts","comments","video_comments","discussion_messages","videos","marketplace_items","direct_messages"];
  for (const table of expected) {
    assert.match(restrictions, new RegExp('CREATE POLICY "[^"]+" ON public\\.'+table+'\\s+AS RESTRICTIVE FOR INSERT TO authenticated'));
  }
  assert.match(restrictions, /r\.user_id=\(select auth\.uid\(\)\)/i);
  assert.match(restrictions, /r\.expires_at > now\(\)/i);
});

test("security-definer restriction checker is never publicly callable", () => {
  assert.match(restrictions, /REVOKE ALL ON FUNCTION public\.account_can_perform\(text\) FROM PUBLIC/);
  assert.match(revokeAnon, /REVOKE EXECUTE ON FUNCTION public\.account_can_perform\(text\) FROM PUBLIC,anon/);
  assert.match(revokeAnon, /GRANT EXECUTE ON FUNCTION public\.account_can_perform\(text\) TO authenticated/);
});

test("chat preview accelerator executes as the caller and preserves message RLS", () => {
  assert.match(chatPreview, /SECURITY INVOKER/i);
  assert.doesNotMatch(chatPreview, /SECURITY DEFINER/i);
  assert.match(chatPreview, /from public\.direct_messages/i);
  assert.match(chatPreview, /revoke all on function public\.get_direct_message_previews\(text\[\]\) from anon/i);
  assert.match(chatPreview, /grant execute on function public\.get_direct_message_previews\(text\[\]\) to authenticated/i);
  const chat = read("assets/js/chat-previews.mjs");
  assert.match(chat, /if \(!missingRpc\(response\.error\)\) throw response\.error;/);
  assert.match(chat, /const CONCURRENCY = 5;/);
});

test("restriction management authorizes every write on the server, not from client claims", () => {
  const endpoint = read("netlify/functions/manage-account-restrictions.js");
  assert.match(endpoint, /requireRole\(db,token,\["moderator","admin","super"\]/);
  assert.match(endpoint, /const canRestrict=guard\.role==="super"\|\|guard\.role==="admin"/);
  assert.match(endpoint, /if\(action!=="list" && !canRestrict\)return reply\(403/);
  assert.match(endpoint, /if\(userId===guard\.user\.id\)return reply\(403/);
  assert.match(endpoint, /\.from\("account_restrictions"\)/);
  const auth = read("netlify/functions/_lib/auth-role.js");
  assert.match(auth, /\.select\("role,account_status"\)/);
  assert.match(auth, /if \(profileResult\.error\) return \{ error:/);
});

test("optional feed refresh remains off unless explicitly enabled", () => {
  const f = read("netlify/functions/_lib/feed-refresh.cjs");
  assert.match(f, /env\.FEED_CANDIDATE_REFRESH_ENABLED !== "true"/);
  assert.match(f, /return \{ skipped: "disabled" \}/);
});

test("public topic-request creation never requires an admin-only SELECT policy", () => {
  const data = read("assets/js/data.js");
  const start = data.indexOf("export async function createContentRequest(payload)");
  const end = data.indexOf("\nexport ", start + 15);
  assert.ok(start >= 0);
  const code = data.slice(start, end > 0 ? end : undefined);
  assert.match(code, /\.from\("content_requests"\)\.insert\(payload\);/);
  assert.doesNotMatch(code, /\.select\(/);
  const app = read("assets/js/app.js");
  assert.match(app, /id: crypto\.randomUUID\(\),\s+user_id: state\.user\?\.id \|\| null/);
});
