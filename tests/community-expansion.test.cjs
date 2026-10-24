const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const file=p=>fs.readFileSync(path.join(root,p),"utf8");
const stripImports=source=>source
 .replace(/^\s*import[\s\S]*?\sfrom\s+"[^"]+";\s*$/gm,"")
 .replace(/^\s*import\s+"[^"]+";\s*$/gm,"")
 .replace(/^\s*export\s+(?=(?:function|const|async)\b)/gm,"");

test("new My Tech and community scripts parse and required controls exist",()=>{
 for(const name of ["assets/js/community-forum.mjs","assets/js/community-markdown.mjs","assets/js/my-tech.mjs"]){
   assert.doesNotThrow(()=>new Function(stripImports(file(name))),name);
 }
 const forum=file("assets/js/community-forum.mjs");
 const html=file("discussion.html");
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
 const requested=[...forum.matchAll(/\$\("([^"]+)"\)/g)].map(match=>match[1]);
 assert.deepEqual(requested.filter(id=>!ids.has(id)&&id!=="forumPostingPolicy"),[]);
 assert.match(file("my-tech.html"),/assets\/js\/my-tech\.mjs/);
});
test("RLS private memberships and moderation review are enforced in SQL",()=>{
 const privacy=file("supabase/migrations/20261017020000_private_community_access.sql");
 const fixes=file("supabase/migrations/20261017024000_personal_community_feed.sql");
 const banned=file("supabase/migrations/20261017028000_private_forum_ban_revocation.sql");
 assert.match(privacy,/community_can_read/);
 assert.match(privacy,/community_join_requests/);
 assert.match(privacy,/community_review_join/);
 assert.match(privacy,/DROP POLICY IF EXISTS community_threads_read/);
 assert.match(fixes,/p_actor IS NOT DISTINCT FROM auth\.uid\(\)/);
 assert.match(banned,/community_ban_revokes_membership/);
});
test("polls are server timed with one vote and private unread results",()=>{
 const sql=file("supabase/migrations/20261017021000_community_native_polls.sql");
 assert.match(sql,/PRIMARY KEY\(poll_id,user_id\)/);
 assert.match(sql,/community_vote_poll/);
 assert.match(sql,/community_poll_summary/);
 assert.match(sql,/p_ends_at IS NOT NULL/);
 assert.match(sql,/results_visible/);
 const ui=file("assets/js/community-forum.mjs");
 assert.match(ui,/renderCommunityPoll/);
 assert.match(ui,/attachPollToThread/);
 assert.match(ui,/community_vote_poll/);
});
test("private forum images never depend on public buckets",()=>{
 const sql=file("supabase/migrations/20261017026000_private_community_media.sql");
 const signer=file("netlify/functions/forum-media-sign.js");
 const ui=file("assets/js/community-forum.mjs");
 assert.match(sql,/forum-private-media/);
 assert.match(sql,/public=false/);
 assert.match(sql,/community_media_owner_guard/);
 assert.match(sql,/forum_reply_media_guard/);
 assert.match(signer,/db\.auth\.getUser\(token\)/);
 assert.match(signer,/community_members/);
 assert.match(signer,/createSignedUrl\(path,TTL\)/);
 assert.match(ui,/hydratePrivateForumMedia/);
 assert.match(ui,/forum-private-media/);
 assert.doesNotThrow(()=>new Function(signer));
});
test("automoderation quarantines rather than automatically deleting borderline posts",()=>{
 const sql=file("supabase/migrations/20261017023000_forum_auto_moderation.sql");
 assert.match(sql,/Multiple external links/);
 assert.match(sql,/Repeated identical content/);
 assert.match(sql,/status='pending'/);
 assert.match(sql,/community_review_content/);
 assert.match(sql,/community_pending_content/);
 assert.match(file("supabase/migrations/20261017025000_forum_automod_notifications_galleries.sql"),/new\.moderation_status IS DISTINCT FROM 'published'/);
});
test("My Tech ranks explicit interests and the article brief does not expose drafts",()=>{
 const rec=file("supabase/migrations/20261017024000_personal_community_feed.sql");
 const brief=file("supabase/migrations/20261017031500_my_tech_five_story_brief.sql");
 // The later SECURITY DEFINER migration fixes draft/null-status exposure.
 const guarded=file("supabase/migrations/20261023111914_restrict_my_tech_brief_to_explicit_published_articles.sql");
 assert.match(rec,/community_user_interests/);
 assert.match(rec,/community_feed_feedback/);
 assert.match(rec,/diversity_position/);
 assert.match(rec,/least\(greatest\(coalesce\(p_limit,20\),1\),20\)/);
 assert.match(brief,/CREATE OR REPLACE FUNCTION public\.my_tech_brief/);
 assert.match(guarded,/WHERE p\.status='published'/);
 assert.doesNotMatch(guarded,/coalesce\(lower\(p\.status\),'published'\)='published'/);
 assert.match(guarded,/AND \(p\.publish_at IS NULL OR p\.publish_at<=timezone\('utc',now\(\)\)\)/);
 assert.match(guarded,/LIMIT least\(greatest\(coalesce\(p_limit,5\),1\),5\)/);
 assert.match(brief,/LIMIT least\(greatest\(coalesce\(p_limit,5\),1\),5\)/);
});
test("verification documents are private and cannot be self-approved",()=>{
 const sql=file("supabase/migrations/20261017029000_verification_private_proofs.sql");
 const html=file("verify.html");
 assert.match(sql,/verification-proofs/);
 assert.match(sql,/new\.status='pending'/);
 assert.match(sql,/jsonb_array_length\(new\.documents\)>5/);
 assert.match(html,/verificationType:state\.selectedLevel/);
 assert.match(html,/supabase\.storage\.from\("verification-proofs"\)\.upload/);
 assert.doesNotMatch(html,/readAsDataURL\(doc\)/);
});

test("per-reply voting hides member identities and counts only permitted content",()=>{
 const sql=file("supabase/migrations/20261017032000_forum_private_comment_votes.sql");
 const ui=file("assets/js/community-forum.mjs");
 assert.match(sql,/DROP POLICY IF EXISTS "Anyone can read vote scores"/);
 assert.match(sql,/forum_reply_vote_summary/);
 assert.match(sql,/forum_cast_reply_vote/);
 assert.match(sql,/community_can_read/);
 assert.match(ui,/data-vote-reply/);
 assert.match(ui,/voteCommunityReply/);
});
test("custom flairs cannot spoof official site and company status",()=>{
 const sql=file("supabase/migrations/20261017034000_forum_flair_impersonation.sql");
 const html=file("discussion.html");
 assert.match(sql,/community_flair_no_impersonation/);
 assert.match(html,/name="flair"/);
});
