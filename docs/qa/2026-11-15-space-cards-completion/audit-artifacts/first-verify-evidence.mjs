import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const out = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/, ''));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const failures = [];
const checked = (condition, info) => { if (!condition) failures.push(info); };
const summaries = [];
for (const name of ['2026-11-15-space-cards-corrected-native','2026-11-15-space-cards-queued-fit-correction-implementation','2026-11-15-space-cards-queued-fit-correction-evidence','2026-11-15-space-cards-final-native','2026-11-15-space-cards-current-ci']) {
  const dir = path.join(root, 'docs/qa', name);
  const manifestPath = ['SHA256SUMS','SHA256SUMS.txt'].map(n=>path.join(dir,n)).find(p=>fs.existsSync(p));
  let count = 0, bytes = 0;
  if (manifestPath) {
    for (const line of read(manifestPath).toString().trim().split(/\r?\n/)) {
      const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
      if (!match) { failures.push({ kind:'manifest-line', manifestPath, line }); continue; }
      const file = path.resolve(dir, match[2]);
      checked(file.startsWith(path.resolve(dir) + path.sep), {kind:'manifest-path',file});
      const data = read(file);
      checked(sha(data) === match[1].toLowerCase(), {kind:'manifest-hash',file,expected:match[1],actual:sha(data)});
      count++; bytes += data.length;
    }
  }
  summaries.push({kind:'manifest',name,path:manifestPath,count,bytes});
}
const native = path.join(root,'docs/qa/2026-11-15-space-cards-corrected-native');
const copies = json(path.join(native,'source-copy-map.json'));
for (const row of copies.sourceCopies) {
  const bytes = read(path.join(native,row.copy));
  checked(bytes.length === row.bytes && sha(bytes) === row.sha256, {kind:'copy-map',path:row.copy});
}
summaries.push({kind:'native-copy-map',count:copies.sourceCopies.length,bytes:copies.sourceCopies.reduce((a,b)=>a+b.bytes,0)});
const binding = json(path.join(native,'evidence/final-readback/read-only-after.json'));
for (const [p,meta] of Object.entries(binding.sources)) {
  const bytes=read(path.join(root,p));
  checked(sha(bytes) === meta.sha256 && bytes.length === meta.bytes, {kind:'native-current-source',path:p});
}
for (const [p,expected] of Object.entries(binding.artifacts)) {
  checked(sha(read(path.join(root,p))) === expected, {kind:'native-current-artifact',path:p});
}
const bundleMapPath = path.join(root,binding.bundle.replace('/app/','apps/web/dist/') + '.map');
const bundleMap = json(bundleMapPath);
for (const [p,expected] of Object.entries(binding.sourceMap)) {
  const index = bundleMap.sources.findIndex(s=>s.replaceAll('\\','/').endsWith(p.replace(/^apps\/web\//,'')));
  checked(index >= 0 && sha(Buffer.from(bundleMap.sourcesContent[index]??'')) === expected, {kind:'native-current-source-map',path:p,index});
}
const chain=json(path.join(native,'evidence/target-d1/final-source-map-dependency-readback.json'));
for(const row of chain.embedded) {
  const bytes=read(path.join(root,row.path));
  checked(sha(bytes) === row.sha256 && bytes.equals(Buffer.from(bundleMap.sourcesContent[row.index]??'')), {kind:'dependency-map',path:row.path});
}
summaries.push({kind:'native-current-binding',sources:Object.keys(binding.sources).length,artifacts:Object.keys(binding.artifacts).length,sourceMaps:Object.keys(binding.sourceMap).length,dependencyAndAppChain:chain.embedded.length,bundleMap:bundleMapPath});
const admission=json(path.join(out,'root-green-ci-admission.json'));
const ciDir=path.resolve(out,'../corrected-ci');
for(const row of admission.logs) {
  const p=path.join(ciDir,row.file); checked(sha(read(p))===row.sha256,{kind:'admission-ci-log',path:p});
}
const identity=json(path.join(out,'source-identity.json'));
for (const [name,base] of [['effective-full-scope.diff',admission.targetSha],['correction-delta.diff',identity.previousReviewed]]) {
  const bytes=execFileSync('git',['diff',base,admission.head,'--',...identity.files.map(f=>f.path)],{cwd:root,maxBuffer:10*1024*1024});
  const retained=read(path.join(out,name));
  fs.writeFileSync(path.join(out,'independent-'+name),bytes);
  checked(bytes.equals(retained),{kind:'independent-diff',name,expected:sha(retained),actual:sha(bytes)});
  summaries.push({kind:'independent-diff',name,bytes:bytes.length,sha256:sha(bytes),matches:bytes.equals(retained)});
}
const result={at:new Date().toISOString(),result:failures.length?'FAIL':'PASS',summaries,failures};
fs.writeFileSync(path.join(out,'evidence-integrity.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
