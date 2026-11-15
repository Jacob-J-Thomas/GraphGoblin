import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(process.argv[2]);
const output = process.argv[3];
const label = dirname(fileURLToPath(import.meta.url));
assert(/^(?:binding-before|binding-after)\.json$/.test(output));
const batch = dirname(label);
const rootProof = JSON.parse(await readFile(join(batch,'ui-237-integration-precommit-binding.json'),'utf8'));
const worker = join(batch,'ui-237-integration-correction');
const workerProof = JSON.parse(await readFile(join(worker,'native','binding-after.json'),'utf8'));
const head = '9e44bd74bfc40adcc872f8f8a3724c2e2840f378';
const tree = '2d2b60b9a1ef9f8d015fe3758204715c86ea3288';
const base = '7c6e635539e12c56b82f226f1ee734d83b985ad4';
const gitBytes = (...args) => execFileSync('git',args,{cwd:root,maxBuffer:48*1024*1024});
const git = (...args) => gitBytes(...args).toString('utf8').trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const status = git('status','--porcelain=v1');
assert.equal(status,'');
assert.equal(git('rev-parse','HEAD'),head);
assert.equal(git('rev-parse','HEAD^{tree}'),tree);
assert.equal(git('rev-parse','origin/main'),base);
assert.equal(git('show','-s','--format=%P',head),rootProof.head+' '+rootProof.mergeHead);
assert.deepEqual(git('diff',rootProof.head,head,'--name-only').split('\n').sort(),rootProof.expectedChangedFiles.toSorted());
assert.equal(process.version,'v22.23.4');
const sourceHashes = {};
for (const [file,expected] of Object.entries(rootProof.sourceHashes)) {
  sourceHashes[file] = hash(await readFile(join(root,file)));
  assert.equal(sourceHashes[file],expected,file);
  assert.equal(hash(gitBytes('show',head+':'+file)),expected,file);
}
for (const [file,expected] of Object.entries(rootProof.sourceBlobs)) {
  assert.equal(git('rev-parse',head+':'+file),expected,file);
}
assert.equal(Object.keys(sourceHashes).length,25);
const distTrees = [...new Set(Object.keys(workerProof.built).map((path)=>path.split('/').slice(0,3).join('/')))].sort();
async function files(directory) {
  const out = [];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    assert(!entry.isSymbolicLink(),entry.name);
    if (entry.isDirectory()) out.push(...await files(join(directory,entry.name)));
    else { assert(entry.isFile(),entry.name); out.push(join(directory,entry.name)); }
  }
  return out;
}
const manifests = {};
let count = 0;
for (const dir of distTrees) {
  const bytes = await readFile(join(worker,'manifests','postbuild',dir.replaceAll('/','_')+'.sha256'));
  const listing = new Map(bytes.toString('utf8').trim().split(/\r?\n/).map((line)=>{
    const parts = /^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
    assert(parts,line);
    return [parts[2],parts[1]];
  }));
  const dist = join(root,dir);
  const observed = await files(dist);
  assert.equal(observed.length,listing.size,dir);
  for (const file of observed) {
    const leaf = relative(dist,file).replaceAll('\\','/');
    const actual = hash(await readFile(file));
    assert.equal(actual,listing.get(leaf),dir+'/'+leaf);
    assert.equal(actual,workerProof.built[dir+'/'+leaf],dir+'/'+leaf);
  }
  count += observed.length;
  manifests[dir] = { files:observed.length, sha256:hash(bytes) };
}
assert.equal(distTrees.length,13);
assert.equal(count,1227);
const usePublish = 'apps/web/src/editor/usePublish.ts';
const bundle = 'apps/web/dist/assets/index-DK8I-ydH.js';
assert.equal(workerProof.built[bundle],'34d23072a825f542b3b3d52922be37afe825b07715e9ab30debf282eefb801fc');
const map = JSON.parse(await readFile(join(root,bundle+'.map'),'utf8'));
const sourceIndex = map.sources.findIndex((file)=>file.endsWith('/editor/usePublish.ts'));
assert(sourceIndex >= 0);
assert.equal(hash(map.sourcesContent[sourceIndex]),sourceHashes[usePublish]);
const mapping = {id:'237-9e44-held-refusal-diagnostic-v1',sourceHashes:{
  [usePublish]:sourceHashes[usePublish],
  'apps/web/src/editor/EditorPage.tsx':sourceHashes['apps/web/src/editor/EditorPage.tsx'],
  'apps/web/src/editor/EditorToolbar.tsx':sourceHashes['apps/web/src/editor/EditorToolbar.tsx'],
}};
assert.equal(git('status','--porcelain=v1'),'');
await writeFile(join(label,'source-paths.json'),JSON.stringify(Object.keys(sourceHashes),null,2)+'\n');
await writeFile(join(label,output),JSON.stringify({
  head,tree,base,status,node:process.version,sourceHashes,mapping,manifests,builtFiles:count,
  bundle,bundleSha256:workerProof.built[bundle],apiEntrySha256:workerProof.built['apps/api/dist/main.js'],
},null,2)+'\n');
console.log('Verified 25 sources and 1227 files across 13 build trees.');
