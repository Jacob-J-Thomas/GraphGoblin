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
const head='64a955887962f72287e532824be1b8cb32c5f055';
const tree='a6691516210eb25887cb92abdcbd8c7abe1a4bb3';
const base='35bb3fbdc724a82064d0d9e65b551608542c6b22';
const actualMain='a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
assert.deepEqual([git('rev-parse','HEAD'),git('rev-parse','HEAD^{tree}'),git('rev-parse','origin/main'),git('status','--porcelain=v1')],
  [head,tree,actualMain,'']);
git('merge-base','--is-ancestor',base,head);
const json=async (file)=>JSON.parse(await readFile(join(evidence,file),'utf8'));
const spec=await json('manifest-template.json');
const mapping=await json('ui-mapping-template.json');
const freeze=await json('../ui-207-phase2-freeze.json');
const previous=await json('../save-publish-237-review-correction-independent/corrected-binding-after.json');
assert.equal(freeze.head,head);
assert.equal(previous.head,base);
const changed=git('diff','--name-only','--diff-filter=ACMRT',base,head,'--','apps','packages','tooling').split(/\r?\n/).filter(Boolean);
const deleted=git('diff','--name-only','--diff-filter=D',base,head,'--','apps','packages','tooling');
assert.equal(deleted,'apps/web/src/editor/NodeConnections.tsx');
const frozen=Object.fromEntries(freeze.records.filter((record)=>!record.deleted).map(({path,sha256})=>[path,sha256]));
const sourcePaths=[...new Set([...Object.keys(previous.sourceReadback),...spec.requiredSources,...changed,
  ...Object.keys(frozen),...mapping.noticeSourcePaths])].sort();
const sourceHashes={};
for(const path of sourcePaths) {
  const expected=sha(gitRaw('show',head+':'+path));
  assert.equal(sha(await readFile(join(root,path))),expected,path);
  if(frozen[path]) assert.equal(expected,frozen[path],path+' exact phase 2 frozen source');
  if(previous.sourceReadback[path] && !changed.includes(path))
    assert.equal(expected,previous.sourceReadback[path],path+' unchanged inherited correction');
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
const artifactRoot='final-manifests';
await mkdir(join(evidence,artifactRoot));
const distDiff={}, requiredChanged=['dist/expression-references.js','dist/node-references.js'];
for(const dir of Object.keys(spec.trees)){
  const leaf=dir.replaceAll('/','_')+'.sha256';
  const files=await enumerate(join(root,dir));
  const oldListing=await readFile(join(evidence,'..','ui-207-phase1','manifests','candidate-build',leaf),'utf8');
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
Object.assign(spec,{frozen:true,head,tree,base,actualMain,builtSource:head,expectedBuildFiles:1227,bundle,bundleSha256:web[webEntry[0]],
  apiEntrySha256:newFiles['apps/api/dist']['./main.js']});
Object.assign(mapping,{frozen:true,head,bundle,sourceHashes:Object.fromEntries(mapping.noticeSourcePaths.map((path)=>[path,sourceHashes[path]]))});
const store=(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await store('final-manifest.json',spec);
await store(spec.mapping,mapping);
await store('final-artifact-delta.json',{head,tree,base,actualMain,deleted,distDiff});
console.log(JSON.stringify({head,tree,base,bundle,sources:sourcePaths.length,artifacts:1227,domain:distDiff['packages/domain/dist']},null,2));

