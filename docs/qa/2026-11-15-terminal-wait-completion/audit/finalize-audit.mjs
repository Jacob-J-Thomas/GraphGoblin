import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// File/Git readbacks only. Every output is constrained to this external audit directory.
const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out = path.join(batch, 'review-410-astra-scan2');
const head = '0d1b935988c4ff06f5091b645210b0cd88703a16';
const target = '154401c7b47c1e56b62a6daec50e2a3145ea967d';
const tree = '9439a500040aa4763613549cca6235023916de58';
const source = '4e4501bd92953794bb733a746f7c24d1bcc2452a';
const merge = '89fa84597f5aa124cf02d2fdebe27e4656ef1516';
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/, ''));
const info = p => { const b=read(p); return {path:path.resolve(p),bytes:b.length,sha256:digest(b)}; };
const write = (name, data) => { assert.equal(path.dirname(path.resolve(out,name)),path.resolve(out));fs.writeFileSync(path.join(out,name),typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2)+'\n'); };
const git = (...args) => execFileSync('git',args,{cwd:repo,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:40*1024*1024});
const admissionPath = path.join(batch,'runtime-410-astra-admission.json');
assert.equal(info(admissionPath).sha256,'8c13a5d536316dfafaa57b82bf4aadef7fbbee6b029d7590280f66c3392d1a28');
assert.equal(git('rev-parse','HEAD').toString().trim(),head);
assert.equal(git('rev-parse','HEAD^{tree}').toString().trim(),tree);
assert.equal(git('merge-base',target,head).toString().trim(),target);
assert.equal(git('status','--porcelain=v2').toString().trim(),'');
const current=json(path.join(out,'final-remote-readback.json'));
assert.equal(current.main,target);assert.equal(current.run.head,head);assert.equal(current.run.attempt,2);assert.equal(current.run.conclusion,'success');assert.equal(current.testedMerge.sha,merge);assert.equal(current.testedMerge.tree,tree);assert.deepEqual(current.testedMerge.parents,[target,head]);
const admission=json(admissionPath);
const admitted=[...admission.boundInputs,...admission.ci.raw,admission.ci.artifact].map(v=>{const actual=info(v.path);assert.equal(actual.sha256,v.sha256);assert.equal(actual.bytes,v.bytes);return {...actual,expectedBytes:v.bytes,expectedSha256:v.sha256,matched:true};});
write('bound-input-final-readback.json',{at:new Date().toISOString(),admission:info(admissionPath),matched:admitted.length,inputs:admitted});
const changed=git('diff','--name-only',target,head).toString().trim().split(/\r?\n/);
assert.equal(changed.length,229);
write('effective-changed-paths.txt',changed.join('\n')+'\n');
const diffArgs=['diff','--no-ext-diff',target,head];
write('effective-full-diff.patch',git(...diffArgs));
write('effective-diff.patch',git(...diffArgs,'--','packages/engine/src/run-manager.ts','packages/engine/src/awaited-children.test.ts','CHANGELOG.md','docs/05-execution-engine.md','docs/delivery/2026-11-13-four-intents-register.md','docs/qa/.gitattributes'));
const publicationPaths=git('diff','--name-only',source,head).toString().trim().split(/\r?\n/);
assert.ok(publicationPaths.every(p=>p.startsWith('docs/')));
const completion=path.join(repo,'docs/qa/2026-11-15-runtime-failure-completion');
const map=json(path.join(completion,'source-copy-map.json'));
const described=map.files.filter(v=>/^(GET|body)/.test(v.sourcePath)).map(v=>{const actual=info(path.join(completion,v.path));assert.equal(actual.sha256,v.sha256);assert.equal(actual.bytes,v.bytes);return{...v,actual,matched:true};});
assert.equal(described.length,2);
const historicalComment=json(path.join(completion,'provenance/astra-comment-api-readback.json'));
const historicalBody=read(path.join(completion,'provenance/published-astra-comment-6900116835.md.txt')).toString('utf8');
assert.equal(historicalComment.id,6900116835);assert.equal(historicalComment.body,historicalBody);
const opusReportPath=path.join(batch,'review-410-opus-scan1/full-report.md');
const opusText=read(opusReportPath).toString('utf8');
const comments=json(path.join(out,'remote-pr487-comments.json')).structuredContent.comments;
const opusComment=comments.find(c=>c.url.endsWith('issuecomment-6901983201'));
assert.ok(opusComment.body.includes(opusText));
write('publication-provenance-readback.json',{at:new Date().toISOString(),head,target,tree,source,merge,commits:git('log','--format=%H %T %P',target+'..'+head).toString(),sourceToPublicationOnlyDocs:true,publicationPaths,descriptiveSourceOrigins:described,historicalCommentId:historicalComment.id,historicalPublishedBodyExact:true,opusReport:info(opusReportPath),opusPublishedFullReportExact:true,opusCommentUrl:opusComment.url});
const inputs=new Map();
function add(v,role){const key=path.resolve(v.path).toLowerCase();const entry=inputs.get(key)??{path:path.resolve(v.path),bytes:v.bytes??v.actualBytes,sha256:v.sha256??v.actualSha256,roles:[]};if(!entry.roles.includes(role))entry.roles.push(role);inputs.set(key,entry);}
const inventoryReferences=fs.readdirSync(out).filter(n=>/^inspected-inputs-.*\.json$/.test(n)).map(name=>({file:info(path.join(out,name)),entryCount:json(path.join(out,name)).length,role:'Exact detailed input inventory; referenced here without duplicating bulk source/build/packet entries'}));
for(const v of admitted)add(v,'admission-bound evidence');
add(info(admissionPath),'formal review admission');
const repoContent=[
  'AGENTS.md','docs/README.md','docs/12-implementation-plan.md','docs/15-issue-workflow.md','docs/delivery/2026-11-13-four-intents-register.md','docs/05-execution-engine.md','CHANGELOG.md','docs/qa/.gitattributes',
  'packages/engine/src/run-manager.ts','packages/engine/src/awaited-children.test.ts','packages/engine/src/child-failure-parity.test.ts','packages/engine/src/ports.ts','packages/engine/src/testing/fakes.ts','packages/engine/src/testing/scenario.ts','packages/engine/src/handlers/subloop.ts','packages/engine/src/handlers/heartbeat.ts','packages/engine/src/handlers/wait.ts',
  'packages/infrastructure/src/sqlite/runs.ts','packages/infrastructure/src/sqlite/run-row.ts','packages/infrastructure/src/sqlite/run-decoding.ts','packages/infrastructure/src/sqlite/admission.ts','apps/mcp/src/describe.ts','apps/mcp/src/tools.ts','packages/contracts/src/run.ts','packages/contracts/src/events.ts'
];
for(const rel of repoContent)add(info(path.join(repo,rel)),'source/context inspected at relevant definitions; full changed production and tests inspected');
const externalContent=[
  'runtime-contract.md','runtime-410-implementation-brief.md','runtime-410-opus-brief.md','runtime-410-astra-brief.md',
  'runtime-410-native-preparation/README.md','runtime-410-native-preparation/run.mjs','runtime-410-native-preparation/gateway.mjs','runtime-410-native-preparation/owned-store.mjs','runtime-410-native-preparation/resources.mjs','runtime-410-native-seed-correction-preparation/native-preparation.patch',
  'review-410-opus-scan1/full-report.md','review-410-opus-scan1/launch.json','review-410-opus-scan1/result.json','review-410-opus-scan1/exit.json','review-410-opus-scan1/probe-old-source/probe.config.mjs','review-410-opus-scan1/probe-old-source/old-source-emulation.setup.ts','review-410-opus-scan1/probe-old-source/01-emulated-pre-410.log','review-410-opus-scan1/probe-old-source/02-candidate-control.log'
];
for(const rel of externalContent)add(info(path.join(batch,rel)),'external evidence source/content inspected');
for(const p of changed)add(info(path.join(repo,p)),p.startsWith('docs/qa/')?'effective diff packet byte/provenance verification; selected content traced in full-report.md':'full effective change content reviewed');
for(const name of fs.readdirSync(out).filter(n=>/^remote-.*\.json$/.test(n)||/^final-.*connector-readback\.json$/.test(n)))add(info(path.join(out,name)),'remote read-only response retained and checked');
const entries=[...inputs.values()].sort((a,b)=>a.path.localeCompare(b.path));
write('audit-input-inventory.json',{at:new Date().toISOString(),scope:'Bounded primary evidence/content-review input list plus exact references to the already retained detailed hash-binding inventories. Bulk hash checking is not a claim of line-by-line review of unchanged files.',head,target,tree,admittedInputs:admitted.length,inputCount:entries.length,inventoryReferences,inputs:entries});
const report=info(path.join(out,'full-report.md'));
write('audit-seal.json',{at:new Date().toISOString(),verdict:'SIGN-OFF',model:'gpt-6-astra',effort:'max',formalScan:2,combinedScanCap:3,head,target,tree,source,merge,ci:{run:43758754651,attempt:2,gatesJob:132958879679,conclusion:'success'},lastRemoteReadbackAt:current.at,report,inputCount:entries.length,admittedInputsMatched:admitted.length,repoStatus:git('status','--porcelain=v2').toString(),sideEffects:'External audit files only; no repository, index, GitHub, application/store, provider, test/build or native fixture mutation.'});
const outputs=fs.readdirSync(out).filter(n=>n!=='SHA256SUMS.txt'&&fs.statSync(path.join(out,n)).isFile()).sort();
write('SHA256SUMS.txt',outputs.map(n=>info(path.join(out,n)).sha256+'  '+n).join('\n')+'\n');
console.log(JSON.stringify({verdict:'SIGN-OFF',report,inputs:entries.length,admitted:admitted.length,outputs:outputs.length,remoteAt:current.at,repoClean:true},null,2));
