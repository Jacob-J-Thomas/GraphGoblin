import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const [checkout,logPath]=process.argv.slice(2);
const repo=await realpath(checkout);
const git=(...args)=>execFileSync('git',args,{cwd:repo,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const source=await json('exact-source-admission.json');
const spec=await json('final-manifest-awaiting-build.json');
const mapping=await json('final-ui-mapping-awaiting-build.json');
const policy=await json('activation-policy-awaiting-build.json');
const build=await json('forced-build-exit.json');
const retained=await json('pre-overwrite-164c-readback.json');
assert.equal(process.version,'v22.23.4');
assert.deepEqual([build.head,build.tree,build.base,build.exitCode,build.node],
  [source.head,source.tree,source.base,0,process.version]);
assert.equal(retained.files,1227);
assert.equal(retained.builtSource,'164c01a2e3a52bf0ef69a409e1a428b45817b1b8');
const log=await readFile(logPath);
assert.equal(digest(log),build.logSha256);
const logLines=log.toString('utf8');
assert(/12 successful, 12 total/.test(logLines),'All forced build tasks must pass');
assert(/0 cached, 12 total/.test(logLines),'All forced build tasks must execute');
const actual=git('rev-parse','HEAD','HEAD^{tree}','HEAD^','origin/main').toString().trim().split(/\r?\n/);
assert.deepEqual(actual,[source.head,source.tree,source.parent,source.base]);
assert.equal(git('status','--porcelain=v1').toString().trim(),'');
for(const [file,expected] of Object.entries(source.sourceHashes)){
  const working=await readFile(join(repo,file));
  assert.equal(digest(working),expected,'Binding source '+file);
}
const priorSpecPath=join(repo,'docs/qa/2026-11-14-node-reference-review-corrected-native/corrected-manifest.json');
const priorSpec=await json(priorSpecPath);
const old=await json('../node-reference-273-activation-supplement/corrected-binding-before.json');
const priorBundle='apps/web/dist/'+old.bundle.replace('/app/','');
const manifests={};
const diff={};
const allFiles={};
function entries(raw){
  const data=new Map();
  for(const line of raw.toString('utf8').split(/\r?\n/)){
    if(!line||line.startsWith('#'))continue;
    const m=/^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/.exec(line);
    assert(m,line);
    data.set(m[2],m[1]);
  }
  return data;
}
async function collect(root,folder,result) {
  for(const item of await readdir(folder,{withFileTypes:true})){
    const file=join(folder,item.name);
    assert(!item.isSymbolicLink(),'Compiled link '+file);
    if(item.isDirectory())await collect(root,file,result);
    else{
      assert(item.isFile(),file);
      result.set(relative(root,file).replaceAll('\\','/'),digest(await readFile(file)));
    }
  }
}
for(const [tree,listing] of Object.entries(spec.trees)){
  const dir=join(repo,tree);
  const current=new Map();
  await collect(dir,dir,current);
  const pathSet=[...current.keys()].sort();
  const data=pathSet.map(file=>current.get(file)+' *'+file).join('\n')+'\n';
  const priorBytes=await readFile(resolve(dirname(priorSpecPath),priorSpec.trees[tree]));
  assert.equal(digest(priorBytes),old.trees[tree].listingSha256);
  const prior=entries(priorBytes);
  manifests[tree]={listing,files:pathSet.length,listingSha256:digest(data)};
  diff[tree]={added:pathSet.filter(p=>!prior.has(p)),removed:[...prior.keys()].filter(p=>!current.has(p)),
    changed:pathSet.filter(p=>prior.has(p)&&prior.get(p)!==current.get(p))};
  for(const [file,hash] of current)allFiles[tree+'/'+file]=hash;
  await mkdir(dirname(listing),{recursive:true});
  await writeFile(listing,data,{flag:'wx'});
}
assert.equal(Object.keys(manifests).length,13);
assert(diff['packages/domain/dist'].changed.includes('expression-references.js'),'Compiled A1 scanner must differ');
const web=Object.keys(allFiles).filter(file=>/^apps\/web\/dist\/assets\/index-[\w-]+\.js$/.test(file));
assert.equal(web.length,1);
assert.notEqual(web[0],priorBundle,'Candidate bundle must differ');
assert.notEqual(allFiles[web[0]],old.critical[priorBundle]);
const servedBundle='/app/'+web[0].slice('apps/web/dist/'.length);
const mapContent=JSON.parse(await readFile(join(repo,web[0]+'.map'),'utf8'));
const mapReadback={};
for(const sourceFile of mapping.noticeSourcePaths){
  const leaf=sourceFile.slice('apps/web/src/'.length);
  const i=mapContent.sources.findIndex(file=>file.endsWith('/'+leaf));
  assert(i>=0,'Missing exact mapped runtime '+sourceFile);
  const actual=digest(mapContent.sourcesContent[i]);
  assert.equal(actual,source.sourceHashes[sourceFile],sourceFile+' actual production bytes in bundle map');
  mapReadback[sourceFile]=actual;
}
const identity={head:source.head,tree:source.tree,base:source.base,builtSource:source.head,
  bundle:servedBundle,bundleSha256:allFiles[web[0]],bundleMapSha256:allFiles[web[0]+'.map'],
  apiEntrySha256:allFiles['apps/api/dist/main.js'],domainScannerSha256:allFiles['packages/domain/dist/expression-references.js'],
  artifactFiles:Object.values(manifests).reduce((sum,tree)=>sum+tree.files,0)};
const emit=(file,data)=>writeFile(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
await emit('build-artifact-delta.json',{...identity,mapReadback,manifests,diff});
await emit('final-ui-mapping.json',{...mapping,frozen:true,bundle:servedBundle});
await emit('activation-policy.json',{...policy,frozen:true,bundle:servedBundle});
await emit('final-manifest.json',{...spec,...identity,frozen:true,expectedBuildFiles:identity.artifactFiles});
console.log(JSON.stringify(identity,null,2));
