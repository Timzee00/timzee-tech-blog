/* Timzee rebrand: read-only migration map and cutover safety check.
 * Never rename technical keys, database tables, function URLs or domains
 * while only changing the public-facing display brand. */
import {readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {join,relative,extname} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const config=JSON.parse(readFileSync(join(root,"config/brand.json"),"utf8"));
const allowed=new Set([".html",".js",".mjs",".cjs",".json",".css",".xml",".txt",".toml",".md"]);
const ignore=new Set([".git","node_modules","dist",".netlify","vendor","supabase","test-results","playwright-report"]);
const patterns=[
 ["legacy_brand",/Timzee Tech Hub/gi],
 ["legal_operator",/Timzee Corp/gi],
 ["legacy_host",/timzee-tech-blog\.netlify\.app/gi],
 ["technical_namespace",/timzee_[a-z0-9_]+/gi],
 ["power_by",/Powered by Timzee Corp/gi]
];
function scan(directory){
 const found={};
 for(const dirent of readdirSync(directory,{withFileTypes:true})){
  if(ignore.has(dirent.name))continue;
  const abs=join(directory,dirent.name);
  if(dirent.isDirectory()){Object.assign(found,scan(abs));continue;}
  if(!dirent.isFile()||!allowed.has(extname(dirent.name))||statSync(abs).size>2_000_000)continue;
  const path=relative(root,abs).replaceAll("\\","/");
  if(path.startsWith("docs/branding/")||path==="config/brand.json"||path==="scripts/audit-brand-transition.mjs")continue;
  const source=readFileSync(abs,"utf8");
  const counts={};
  for(const [name,pattern] of patterns){
   const matches=source.match(pattern);
   if(matches?.length)counts[name]=matches.length;
  }
  if(Object.keys(counts).length)found[path]=counts;
 }
 return found;
}
export function audit(){
 const issues=[];
 if(config.status!=="proposed_pending_clearance"&&config.allowPublicCutover!==true)
  issues.push("Unknown unapproved branding state.");
 if(config.newOrigin && !config.allowPublicCutover)
  issues.push("A new origin is set before public cutover approval.");
 if(config.allowPublicCutover===true && !config.newOrigin)
  issues.push("Cutover approved without a verified new origin.");
 const canonical="https://timzee-tech-blog.netlify.app";
 const auth=readFileSync(join(root,"assets/js/supabase.js"),"utf8");
 const sitemap=readFileSync(join(root,"netlify/functions/sitemap.js"),"utf8");
 const netlify=readFileSync(join(root,"netlify.toml"),"utf8");
 const checks=[
  ["legacy auth/site URL",auth.includes(canonical)],
  ["legacy sitemap host",sitemap.includes(canonical)],
  ["legacy Netlify function routes",netlify.includes('from = "/sitemap.xml"')],
  ["do not publicly cut over",config.allowPublicCutover===false],
  ["verified domain unset",config.newOrigin===null]
 ];
 if(config.status==="proposed_pending_clearance")
  for(const [name,ok] of checks)if(!ok)issues.push("Premature rebrand mutation: "+name);
 const matches=scan(root);
 const totals=Object.fromEntries(patterns.map(([name])=>[name,0]));
 for(const counts of Object.values(matches))
  for(const [name,count] of Object.entries(counts))totals[name]+=count;
 return{proposedName:config.name,stage:config.status,publicCutoverApproved:config.allowPublicCutover,
  legacyOrigin:config.legacyOrigin,filesWithBrandReferences:Object.keys(matches).length,
  totals,paths:matches,issues};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
 const result=audit();
 const human=process.argv.includes("--summary");
 if(human)console.log(JSON.stringify({...result,paths:undefined},null,2));
 else console.log(JSON.stringify(result,null,2));
 if(result.issues.length)process.exitCode=1;
}
