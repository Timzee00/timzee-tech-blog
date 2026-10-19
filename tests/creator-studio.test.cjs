const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=location=>readFileSync(path.join(root,location),"utf8");

function loadDraftHelpers(){
 const identity=read("assets/js/verified-identity.mjs").replace(/^export\s+/gm,"");
 const source=read("assets/js/creator-drafts.mjs")
  .replace(/^import[^\n]+\n/gm,"").replace(/^export\s+/gm,"");
 const ctx={};
 vm.runInNewContext(identity+"\n"+source+
  "\nthis.helpers={creatorDraftLimit,validateCreatorDraft,listCreatorDrafts,saveCreatorDraft,deleteCreatorDraft,DRAFT_KINDS};",ctx);
 return ctx.helpers;
}

test("draft levels come from verified server profile, not cosmetic claims",()=>{
 const {creatorDraftLimit}=loadDraftHelpers();
 assert.equal(creatorDraftLimit({is_verified:false,verification_tier:"platinum"}),5);
 assert.equal(creatorDraftLimit({is_verified:true,verification_tier:"silver"}),25);
 assert.equal(creatorDraftLimit({is_verified:true,verification_tier:"gold"}),100);
 assert.equal(creatorDraftLimit({is_verified:true,verification_tier:"platinum"}),250);
 assert.equal(creatorDraftLimit({is_verified:true,verification_tier:"business"}),100);
 assert.equal(creatorDraftLimit({is_verified:true,verification_tier:"gold",verification_expires_at:"2000-01-01T00:00:00Z"}),5);
});

test("creator drafts reject unsupported types, oversized text and invalid communities",()=>{
 const {validateCreatorDraft}=loadDraftHelpers();
 assert.equal(validateCreatorDraft({kind:"guide",title:"  Useful guide ",body:"## Intro"}).title,"Useful guide");
 assert.throws(()=>validateCreatorDraft({kind:"admin",title:"fake"}),/supported draft type/);
 assert.throws(()=>validateCreatorDraft({kind:"guide",title:"a".repeat(181)}),/180/);
 assert.throws(()=>validateCreatorDraft({kind:"question",body:"z".repeat(12001)}),/12,000/);
 assert.throws(()=>validateCreatorDraft({kind:"discussion",community_id:"bad-id"}),/valid community/);
});

test("draft SQL enforces owner-only RLS, server quotas, valid lengths and no anonymous reads",()=>{
 const sql=read("supabase/migrations/20261019012000_private_creator_drafts.sql");
 for(const requirement of [
  "ENABLE ROW LEVEL SECURITY","creator_drafts_select_owner","creator_drafts_insert_owner",
  "creator_drafts_update_owner","creator_drafts_delete_owner",
  "REVOKE ALL ON public.creator_drafts FROM PUBLIC,anon,authenticated",
  "NEW.user_id","v_limit","pg_advisory_xact_lock"
 ])assert.ok(sql.toLowerCase().includes(requirement.toLowerCase()),requirement);
 assert.match(sql,/char_length\(body\)<=12000/);
 assert.match(sql,/verification_expires_at/);
 assert.doesNotMatch(sql,/GRANT\s+.*\s+TO\s+anon/i);
});

test("creator studio sends only a draft ID to RLS-protected community editor",()=>{
 const app=read("assets/js/creator-studio.mjs");
 const forum=read("assets/js/community-forum.mjs");
 const page=read("creator-studio.html");
 assert.match(app,/listCreatorDrafts|refreshDrafts/);
 assert.match(app,/saveCreatorDraft|saveCurrent/);
 assert.match(app,/deleteCreatorDraft|deleteCurrent/);
 assert.match(app,/renderCommunityMarkdown/);
 assert.match(app,/discussion\.html\?draft=/);
 assert.doesNotMatch(app,/SERVICE_ROLE_KEY/);
 assert.match(forum,/\.from\("creator_drafts"\)/);
 assert.match(forum,/\.eq\("user_id",state\.user\.id\)/);
 assert.match(forum,/community\.value=""/);
 assert.match(forum,/await openCreatorDraft\(\)/);
 assert.match(forum,/showDialog\("forumThreadDialog"\)/);
 assert.match(page,/id="creatorSaveDraft"/);
 assert.match(page,/id="creatorDeleteDraft"/);
 assert.match(page,/id="creatorDraftPreview"/);
});

test("creator workspace stays discoverable and fits mobile viewports",()=>{
 const css=read("assets/css/creator-studio.css");
 const myTech=read("my-tech.html");
 const profile=read("assets/js/profile.js");
 assert.match(myTech,/href="creator-studio\.html"/);
 assert.match(profile,/href=\\"creator-studio\.html\\"|href="creator-studio\.html"/);
 assert.match(css,/max-width:100%/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/minmax\(0,1fr\)/);
});

test("pg_cron uses named low-frequency jobs and logs verification outcomes",()=>{
 const cron=read("supabase/migrations/20261019010000_free_postgres_maintenance_cron.sql");
 const log=read("supabase/migrations/20261019011000_verification_cron_job_observability.sql");
 assert.match(cron,/CREATE EXTENSION IF NOT EXISTS pg_cron/);
 assert.match(cron,/17 \* \* \* \*/);
 assert.match(log,/run_verification_maintenance_logged/);
 assert.match(log,/last_failed_at/);
 assert.match(log,/last_succeeded_at/);
 assert.doesNotMatch(cron,/service_role_key|http_post|https:\/\//i);
});
