import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';

const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out = path.join(batch, 'audit-484-astra-scan2');
const head = '08651317c485062eb90367e1df3f7632f8e1a6c7';
const base = '15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd';
const source = '420240cad27d3865988dc7009dc9d80291e93c9c';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = f => fs.readFileSync(f);
const git = (...args) => cp.execFileSync('git', args, {cwd:repo,maxBuffer:64*1024*1024});
const text = b => b.toString('utf8').replace(/^\uFEFF/,'');
const json = f => JSON.parse(text(read(f)));
const lines = b => text(b).split(/\r?\n/).filter(Boolean);
const files = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const rel = (a,b) => path.relative(a,b).replaceAll('\\','/');
const failures = [];
function check(ok, description) {if (!ok) failures.push(description);}
function identity() {
  const index = text(git('rev-parse','--path-format=absolute','--git-path','index')).trim();
  return {head:text(git('rev-parse','HEAD')).trim(),tree:text(git('rev-parse','HEAD^{tree}')).trim(),status:lines(git('status','--porcelain=v2')),mergeBase:text(git('merge-base','HEAD',base)).trim(),indexSHA256:sha(read(index))};
}
const before = identity();
check(before.head===head && before.mergeBase===base && before.status.length===0,'checkout identity/cleanliness');
const changed = lines(git('diff','--name-only',base,head));
const sourcePaths = lines(git('diff','--name-only',base,source));
const sourceRecords = sourcePaths.map(p => {const bytes=read(path.join(repo,p)); const b=git('show',`${head}:${p}`); check(bytes.equals(b),`source bytes ${p}`);check(b.equals(git('show',`${source}:${p}`)),`source commit identity ${p}`);return {path:p,bytes:bytes.length,sha256:sha(bytes),blob:text(git('rev-parse',`${head}:${p}`)).trim()};});
const sourceManifest = new Map(lines(read(path.join(repo,'docs/qa/2026-11-15-poll-dedupe-corrected/source-freeze/final-source-SHA256SUMS'))).map(l=>{const m=/^([a-f\d]{64})\s+(.+)$/.exec(l);return [m[2],m[1]];}));
for (const r of sourceRecords) check(sourceManifest.get(r.path)===r.sha256,`source manifest ${r.path}`);
const packets = ['2026-11-15-poll-dedupe-baseline','2026-11-15-poll-dedupe-implementation','2026-11-15-poll-dedupe-corrected','2026-11-15-space-cards-completion','2026-11-15-space-cards-corrected-ci'].map(name=>({name,dir:path.join(repo,'docs/qa',name),committed:true}));
packets.push({name:'2026-11-15-poll-dedupe-current-ci',dir:path.join(batch,'proposed/docs/qa/2026-11-15-poll-dedupe-current-ci'),committed:false});
const packetResults=[];
for (const packet of packets) {
  const actual=files(packet.dir).map(p=>rel(packet.dir,p)).sort();
  const inventory=lines(read(path.join(packet.dir,'SHA256SUMS'))).map(l=>{const m=/^([a-f\d]{64})\s+(.+)$/.exec(l);if(!m)throw new Error(`Malformed inventory ${l}`);return {path:m[2],sha256:m[1]};});
  check(new Set(inventory.map(e=>e.path)).size===inventory.length,`unique inventory ${packet.name}`);
  check(JSON.stringify(actual.filter(p=>p!=='SHA256SUMS'))===JSON.stringify(inventory.map(e=>e.path).sort()),`inventory coverage ${packet.name}`);
  const records=[];
  for(const p of actual){const bytes=read(path.join(packet.dir,p));const hash=sha(bytes);const listed=inventory.find(e=>e.path===p);if(listed)check(hash===listed.sha256,`hash ${packet.name}/${p}`);let blob;
    if(packet.committed){const gitPath=`docs/qa/${packet.name}/${p}`;const committed=git('show',`${head}:${gitPath}`);check(bytes.equals(committed),`committed bytes ${gitPath}`);blob=text(git('rev-parse',`${head}:${gitPath}`)).trim();check(changed.includes(gitPath),`new inventory member ${gitPath}`);}
    records.push({path:p,bytes:bytes.length,sha256:hash,...(blob?{blob}:{})});}
  const copyMapPath=path.join(packet.dir,'source-copy-map.json'); const copyRecords=[];
  if(fs.existsSync(copyMapPath)){
    const map=json(copyMapPath);
    function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value)visit(x);return;}
      const dest=value.destination??value.destinationRelative;
      if(dest && value.sha256){const f=path.resolve(packet.dir,dest);check(fs.existsSync(f),`map destination ${packet.name}/${dest}`);if(fs.existsSync(f)){const b=read(f);check(sha(b)===value.sha256,`map hash ${packet.name}/${dest}`);check(value.bytes===undefined||b.length===value.bytes,`map bytes ${packet.name}/${dest}`);}
        const src=value.source??(value.sourceRelativePath?path.join(batch,value.sourceRelativePath):undefined);let sourceStatus='not-provided';if(src){if(fs.existsSync(src)){const b=read(src);check(sha(b)===value.sha256,`external source ${src}`);sourceStatus='matches';}else sourceStatus='path-unavailable';}copyRecords.push({destination:dest,source:src,sourceStatus});}
      for(const x of Object.values(value))visit(x);
    }visit(map);
  }
  packetResults.push({name:packet.name,committed:packet.committed,files:actual.length,manifestEntries:inventory.length,totalBytes:records.reduce((a,r)=>a+r.bytes,0),sourceMapEntries:copyRecords.length,sourceMapStatuses:copyRecords.reduce((a,r)=>(a[r.sourceStatus]=(a[r.sourceStatus]??0)+1,a),{}),copyRecords,records});
}
const publication=text(git('diff','--name-only',source,head,'--','.',':!docs/qa',':!docs/delivery'));
check(publication==='', 'evidence-only second commit');
check(sourceRecords.length===12 && changed.length===343,'scope counts');
const reportFile=path.join(batch,'review-484-opus-scan1/full-report.md');
const claudeReportSHA256=sha(read(reportFile));check(claudeReportSHA256==='8804954db1e294f68493fe0a16f40e7a9ac7f9f73afbebd5b7e8535c9ca53b55','Claude report hash');
const after=identity();check(JSON.stringify(before)===JSON.stringify(after),'source/index untouched');
const result={at:new Date().toISOString(),runtime:process.version,before,after,changedPaths:changed,sourceRecords,claudeReportSHA256,packetResults,failures};
fs.writeFileSync(path.join(out,'independent-integrity.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runtime:process.version,before,after,changedPaths:changed.length,sourcePaths:sourceRecords.length,claudeReportSHA256,packets:packetResults.map(({records,copyRecords,...x})=>x),failures},null,2));
process.exitCode=failures.length?1:0;
