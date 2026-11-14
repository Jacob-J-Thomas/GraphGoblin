import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const cwd='C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const git=(...args)=>execFileSync('git',args,{cwd,maxBuffer:4*1024*1024});
const head=process.argv[2]??git('rev-parse','HEAD').toString().trim();
if(!/^[a-f0-9]{40}$/.test(head))throw new Error('Require full head');
const hash=x=>createHash('sha256').update(x).digest('hex');
const manifestPath='docs/qa/2026-11-14-input-presence/u22-baseline-source-manifest.json';
const manifest=JSON.parse(git('show',head+':'+manifestPath));
const readmePath='docs/qa/2026-11-14-i08-u22-baseline/README.md';
const checks=manifest.filter(x=>x.path!==readmePath).map(x=>{
 const bytes=git('show',head+':'+x.path),sha256=hash(bytes);
 if(bytes.length!==x.bytes||sha256!==x.sha256)throw new Error('Raw U22 drift '+x.path);
 return {path:x.path,bytes:bytes.length,sha256,match:true};
});
if(checks.length!==30)throw new Error('Expected30rawentries');
const original=manifest.find(x=>x.path===readmePath);
const preservedPath='docs/qa/2026-11-14-input-presence/u22-baseline-raw/README.md.txt';
const preserved=git('show',head+':'+preservedPath);
if(hash(preserved)!==original.sha256||preserved.length!==original.bytes)throw new Error('HistoricalREADMEdrift');
const publication=git('show',head+':'+readmePath);
const result={head,historicalExecutionBaseline:'b3b5e1874a8252cc01c065d18fef42cbfbe075b4',verification:'Git committed byte preservation only; not re-execution of baseline scenarios',rawCount:checks.length,checks,originalReadme:{...original,preservedPath,preservedSha256:hash(preserved)},currentPublicationReadme:{path:readmePath,bytes:publication.length,sha256:hash(publication),matchesHistoricalRaw:hash(publication)===original.sha256},note:'The in-place README is a formatted/precision-corrected publication. Its expected difference from the historical raw manifest is explicit; raw JSON, JS, images and original README remain unchanged.'};
const output=join(batch,'review-235','u22-git-readback-'+head.slice(0,8)+'.json');
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head,rawCount:checks.length,originalReadmePreserved:true,publicationDiffers:!result.currentPublicationReadme.matchesHistoricalRaw,output}));

