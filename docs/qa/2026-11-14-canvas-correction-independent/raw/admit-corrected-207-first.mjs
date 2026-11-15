import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
const [repo,phase]=process.argv.slice(2);
const head='bc9094fd426fe1c1a4b81b0e490e3887f977dbc7';
const tree='c8841e39d83bf292553d840de4bf3cadc6097824';
const parent='64a955887962f72287e532824be1b8cb32c5f055';
const stack='35bb3fbdc724a82064d0d9e65b551608542c6b22';
const base='a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
const git=(...a)=>execFileSync('git',a,{cwd:repo,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
assert.deepEqual(git('rev-parse','HEAD','HEAD^{tree}','HEAD^','origin/main').toString().trim().split(/\r?\n/),[head,tree,parent,base]);
assert.equal(git('status','--porcelain=v1').toString().trim(),'');
assert.equal(process.version,'v22.23.4');
const oldRoot='../canvas-207-final-independent';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const old=await json(oldRoot+'/corrected-binding-before.json');
const oldSpec=await json(oldRoot+'/final-manifest.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(f,o)=>writeFile(f,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
function listing(lines){
  return new Map(lines.trim().split(/\r?\n/).filter(Boolean).map(line=>{
    const match=/^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/.exec(line);
    assert(match,line);
    return [match[2],match[1]];
  }));
}
const approved=listing(await readFile('../ui-207-final-correction/changed-files.sha256','utf8'));
assert.equal(approved.size,18);
assert.deepEqual(git('diff','--name-only',parent,head).toString().trim().split(/\r?\n/).sort(),[...approved.keys()].sort());
const fields=['apps/web/src/editor/viewport-gesture.ts','apps/web/src/drafts/local-drafts.ts',
 'apps/web/e2e/fixtures.ts','apps/web/e2e/global-setup.ts','apps/web/e2e/server.ts',
 'apps/web/playwright.config.ts','apps/web/src/editor/decision-route-edges.ts','pnpm-lock.yaml'];
const paths=[...new Set([...Object.keys(old.sourceReadback),...approved.keys(),...fields])].sort();
const sources={};
for(const path of paths){
  const current=await readFile(join(repo,path));
  const frozen=git('show',head+':'+path);
  assert(current.equals(frozen),path+' source identity');
  const sha=digest(current);
  if(approved.has(path))assert.equal(sha,approved.get(path),path+' approved source');
  sources[path]=sha;
}
async function enumerate(root,folder,files){
  for(const item of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,item.name);
    assert(!item.isSymbolicLink(),path);
    if(item.isDirectory())await enumerate(root,path,files);
    else {
      assert(item.isFile(),path);
      files.set(relative(root,path).replaceAll('\\','/'),digest(await readFile(path)));
    }
  }
}
const all={};
const deltas={};
const treeSha={};
const files={};
for(const [d,oldList] of Object.entries(oldSpec.trees)){
  const dir=join(repo,d);
  const result=new Map();
  await enumerate(dir,dir,result);
  const priorRaw=await readFile(join(oldRoot,oldList));
  assert.equal(digest(priorRaw),old.trees[d].listingSha256,d+' retained artifact manifest identity');
  const prior=listing(priorRaw.toString('utf8'));
  for(const [f,h] of result)files[d+'/'+f]=h;
  const keys=[...result.keys()].sort();
  deltas[d]={changed:keys.filter(name=>prior.has(name)&&result.get(name)!==prior.get(name)),
    added:keys.filter(name=>!prior.has(name)),removed:[...prior.keys()].filter(name=>!result.has(name))};
  const data=keys.map(name=>result.get(name)+' *'+name).join('\n')+'\n';
  const dest='final-manifests/'+d.replaceAll('/','_')+'.sha256';
  all[d]=dest;
  treeSha[d]={fileCount:result.size,listingSha256:digest(data)};
  if(phase==='before') assert(!Object.values(deltas[d]).some(a=>a.length),d+' old file set');
  else {
    await mkdir(dirname(dest),{recursive:true});
    await writeFile(dest,data,{flag:'wx'});
  }
}
assert.equal(Object.keys(all).length,13);
const total=Object.keys(files).length;
if(phase==='before'){
  assert.equal(total,1227);
  await write('retained-64a-before-overwrite.json',{head,tree,parent,stack,base,builtSource:parent,files:total,treeSha,
    priorBindingSha256:digest(await readFile(oldRoot+'/corrected-binding-before.json'))});
  await write('exact-source-admission.json',{head,tree,parent,base,stack,sources,approved:approved.size});
  await writeFile('final-source-sha256.txt',Object.entries(sources).map(([f,h])=>h+' *'+f).join('\n')+'\n',{flag:'wx'});
  console.log('Verified',approved.size,'changed source blobs,',paths.length,'source files and retained',total,'artifact files');
}else{
  assert.equal(phase,'after');
  const before=await json('exact-source-admission.json');
  assert.deepEqual(before.sources,sources);
  const record=await json('forced-build-exit.json');
  assert.deepEqual([record.head,record.tree,record.base,record.node,record.exitCode],[head,tree,base,process.version,0]);
  const log=await readFile('forced-build.log');
  assert.equal(digest(log),record.logSha256);
  assert(/12 successful, 12 total/.test(log.toString())&&/0 cached, 12 total/.test(log.toString()));
  const main=Object.keys(files).filter(name=>/^apps\/web\/dist\/assets\/index-[\w-]+\.js$/.test(name));
  assert.equal(main.length,1);
  const bundle='/app/'+main[0].slice('apps/web/dist/'.length);
  assert.notEqual(bundle,old.bundle);
  const apiEntrySha256=files['apps/api/dist/main.js'];
  const mapPath=main[0]+'.map';
  const sourceMap=JSON.parse(await readFile(join(repo,mapPath),'utf8'));
  const mapPaths=[...new Set([...old.mapping.noticeSourcePaths,'apps/web/src/editor/viewport-gesture.ts'])];
  const embedded={};
  for(const path of mapPaths){
    const leaf=path.slice('apps/web/src/'.length);
    const i=sourceMap.sources.findIndex(f=>f.endsWith('/'+leaf));
    assert(i>=0,path);
    embedded[path]=digest(sourceMap.sourcesContent[i]);
    assert.equal(embedded[path],sources[path],path+' embedded native source');
  }
  assert(!sourceMap.sources.some(s=>s.endsWith('/NodeConnections.tsx')));
  const spec={...oldSpec,frozen:true,head,tree,base:stack,actualMain:base,builtSource:head,bundle,bundleSha256:files[main[0]],
    apiEntrySha256,expectedBuildFiles:total,source:'final-source-sha256.txt',mapping:'final-ui-mapping.json',
    requiredSources:[...new Set([...oldSpec.requiredSources,...fields])],trees:all};
  const map={...old.mapping,head,bundle,frozen:true,noticeSourcePaths:mapPaths,sourceHashes:embedded};
  const policy={frozen:true,head,bundle,removeName:'Remove connection',resetName:'Reset route',recoverySectionRole:'group',
    recoverySectionName:'Connections the canvas cannot draw',recoveryActionPrefix:'Remove edge ',
    gateSourcePaths:['apps/web/src/editor/viewport-gesture.ts','apps/web/src/editor/OrthogonalEdge.tsx'],
    recoverySourcePaths:['apps/web/src/editor/stranded-edges.ts','apps/web/src/editor/ValidationIndicator.tsx']};
  await write('final-manifest.json',spec);
  await write('final-ui-mapping.json',map);
  await write('policy.json',policy);
  const identity={head,tree,stack,base,bundle,bundleSha256:spec.bundleSha256,mapSha256:files[mapPath],apiEntrySha256,files:total,
    sourceFiles:paths.length,embedded,treeSha,deltas};
  await write('corrected-build-artifact-delta.json',identity);
  console.log(JSON.stringify({...identity,embedded:Object.keys(embedded).length,treeSha:undefined,deltas:undefined},null,2));
}
