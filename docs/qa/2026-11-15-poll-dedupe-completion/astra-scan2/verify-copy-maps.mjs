import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const repo='C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';const out=path.join(batch,'audit-484-astra-scan2');
const read=p=>fs.readFileSync(p);const json=p=>JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/,''));const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const names=['2026-11-15-poll-dedupe-baseline','2026-11-15-poll-dedupe-implementation','2026-11-15-poll-dedupe-corrected','2026-11-15-space-cards-completion','2026-11-15-poll-dedupe-current-ci'];const results=[];const failures=[];
for(const name of names){const root=name.endsWith('current-ci')?path.join(batch,'proposed/docs/qa',name):path.join(repo,'docs/qa',name);const map=json(path.join(root,'source-copy-map.json'));const entries=[];
function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const e of value)visit(e);return;}
const dest=value.destination??value.destinationRelative??(value.sha256&&value.path);const digest=value.sha256??value.copiedSha256;
if(dest&&digest){const bytes=read(path.resolve(root,dest));if(sha(bytes)!==digest)failures.push('destination digest '+name+'/'+dest);if(value.bytes!==undefined&&bytes.length!==value.bytes)failures.push('destination bytes '+name+'/'+dest);if(value.sourceSha256&&value.sourceSha256!==digest)failures.push('copied/source digest '+name+'/'+dest);
let original=value.source;if(value.sourceRelativePath)original=path.join(batch,value.sourceRelativePath);if(value.sourceRelative)original=path.join(name.endsWith('space-cards-completion')?path.join(batch,'review-208-space/final-audit-e123'):map.sourceRoot,value.sourceRelative);
let sourceStatus='non-file origin';if(original&&/^(?:[A-Za-z]:[\\/]|\/)/.test(original)){sourceStatus=fs.existsSync(original)?(sha(read(original))===digest?'matches':'DIFFERS'):'absent';if(sourceStatus==='DIFFERS')failures.push('source '+original);}
entries.push({destination:dest,sha256:digest,bytes:bytes.length,source:original,sourceStatus});}
for(const e of Object.values(value))visit(e);}
visit(map);results.push({name,count:entries.length,statuses:entries.reduce((a,r)=>(a[r.sourceStatus]=(a[r.sourceStatus]??0)+1,a),{}),entries});}
const result={at:new Date().toISOString(),results,failures};fs.writeFileSync(path.join(out,'independent-copy-maps.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({results:results.map(({entries,...x})=>x),failures},null,2));process.exitCode=failures.length?1:0;
