const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Blipmood Content Policy states all eight non-negotiable standards',()=>{
 const page=read('content-policy.html');
 for(const section of ['respect','authentic-participation','privacy','minors','identity','labels','law','integrity']){
  assert.match(page,new RegExp('id="'+section+'"'));
 }
 assert.match(page,/platform-wide policy/);
 assert.match(page,/private communities/);
 assert.match(page,/Report a safety concern/);
 assert.match(page,/child-protection authorities/);
 assert.match(page,/Terms of Service/);
});

test('policy is linked from terms, community home and composer',()=>{
 const terms=read('terms.html');
 const page=read('discussion.html');
 assert.match(terms,/href="content-policy.html"/);
 assert.match(page,/href="content-policy.html"/);
 assert.match(page,/id="forumThreadRulesAcknowledged" required/);
 assert.match(page,/id="forumThreadRulesPreview"/);
});

test('community owners and moderators have a usable rule editor',()=>{
 const page=read('discussion.html'),script=read('assets/js/community-forum.mjs');
 for(const id of ['forumRulesForm','forumRulesEditor','forumRulesError','forumThreadCommunity']){
  assert.match(page,new RegExp('id="'+id+'"'));
 }
 assert.match(page,/name="rules" rows="4" maxlength="1500"/);
 assert.match(script,/supabase\.rpc\("community_update_rules"/);
 assert.match(script,/ruleLines\(rules\)\.length>10/);
 assert.match(script,/communityRulesHtml\(community\.rules\)/);
 assert.match(script,/forumThreadRulesAcknowledged"\)\.checked/);
 assert.match(script,/updateThreadRulesPreview\(\)/);
 // Renderer uses escaping rather than HTML injection for member-authored policy text.
 assert.match(script,/lines\.map\(line=>"<li>"\+escape\(line\)/);
 const compiled=script.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,'')
   .replace(/^import\s+"[^"]+";\s*$/gm,'');
 assert.doesNotThrow(()=>new Function(compiled));
});

test('rule mutations are authorized and audited in Supabase',()=>{
 const sql=read('supabase/migrations/20261027144147_blipmood_community_rules.sql');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/community_rule_history_staff_read/);
 assert.match(sql,/community_rules_audit_trigger/);
 assert.match(sql,/EXISTS\(SELECT 1 FROM public\.community_members cm/);
 assert.match(sql,/cm\.role IN \('owner','moderator'\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.community_update_rules\(uuid,text\) FROM PUBLIC,anon/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.community_update_rules\(uuid,text\) TO authenticated/);
 assert.match(sql,/char_length\(v_rules\)>1500/);
});
