import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const qa='G:/ggq/gg-i4-427-qa/GraphGoblin',repo='G:/ggq/gg-i4-427-guide/GraphGoblin',built='G:/ggq/gg-i4-362-qa/GraphGoblin';
const out=dirname(fileURLToPath(import.meta.url));
const base='02351e2fb932b3be44e7cc3fb3943a61d568226c',head='8980c27c75e04d33cdcf48736c71db05e35175a3';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
assert.equal(git(repo,'rev-parse','HEAD').trim(),head);assert.equal(git(repo,'status','--porcelain').trim(),'');assert.equal(git(qa,'status','--porcelain').trim(),'');assert.equal(git(built,'status','--porcelain').trim(),'');
const changed=git(repo,'diff','--name-only',base,head).trim().split('\n');
const runtime=changed.filter(p=>!p.startsWith('docs/')&&p!=='CHANGELOG.md');
assert.deepEqual(runtime,['packages/adapter-codex/src/isolation.ts','packages/adapter-codex/src/options.ts']);
const ts=(await import(pathToFileURL(join(qa,'node_modules/typescript/lib/typescript.js')).href)).default;
const emit=(source,fileName)=>ts.transpileModule(source,{fileName,compilerOptions:{module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022,removeComments:true}}).outputText;
const hash=v=>createHash('sha256').update(v).digest('hex');
const runtimeProof=[];
for(const path of runtime){
 const old=git(repo,'show',`${base}:${path}`),fresh=git(repo,'show',`${head}:${path}`);
 const a=emit(old,path),b=emit(fresh,path);assert.equal(a,b);
 const builtPath=path.replace('/src/','/dist/').replace(/\.ts$/,'.js');
 assert.equal(emit(b,builtPath),emit(await readFile(join(built,builtPath),'utf8'),builtPath));
 runtimeProof.push({path,baseSourceSha256:hash(old),candidateSourceSha256:hash(fresh),baseEmittedSha256:hash(a),candidateEmittedSha256:hash(b),builtNormalizedEqual:true});
}
const initial=JSON.parse(await readFile(join(out,'source-binding.json'),'utf8'));
for(const a of initial.artifacts)assert.equal(hash(await readFile(a.path)),a.sha256,'reused artifact remained unchanged: '+a.path);
const finalSources=[];await mkdir(join(out,'final-source'),{recursive:true});
for(const p of changed){const v=execFileSync('git',['show',`${head}:${p}`],{cwd:repo,windowsHide:true});await writeFile(join(out,'final-source',p.replaceAll('/','__')),v);finalSources.push({path:p,sha256:hash(v)})}
await writeFile(join(out,'final-candidate.patch'),execFileSync('git',['diff','--binary','--full-index',base,head],{cwd:repo,windowsHide:true}));
const refs=[
 ['packages/adapter-codex/src/events.ts',180,207],['packages/adapter-codex/src/events.ts',307,330],
 ['packages/engine/src/handlers/inference.ts',818,841],['packages/adapter-codex/src/decider.ts',15,45],
 ['packages/engine/src/primitive-evaluator.ts',61,104],['packages/adapter-codex/src/cli.ts',172,236],
 ['packages/contracts/src/catalog.ts',1,88],['apps/api/src/config.ts',121,151],['apps/api/src/container.ts',396,403],
 ['apps/web/src/runs/RunInspectorPage.tsx',208,223],['apps/web/src/runs/inspector/RunControls.tsx',63,103],
];
const references=[];
for(const [p,start,end] of refs){const buf=execFileSync('git',['show',`${head}:${p}`],{cwd:repo,windowsHide:true});const lines=buf.toString().split('\n');references.push({path:p,sha256:hash(buf),start,end,text:lines.slice(start-1,end).map((s,i)=>`${start+i}: ${s}`).join('\n')})}
await writeFile(join(out,'source-references.json'),JSON.stringify(references,null,2));
const observations=[];
for(const c of [
 {name:'historical',failure:'HARNESS_TURN_FAILED',phrase:"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.",disabled:true},
 {name:'unknown',failure:'HARNESS_DELIVERY_UNCERTAIN',phrase:'QA427_UNKNOWN_CODE_ONLY',disabled:false},
 {name:'decision',failure:'EVALUATION_PROVIDER_FAILED',phrase:'Decision provider request failed',disabled:true},
 {name:'supported',phrase:'succeeded',disabled:true},
]){
 const path=join(out,'output/playwright',c.name+'.yaml');const yaml=await readFile(path,'utf8');assert(yaml.includes(c.phrase));if(c.failure)assert(yaml.includes('Failed: '+c.failure));
 assert.equal(yaml.includes('button "Resume" [disabled]'),c.disabled);
 assert(!yaml.includes('QA427_PRIVATE_ENV_DO_NOT_EXPOSE'));
 if(c.name==='decision'){assert(!yaml.includes("The 'gpt-5.5' model is not supported"));assert(!yaml.includes('model_not_found'))}
 const png=join(out,'output/playwright',c.name+'.png');observations.push({...c,yamlSha256:hash(yaml),pngSha256:hash(await readFile(png)),pass:true});
}
await writeFile(join(out,'browser-observations.json'),JSON.stringify(observations,null,2));
const results=JSON.parse(await readFile(join(out,'public-native-attempt-7/results.json'),'utf8'));assert.equal(results.length,6);
for(const row of results){assert.equal(row.requests,1);assert.equal(row.harnessCalls.length,1)}
const cleanup=JSON.parse(await readFile(join(out,'public-native-attempt-7/cleanup.json'),'utf8'));assert.equal(cleanup.ownServersClosed,true);assert(!cleanup.failure);
const verdict={candidate:head,tree:git(repo,'rev-parse','HEAD^{tree}').trim(),base,originalCandidate:initial.candidate,node:process.version,typescript:ts.version,changed,runtimeProof,finalSources,unchangedReusedArtifacts:initial.artifacts,sourceTier:'Runtime candidate source differs from signed base only by comments; emitted JS equals both base and reused build. No rerun needed for final documentation/comment correction.',browserObservations:observations,publicCases:results.map(r=>({name:r.name,runId:r.runId,requests:r.requests,status:r.rest.body.status,failureCode:r.rest.body.failure?.code,adapterCode:r.rest.body.failure?.details?.adapterCode,deciderCode:r.rest.body.failure?.details?.code,resume:r.rest.body.recovery.resume.allowed})),cleanup,independentVerdict:'PASS bounded #427 inference/account-error guidance and explicit decision limit; PASS #365 documentation/SDK argv parity; no new runtime fix established. Not merge/owner acceptance or a live entitlement/backend claim.'};
await writeFile(join(out,'final-source-binding.json'),JSON.stringify(verdict,null,2));console.log(JSON.stringify(verdict,null,2));
