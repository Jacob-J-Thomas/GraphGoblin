// Read-only candidate admission. Never imports the API, starts a service, builds, or opens a browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [admissionPath, outputPath, comparisonPath] = process.argv.slice(2);
assert(admissionPath && outputPath, 'verify-reuse admission output [exact-prior-report]');
assert.equal(process.version, 'v22.23.4');
const admission = JSON.parse(await readFile(resolve(admissionPath),'utf8'));
assert(['offline-ready-awaiting-exclusive-slot','authorized'].includes(admission.status));
const boundBytes = await readFile(join(root,'binding','binding-before.json'));
const bound = JSON.parse(boundBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(boundBytes), admission.beforeBindingSha256);
const opts = {cwd:admission.checkout,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:128*1024*1024};
const git = (...args) => execFileSync('git',args,opts);
const text = (...args) => git(...args).toString('utf8').trim();
const identity = () => ({head:text('rev-parse','HEAD'),tree:text('rev-parse','HEAD^{tree}'),observedMain:text('rev-parse','origin/main'),status:text('status','--porcelain=v1','--untracked-files=all')});
const observed = identity();
assert.deepEqual(observed,{head:admission.head,tree:admission.tree,observedMain:admission.observedMain,status:''});
for (const key of ['head','tree','base','actualMain']) assert.equal(bound[key],admission[key]);
const sources = {};
for (const entry of git('ls-tree','-r','-z','HEAD').toString('utf8').split('\0').filter(Boolean)) {
  const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
  assert(match,'Non-blob tracked item: '+entry);
  const [,mode,gitBlob,path] = match;
  const bytes = await readFile(join(admission.checkout,path));
  const rawBlob = createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  assert.equal(rawBlob,gitBlob,'Working/Git byte mismatch '+path);
  sources[path] = {mode,gitBlob,sha256:sha(bytes),bytes:bytes.length};
}
for (const [path,expected] of Object.entries(bound.sourceReadback)) assert.equal(sources[path].sha256,expected,path);
const trees = {}, artifacts = {};
async function collect(dir,result) {
  for(const entry of await readdir(join(admission.checkout,dir),{withFileTypes:true})) {
    assert(!entry.isSymbolicLink(),dir+'/'+entry.name);
    const path=dir+'/'+entry.name;
    if(entry.isDirectory()) await collect(path,result);
    else {assert(entry.isFile(),path);result[path]=sha(await readFile(join(admission.checkout,path)));}
  }
}
for (const [dir,expected] of Object.entries(bound.trees)) {
  const hashes={}; await collect(dir,hashes);
  const listing=Object.keys(hashes).sort().map(path=>hashes[path]+' *'+path).join('\n')+'\n';
  assert.equal(listing,await readFile(join(root,'manifests',dir.replaceAll('/','_')+'.sha256'),'utf8'),dir);
  assert.deepEqual({files:Object.keys(hashes).length,listingSha256:sha(listing)},expected,dir);
  Object.assign(artifacts,hashes);trees[dir]=expected;
}
assert.equal(Object.keys(artifacts).length,1227);
assert.equal(Object.keys(trees).length,13);
const sourceMap={};
for (const path of Object.keys(artifacts).filter(path=>path.startsWith('apps/web/dist/') && path.endsWith('.js.map'))) {
  const map=JSON.parse(await readFile(join(admission.checkout,path),'utf8'));
  for(const [i,original] of map.sources.entries()) {
    const file=Object.keys(bound.mapping.sourceHashes).find(candidate=>original.replaceAll('\\','/').endsWith('/'+candidate.slice('apps/web/src/'.length)));
    if(file) {sourceMap[file]=sha(map.sourcesContent[i]);assert.equal(sourceMap[file],sources[file].sha256,file);}
  }
}
assert.deepEqual(sourceMap,bound.mapping.sourceHashes);
assert.equal(Object.keys(sourceMap).length,16);
assert.deepEqual(identity(),observed,'Git identity changed during admission');
const report={schema:'208-escalation-readonly-binding-v1',...observed,buildTimeMain:bound.actualMain,base:bound.base,
  originalBindingSha256:sha(boundBytes),node:process.version,bundle:bound.bundle,sources,sourceMap,trees,artifacts};
if(comparisonPath) assert.deepEqual(report,JSON.parse(await readFile(resolve(comparisonPath),'utf8')),'Before/after complete read-only binding differs');
await writeFile(resolve(outputPath),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head:observed.head,tree:observed.tree,observedMain:observed.observedMain,trackedFiles:Object.keys(sources).length,mapped:16,built:1227,trees:13,reportSha256:sha(JSON.stringify(report,null,2)+'\n')}));
