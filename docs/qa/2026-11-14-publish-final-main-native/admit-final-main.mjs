import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir,copyFile,realpath} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';

const [checkout,phase,head,tree,base]=process.argv.slice(2);
assert(['before','after'].includes(phase));
for(const id of [head,tree,base])assert.match(id,/^[a-f0-9]{40}$/);
assert.equal(process.version,'v22.23.4');
const repo=await realpath(checkout);
const git=(...args)=>execFileSync('git',args,{cwd:repo,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const text=(...args)=>git(...args).toString().trim();
assert.deepEqual(text('rev-parse','HEAD','HEAD^{tree}','origin/main').split(/\r?\n/),[head,tree,base]);
assert.equal(text('status','--porcelain=v1'),'');
const history='../save-publish-237-review-correction-independent';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const pending=await json('source-preparation.json');
assert.equal(base,pending.base);
git('merge-base','--is-ancestor',pending.head,head);
git('merge-base','--is-ancestor',base,head);
const metadataDiff=text('diff','--name-only',pending.head,head).split(/\r?\n/).filter(Boolean);
assert(metadataDiff.every(path=>/^docs\/(?:qa|delivery)\//.test(path)),'Re-admit any new non-evidence diff');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources={};
for(const [path,digest] of Object.entries(pending.sourceReadback)){
  const working=await readFile(join(repo,path));
  assert(working.equals(git('show',head+':'+path)),path+' working versus Git');
  assert.equal(sha(working),digest,path+' approved source continuity');
  sources[path]=digest;
}
const oldSpec=await json(history+'/corrected-manifest.json');
const oldBinding=await readFile(history+'/corrected-binding-before.json');
assert.equal(sha(oldBinding),'68841d9228363c3ec4a915692a1956cd6ab1dd8a825f818a5fd7e404af90257b');
const old=JSON.parse(oldBinding);
assert.equal(old.head,pending.originalRuntime);
const spec=await json('inactive-manifest.json');
const mapping=await json('inactive-ui-mapping.json');
const emit=(file,data)=>writeFile(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
function listing(text){
  return new Map(text.trim().split(/\r?\n/).filter(s=>s&&!s.startsWith('#')).map(line=>{
    const parsed=/^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/.exec(line);
    assert(parsed,'Invalid listing line '+line);
    return [parsed[2],parsed[1]];
  }));
}
async function readTree(root,folder,result){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name);
    assert(!entry.isSymbolicLink(),'Artifact archive link '+path);
    if(entry.isDirectory())await readTree(root,path,result);
    else{
      assert(entry.isFile(),path);
      result.set(relative(root,path).replaceAll('\\','/'),sha(await readFile(path)));
    }
  }
}
const files={};
const deltas={};
const trees={};
for(const [treePath,listingPath] of Object.entries(spec.trees)){
  const previous=await readFile(join(history,oldSpec.trees[treePath]));
  assert.equal(sha(previous),old.trees[treePath].listingSha256,treePath+' historical manifest');
  const prior=listing(previous.toString('utf8'));
  const found=new Map();
  await readTree(join(repo,treePath),join(repo,treePath),found);
  const keys=[...found.keys()].sort();
  const bytes=keys.map(path=>found.get(path)+' *'+path).join('\n')+'\n';
  const detail={files:found.size,listingSha256:sha(bytes)};
  const state={added:keys.filter(path=>!prior.has(path)),removed:[...prior.keys()].filter(path=>!found.has(path)),
    changed:keys.filter(path=>prior.has(path)&&prior.get(path)!==found.get(path))};
  for(const [path,hash] of found)files[treePath+'/'+path]=hash;
  deltas[treePath]=state;
  trees[treePath]=detail;
  if(phase==='before')assert(!Object.values(state).some(v=>v.length),treePath+' old compile path and bytes');
  else{
    await mkdir(dirname(listingPath),{recursive:true});
    await writeFile(listingPath,bytes,{flag:'wx'});
  }
}
assert.equal(Object.keys(trees).length,13);
const total=Object.keys(files).length;
if(phase==='before'){
  assert.equal(total,1227);
  await emit('pre-overwrite-35bb-proof.json',{head,tree,base,sourceBuilt:pending.originalRuntime,artifactFiles:total,trees,
    previousReportSha256:sha(oldBinding)});
  await emit('exact-source-admission.json',{head,tree,base,parents:pending.parents,metadataDiff,sources,
    sourceReadbackCount:Object.keys(sources).length});
  await writeFile(spec.source,Object.entries(sources).map(([f,h])=>h+' *'+f).join('\n')+'\n',{flag:'wx'});
  console.log('Frozen source and retained compile sets verified:',Object.keys(sources).length,total);
} else {
  const before=await json('exact-source-admission.json');
  assert.deepEqual([before.head,before.tree,before.base,before.sources],[head,tree,base,sources]);
  const build=await json('forced-build-exit.json');
  assert.deepEqual([build.head,build.tree,build.base,build.node,build.exitCode],[head,tree,base,process.version,0]);
  const log=await readFile('forced-build.log');
  assert.equal(sha(log),build.logSha256);
  assert(/12 successful, 12 total/.test(log.toString())&&/0 cached, 12 total/.test(log.toString()));
  const candidates=Object.keys(files).filter(file=>/^apps\/web\/dist\/assets\/index-[\w-]+\.js$/.test(file));
  assert.equal(candidates.length,1);
  const entry=candidates[0],bundle='/app/'+entry.slice('apps/web/dist/'.length);
  assert.notEqual(bundle,old.bundle,'Merged production bundle changed');
  assert(deltas['packages/domain/dist'].changed.includes('expression-references.js'),'Compiled parent reference scanner changed');
  const map=JSON.parse(await readFile(join(repo,entry+'.map'),'utf8'));
  const web={};
  for(const sourceFile of mapping.noticeSourcePaths){
    const leaf=sourceFile.replace(/^apps\/web\/src\//,'');
    const i=map.sources.findIndex(path=>path.endsWith('/'+leaf));
    assert(i>=0,sourceFile+' in actual bundle source map');
    const digest=sha(map.sourcesContent[i]);
    assert.equal(digest,sources[sourceFile],sourceFile+' exact embedded bytes');
    web[sourceFile]=digest;
  }
  const manifest={...spec,frozen:true,head,tree,base,builtSource:head,stackBase:base,bundle,bundleSha256:files[entry],
    apiEntrySha256:files['apps/api/dist/main.js'],expectedBuildFiles:total};
  const mapIdentity={...mapping,frozen:true,head,bundle,sourceHashes:web};
  const report={head,tree,base,bundle,bundleSha256:files[entry],mapSha256:files[entry+'.map'],
    apiEntrySha256:manifest.apiEntrySha256,domainScannerSha256:files['packages/domain/dist/expression-references.js'],
    embedded:web,artifactFiles:total,trees,deltas};
  await emit('final-manifest.json',manifest);
  await emit('final-ui-mapping.json',mapIdentity);
  await emit('captured-build-delta.json',report);
  console.log(JSON.stringify({head,tree,base,bundle,embeddedPaths:Object.keys(web).length,artifactFiles:total},null,2));
}
