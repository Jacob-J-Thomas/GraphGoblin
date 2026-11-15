import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout,name]=process.argv.slice(2);
assert(['corrected-binding-before.json','corrected-binding-after.json'].includes(name));
assert.equal(process.version,'v22.23.4');
const root=await realpath(checkout),evidence=dirname(fileURLToPath(import.meta.url));
const retained=join(evidence,'..','ui-207-phase1','manifests','candidate-build');
const recovery=join(evidence,'..','ui-207-handoff-recovery','logs');
const head='3effb992c5f367eb7cfc5c0b1d8c09b11b840f06';
const tree='c46fd4268e146f7e977324abe87dc33bd07c7082';
const parent='1dcee36b16cc4662e8acb691e9166aff52949ad9';
const base='a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
const gitRaw=(...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const git=(...args)=>gitRaw(...args).toString().trim();
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
assert.deepEqual([git('rev-parse','HEAD'),git('rev-parse','HEAD^{tree}'),git('rev-parse','HEAD^'),
  git('rev-parse','origin/main'),git('status','--porcelain=v1')],[head,tree,parent,base,'']);
const summary=await readFile(join(retained,'trees-summary.json'));
const expected=JSON.parse(summary).trees;
const proof=JSON.parse(await readFile(join(recovery,'06-restoration-verification.json')));
const products=Object.fromEntries(proof.products.map(({path,recorded})=>[path,recorded]));
const changed=git('diff','--name-only',parent,head,'--','apps','packages','tooling').split(/\r?\n/);
assert.equal(changed.length,14);
assert.deepEqual(changed.filter((file)=>!file.endsWith('.test.tsx')&&!file.endsWith('.test.ts')).sort(),Object.keys(products).sort());
const modal='apps/web/src/editor/NodeConnections.tsx';
const dialog='apps/web/src/editor/NodeEditorDialog.tsx';
const sourceMap={};
const sourceReadback={};
const critical={};
const trees={};
const paths=[...changed,modal,dialog,'apps/api/src/main.ts','apps/api/src/routes/loops.ts'];
for(const path of paths){
  const actual=sha(await readFile(join(root,path)));
  assert.equal(actual,sha(gitRaw('show',head+':'+path)),path);
  if(products[path]) assert.equal(actual,products[path],path);
  sourceReadback[path]=actual;
}
async function enumerate(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()) files.push(...await enumerate(path));
    else {assert(entry.isFile(),path); files.push(path);}
  }
  return files;
}
for(const [dir,meta] of Object.entries(expected)){
  const listing=await readFile(join(retained,dir.replaceAll('/','_')+'.sha256'));
  assert.equal(sha(listing),meta.listingSha256,dir);
  const rows=new Map(listing.toString().trim().split(/\r?\n/).map((line)=>{
    const row=/^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);assert(row,line);return [row[2],row[1]];
  }));
  const directory=join(root,dir), files=await enumerate(directory);
  assert.equal(rows.size,meta.files,dir); assert.equal(files.length,meta.files,dir);
  for(const path of files){
    const rel=relative(directory,path).replaceAll('\\','/');
    const actual=sha(await readFile(path));
    assert.equal(actual,rows.get(rel),dir+'/'+rel);
    if(dir==='apps/web/dist'||(dir==='apps/api/dist'&&rel==='main.js')) critical[dir+'/'+rel]=actual;
  }
  trees[dir]={files:meta.files,listingSha256:meta.listingSha256};
}
assert.equal(Object.keys(trees).length,13);
const builtFiles=Object.values(trees).reduce((total,{files})=>total+files,0);
assert.equal(builtFiles,1227);
const bundle='/app/assets/index-DauABcWi.js';
const entry='apps/web/dist'+bundle.slice(4);
assert.equal(critical[entry],proof.map.bundleExpected);
assert.equal(critical[entry+'.map'],proof.map.expected);
const map=JSON.parse(await readFile(join(root,entry+'.map')));
for(const path of [...Object.keys(products),modal,dialog]) {
  const index=map.sources.findIndex((file)=>file.endsWith('/'+path.replace('apps/web/src/','')));
  assert(index>=0,path);
  const actual=sha(map.sourcesContent[index]);
  assert.equal(actual,sourceReadback[path],path); sourceMap[path]=actual;
}
const mapping={id:'207-phase1-independent-supplement-v1',sourceHashes:sourceMap};
const report={head,tree,base,stackBase:parent,builtFiles,bundle,sourceReadback,sourceMap,critical,trees,mapping,
  evidence:'phase-1 retained build matches 9 production modules and unchanged modal callers',
  originalBuildManifestSha256:sha(summary)};
await writeFile(join(evidence,name),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head,tree,bundle,source:Object.keys(sourceReadback).length,embedded:Object.keys(sourceMap).length,builtFiles}));

