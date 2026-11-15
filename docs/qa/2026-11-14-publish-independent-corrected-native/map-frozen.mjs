import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [root] = process.argv.slice(2);
const read = async (file)=>JSON.parse(await readFile(file,'utf8'));
const proof = await read('../ui-237-main-integration-binding.json');
const template = await read('manifest-template.json');
const mapping = await read('ui-mapping-template.json');
const worker = await read('../ui-237-uncertainty-correction/native/binding-after.json');
const gitBytes = (...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const git = (...args)=>gitBytes(...args).toString('utf8').trim();
const hash = (bytes)=>createHash('sha256').update(bytes).digest('hex');
assert.equal(git('rev-parse','HEAD'),proof.head);
assert.equal(git('rev-parse','HEAD^{tree}'),proof.tree);
assert.equal(git('rev-parse','origin/main'),proof.base);
assert.equal(git('status','--porcelain=v1'),'');
assert.equal(worker.builtManifestSha256,proof.builtManifestSha256);
assert.equal(worker.builtFiles,1227);
assert.equal(Object.keys(worker.manifests).length,13);
assert.equal(git('diff','--name-only',proof.sourceFreeze,proof.head).split('\n').length,173);
const sources = {};
for (const path of [...new Set([...Object.keys(proof.sourceHashes),...template.requiredSources,...mapping.noticeSourcePaths])].sort()) {
  sources[path] = hash(gitBytes('show',proof.head+':'+path));
  assert.equal(sources[path],hash(await readFile(join(root,path))),path);
  if (proof.sourceHashes[path]) assert.equal(sources[path],proof.sourceHashes[path],path);
  assert.equal(sources[path],hash(gitBytes('show',proof.sourceFreeze+':'+path)),path+' differs from built source');
}
const trees = Object.fromEntries(Object.keys(template.trees).map((tree)=>[tree,
  '../ui-237-uncertainty-correction/manifests/postbuild/'+tree.replaceAll('/','_')+'.sha256']));
const bundle = proof.bundle.replace('apps/web/dist/','/app/');
const changes = proof.documentationOnlyIntegrationPaths;
assert.deepEqual(git('diff','--name-only',proof.sourceFreeze,proof.head).split('\n'),changes);
const sourceMap = JSON.parse(await readFile(join(root,proof.bundle+'.map'),'utf8'));
for (const path of mapping.noticeSourcePaths.concat('apps/web/src/editor/useAutosave.ts','apps/web/src/editor/useLoadEditor.ts',
  'apps/web/src/editor/useResolveConflict.ts','apps/web/src/editor/store.ts','apps/web/src/api/queries.ts')) {
  const relative = path.replace('apps/web/src/','');
  const index = sourceMap.sources.findIndex((file)=>file.endsWith('/'+relative));
  assert(index>=0,path);
  assert.equal(hash(sourceMap.sourcesContent[index]),sources[path],path);
}
await writeFile('frozen-source-sha256.txt',Object.entries(sources).map(([path,sha])=>sha+' *'+path).join('\n')+'\n');
await writeFile('manifest-spec.json',JSON.stringify({...template,frozen:true,head:proof.head,tree:proof.tree,base:proof.base,
  builtSource:proof.sourceFreeze,allowedPostBuildPaths:changes,bundle,bundleSha256:proof.bundleSha256,
  apiEntrySha256:proof.builtApiEntry,trees},null,2)+'\n');
await writeFile('ui-mapping.json',JSON.stringify({...mapping,frozen:true,head:proof.head,bundle,
  sourceHashes:Object.fromEntries(mapping.noticeSourcePaths.map((path)=>[path,sources[path]]))},null,2)+'\n');
console.log('Mapped '+Object.keys(sources).length+' frozen paths, 12 embedded runtime sources and 13 build trees.');
