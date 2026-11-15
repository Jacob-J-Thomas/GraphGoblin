import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';

const [checkout]=process.argv.slice(2);
const repo=await realpath(checkout);
const oldRoot='../save-publish-237-review-correction-independent';
const json=async f=>JSON.parse(await readFile(f,'utf8'));
const root=await json('../review-237/actual-main-integration-freeze.json');
const old=await json(oldRoot+'/corrected-binding-before.json');
const oldMap=await json(oldRoot+'/corrected-ui-mapping.json');
const historicalSpec=await json(oldRoot+'/corrected-manifest.json');
const parents=['35bb3fbdc724a82064d0d9e65b551608542c6b22','8fadcb0d44ac2caf80ff6279fe4648ce9398afd9'];
const opts={cwd:repo,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}};
const git=(...args)=>execFileSync('git',args,opts);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.version,'v22.23.4');
assert.deepEqual(root.parents,parents);
assert.equal(root.target,parents[1]);
assert.equal(root.head,'da1681e4d22939033f1fc03d45ac812439c4c223');
assert.equal(root.tree,'b009dd501e7f06801295f41d6c168d553d124b4d');
assert.deepEqual(git('rev-parse','HEAD','HEAD^{tree}','HEAD^1','HEAD^2','origin/main').toString().trim().split(/\r?\n/),
  [root.head,root.tree,...parents,root.target]);
assert.equal(git('status','--porcelain=v1').toString().trim(),'');
assert.equal(root.source.length,27);
const approved=Object.fromEntries(root.source.map(row=>[row.path,row.sha256]));
const parentMap=[
  'apps/web/src/editor/store.ts','apps/web/src/editor/NodeEditorDialog.tsx',
  'apps/web/src/editor/RenameNotice.tsx','apps/web/src/editor/pointer-press.ts',
  'apps/web/src/forms/repair.ts','apps/web/src/forms/SchemaForm.tsx',
];
const runtime=[...new Set([...Object.keys(old.sourceMap),...oldMap.noticeSourcePaths,...parentMap])];
const paths=[...new Set([...Object.keys(old.sourceReadback),...Object.keys(approved),...runtime,
  'apps/api/src/main.ts','packages/domain/src/expression-references.ts','packages/domain/src/node-references.ts',
  'packages/domain/src/source-analysis.ts','packages/domain/src/graph.ts','pnpm-lock.yaml'])].sort();
const checked={};
for(const path of paths){
 const actual=await readFile(join(repo,path));
 assert(actual.equals(git('show',root.head+':'+path)),path+' Git versus working bytes');
 checked[path]=sha(actual);
 if(approved[path]) assert.equal(approved[path],checked[path],path+' root approval');
}
const changedRuntime=Object.entries(checked)
  .filter(([path,digest])=>old.sourceReadback[path]&&old.sourceReadback[path]!==digest)
  .map(([path])=>path);
for(const path of ['apps/web/src/editor/usePublish.ts','apps/web/src/editor/useAutosave.ts','apps/web/src/api/queries.ts'])
  assert.equal(checked[path],old.sourceReadback[path],path+' retained verifier behavior mapping');
const pendingMap={id:oldMap.id,frozen:false,head:null,bundle:null,
 noticeSourcePaths:runtime,sourceHashes:Object.fromEntries(runtime.map(path=>[path,checked[path]]))};
const spec={...historicalSpec,frozen:false,head:null,tree:null,base:root.target,stackBase:root.target,builtSource:null,
 source:'final-source-sha256.txt',mapping:'final-ui-mapping.json',bundle:null,bundleSha256:null,apiEntrySha256:null,
 requiredSources:paths,trees:Object.fromEntries(Object.keys(historicalSpec.trees).map(tree=>
   [tree,'final-manifests/'+tree.replaceAll('/','_')+'.sha256']))};
const emit=(file,body)=>writeFile(file,JSON.stringify(body,null,2)+'\n',{flag:'wx'});
await emit('source-preparation.json',{head:root.head,tree:root.tree,parents,base:root.target,sourceReadback:checked,
 changedRuntime,approvedCount:Object.keys(approved).length,sourceCount:paths.length,embeddedRuntimeCount:runtime.length,
 originalRuntime:'35bb3fbdc724a82064d0d9e65b551608542c6b22',pendingGrant:true});
await emit('inactive-manifest.json',spec);
await emit('inactive-ui-mapping.json',pendingMap);
console.log(JSON.stringify({checked:paths.length,changedRuntime,embedded:runtime.length,source:root.head,
  tree:root.tree,target:root.target,approved:root.source.length},null,2));
