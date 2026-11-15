import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=await realpath(process.argv[2]);
const evidence=dirname(fileURLToPath(import.meta.url));
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const gitRaw=(...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const git=(...args)=>gitRaw(...args).toString().trim();
assert.equal(process.version,'v22.23.4');
const head='35bb3fbdc724a82064d0d9e65b551608542c6b22';
const tree='42bfce66017eb91f3fcd50ffdfb24876a47558f6';
const base='a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
const stackBase='164c01a2e3a52bf0ef69a409e1a428b45817b1b8';
assert.deepEqual([git('rev-parse','HEAD'),git('rev-parse','HEAD^{tree}'),git('rev-parse','origin/main'),git('status','--porcelain=v1')],
  [head,tree,base,'']);
git('merge-base','--is-ancestor',stackBase,head);
const json=async (file)=>JSON.parse(await readFile(join(evidence,file),'utf8'));
const spec=await json('corrected-manifest-template.json');
const mapping=await json('corrected-ui-mapping-template.json');
const observed=await json('corrected-ui-source-observation.json');
const original=await json('475-artifacts-after.json');
const changed=git('diff','--name-only',original.head,head,'--','apps','packages','tooling').split(/\r?\n/).filter(Boolean);
const stacked=git('diff','--name-only',stackBase,head,'--','apps','packages','tooling').split(/\r?\n/).filter(Boolean);
const sourcePaths=[...new Set([...Object.keys(original.sourceReadback),...spec.requiredSources,...changed,...stacked,...mapping.noticeSourcePaths])].sort();
const sourceHashes={};
const sourceMappingChanges={};
for(const path of sourcePaths) {
  const expected=sha(gitRaw('show',head+':'+path));
  assert.equal(sha(await readFile(join(root,path))),expected,path);
  const prior=observed.sourceHashes[path];
  if(prior && prior!==expected){
    assert.equal(path,'apps/web/src/forms/fields/json.tsx','Unexpected mapped source changed');
    assert.equal(expected,'18cd26440e3586a01355eef300fa0f7d348d155e537a0dc538dffe139d00128f');
    assert.equal(expected,sha(gitRaw('show',stackBase+':'+path)),path+' must match the reviewed parent');
    sourceMappingChanges[path]={prior,current:expected,source:stackBase,reason:'Parent held-input equality correction'};
  }
  sourceHashes[path]=expected;
}
const list=(object)=>Object.entries(object).map(([path,hash])=>hash+' *'+path).join('\n')+'\n';
await writeFile(join(evidence,spec.source),list(sourceHashes),{flag:'wx'});
const newFiles={};
async function enumerate(dir,basePath=dir){
  const result={};
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory()) Object.assign(result,await enumerate(path,basePath));
    else {assert(entry.isFile(),path);result['./'+relative(basePath,path).replaceAll('\\','/')]=sha(await readFile(path));}
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a<b?-1:a>b?1:0));
}
const artifactRoot='corrected-manifests';
await mkdir(join(evidence,artifactRoot));
const distDiff={}, requiredChanged=['dist/expression-references.js','dist/node-references.js'];
for(const dir of Object.keys(spec.trees)){
  const leaf=dir.replaceAll('/','_')+'.sha256';
  const files=await enumerate(join(root,dir));
  const oldListing=await readFile(join(evidence,'..','ui-237-uncertainty-correction','manifests','postbuild',leaf),'utf8');
  const old=Object.fromEntries(oldListing.trim().split(/\r?\n/).map((line)=>[line.slice(66),line.slice(0,64)]));
  const keys=Object.keys(files), all=[...new Set([...keys,...Object.keys(old)])];
  const diffs={count:keys.length,changed:all.filter((path)=>files[path]&&old[path]&&files[path]!==old[path]),
    added:all.filter((path)=>files[path]&&!old[path]),removed:all.filter((path)=>old[path]&&!files[path])};
  if(dir==='packages/domain/dist') for(const target of requiredChanged) assert(diffs.changed.includes('./'+target.split('/').at(-1)),target);
  distDiff[dir]=diffs;
  newFiles[dir]=files;
  spec.trees[dir]=artifactRoot+'/'+leaf;
  await writeFile(join(evidence,spec.trees[dir]),list(files),{flag:'wx'});
}
assert.equal(Object.values(distDiff).reduce((sum,{count})=>sum+count,0),1227);
const web=newFiles['apps/web/dist'];
const webEntry=Object.keys(web).filter((file)=>/^\.\/assets\/index-[\w-]+\.js$/.test(file));
assert.equal(webEntry.length,1);
const bundle='/app/'+webEntry[0].slice(2);
Object.assign(spec,{frozen:true,head,tree,base,stackBase,builtSource:head,bundle,bundleSha256:web[webEntry[0]],
  apiEntrySha256:newFiles['apps/api/dist']['./main.js']});
Object.assign(mapping,{frozen:true,head,bundle,sourceHashes:Object.fromEntries(mapping.noticeSourcePaths.map((path)=>[path,sourceHashes[path]]))});
const store=(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await store('corrected-manifest.json',spec);
await store(spec.mapping,mapping);
await store('corrected-artifact-delta.json',{head,tree,base,stackBase,distDiff});
await store('corrected-source-mapping-delta.json',{head,stackBase,changes:sourceMappingChanges});
console.log(JSON.stringify({head,tree,base,stackBase,bundle,sources:sourcePaths.length,artifacts:1227,domain:distDiff['packages/domain/dist']},null,2));

