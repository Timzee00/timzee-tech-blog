const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/migrations/20261024105200_tier_based_chat_edit_windows.sql","utf8");
const ui=fs.readFileSync("assets/js/chat-context-menu.js","utf8");
test("trusted active verified tiers control editing duration",()=>{
 assert.match(sql,/private\.chat_message_edit_window\(p_sender uuid\)/);
 assert.match(sql,/p\.is_verified IS TRUE/);
 assert.match(sql,/verification_expires_at IS NULL OR p\.verification_expires_at > now\(\)/);
 assert.match(sql,/IN \('platinum','business'\)/);
 assert.match(sql,/interval '72 hours'/);
 assert.match(sql,/IN \('silver','gold'\)/);
 assert.match(sql,/interval '24 hours'/);
 assert.match(sql,/interval '15 minutes'/);
});
test("UI availability and mutation use the same server-side window",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.can_edit_chat_message/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.edit_chat_message/);
 assert.equal((sql.match(/private\.chat_message_edit_window\(/g)||[]).length,3);
 assert.match(sql,/sender_id=\(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/v_row\.sender_id IS DISTINCT FROM v_actor/);
 assert.match(sql,/v_row\.body IS DISTINCT FROM p_expected_body/);
 assert.match(sql,/deleted_at IS NOT NULL/);
 assert.match(ui,/can_edit_chat_message/);
});
