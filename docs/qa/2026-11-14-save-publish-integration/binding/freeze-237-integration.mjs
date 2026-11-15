import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch',root='C:/Users/98jak/.codex/worktrees/gg-20261114-save-publish/GraphGoblin';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:48*1024*1024}).trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const binding=JSON.parse(readFileSync(batch+'/ui-237-integration-correction/native/binding-before.json','utf8'));
const final=JSON.parse(readFileSync(batch+'/ui-237-integration-correction/native/binding-after.json','utf8'));
for(const [key,args] of Object.entries({head:['rev-parse','HEAD'],mergeHead:['rev-parse','MERGE_HEAD'],tree:['rev-parse','HEAD^{tree}'],status:['status','--porcelain=v1']})){assert.equal(git(...args),binding[key]);assert.equal(final[key],binding[key]);}
assert.equal(final.index,binding.index);
assert.equal(hash(git('ls-files','-s')),binding.index);
assert.equal(binding.head,'e12b81ec9767b9bfd3d6e649025023796b2bc638');assert.equal(binding.mergeHead,'2367b15b310eac52d95af77c570d5ce36f741527');
const expected=['CHANGELOG.md','apps/web/src/editor/EditorPage.name-conflict.test.tsx','apps/web/src/editor/EditorPage.publish.test.tsx','apps/web/src/editor/EditorPage.tsx','apps/web/src/editor/store.ts','apps/web/src/editor/useAutosave.ts','apps/web/src/editor/usePublish.ts','apps/web/src/loops/LoopsPage.tsx','apps/web/src/loops/loop-names.test.tsx','docs/09-frontend-and-pwa.md','docs/guide/02-build-a-loop.md'].sort();
assert.deepEqual(git('diff','HEAD','--name-only').split('\n').sort(),expected);assert.equal(git('ls-files','--others','--exclude-standard'),'');
assert.deepEqual(git('diff','--name-only','--diff-filter=U').split('\n'),['apps/web/src/editor/useAutosave.ts']);
for(const [path,sha] of Object.entries(binding.sourceHashes)){assert.equal(hash(readFileSync(join(root,path))),sha,path);assert.equal(final.sourceHashes[path],sha,path);}
assert.equal(Object.keys(binding.sourceHashes).length,25);
const files=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>{assert(!e.isSymbolicLink());return e.isDirectory()?files(join(d,e.name)):[join(d,e.name)];});
const roots=[...new Set(Object.keys(binding.built).map(p=>p.split('/').slice(0,3).join('/')))];let count=0;
for(const tree of roots)for(const f of files(join(root,tree))){const path=relative(root,f).replaceAll('\\','/');assert.equal(hash(readFileSync(f)),binding.built[path],path);assert.equal(final.built[path],binding.built[path],path);count++;}
assert.equal(count,1227);assert.equal(Object.keys(final.built).length,count);
const sourceBlobs=Object.fromEntries(expected.map(p=>[p,git('hash-object',p)]));
const out={observedAt:new Date().toISOString(),head:binding.head,mergeHead:binding.mergeHead,sourceFiles:25,builtFiles:count,builtManifestSha256:binding.builtManifestSha256,expectedChangedFiles:expected,sourceHashes:binding.sourceHashes,sourceBlobs,codeStatus:'Opus integration correction verified, independent full QA pending',newHypothesis:'A locally refused retry may discard previous unknown/readback-failed state; native verification is required before deciding correction.',checks:'255 affected,38 readiness,26 publish;4newnegativecases fail original+healthycontrolpassesboth;typeslintformat;12forcedbuildtasks;native3retryvariants+U2readinesspass;firstharnessENOBUFSretained',model:'claude-opus-5-5',effortRequested:'xhigh'};
writeFileSync(batch+'/ui-237-integration-precommit-binding.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({readyForRootMergeCommit:true,sources:25,built:count,paths:expected.length}));
