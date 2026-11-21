import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo='G:/ggq/gg-i4-427-qa/GraphGoblin';
const built='G:/ggq/gg-i4-362-qa/GraphGoblin';
const out='C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-427-365-independent-01';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();
const base='02351e2fb932b3be44e7cc3fb3943a61d568226c';
const head='f96a4073c3b53af7724d1ef5593eeaf03194c4cd';
assert.equal(git(repo,'rev-parse','HEAD'),head);
assert.equal(git(built,'rev-parse','HEAD'),base);
assert.equal(git(repo,'status','--porcelain'),'');
assert.equal(git(built,'status','--porcelain'),'');
const changed=git(repo,'diff','--name-only',base,head).split('\n');
const runtime=changed.filter(p=>!p.startsWith('docs/')&&p!=='CHANGELOG.md');
assert.deepEqual(runtime,['packages/adapter-codex/src/options.ts']);
const ts=await import(pathToFileURL(join(repo,'node_modules/typescript/lib/typescript.js')).href);
const compilerOptions={module:ts.default.ModuleKind.NodeNext,target:ts.default.ScriptTarget.ES2022,removeComments:true};
const emit=(source,fileName)=>ts.default.transpileModule(source,{fileName,compilerOptions}).outputText;
const candidate=await readFile(join(repo,runtime[0]),'utf8');
const previous=execFileSync('git',['show',`${base}:${runtime[0]}`],{cwd:repo,encoding:'utf8',windowsHide:true});
const candidateJs=emit(candidate,'options.ts');
const previousJs=emit(previous,'options.ts');
assert.equal(candidateJs,previousJs);
const builtJs=await readFile(join(built,'packages/adapter-codex/dist/options.js'),'utf8');
// Normalizing emitted JavaScript removes sourceMappingURL and comments only. No source rewrite.
assert.equal(emit(candidateJs,'options.js'),emit(builtJs,'options.js'));
const hash=(v)=>createHash('sha256').update(v).digest('hex');
await writeFile(join(out,'candidate-options.emitted.js'),candidateJs);
const paths=[
 'pnpm-lock.yaml','tsconfig.base.json','packages/adapter-codex/src/harness.ts',
 'packages/adapter-codex/src/events.ts','packages/adapter-codex/src/client.ts',
 'packages/adapter-codex/src/isolation.ts','packages/adapter-codex/src/cli.ts',
 'apps/api/src/app.ts','apps/api/src/container.ts','apps/mcp/src/server.ts',
 'apps/mcp/src/tools.ts','apps/web/src/runs/RunInspectorPage.tsx',
 'apps/web/src/runs/inspector/RunControls.tsx',
];
const sources=[];
for(const p of paths){const a=await readFile(join(repo,p));const b=await readFile(join(built,p));assert.equal(hash(a),hash(b));sources.push({path:p,sha256:hash(a)})}
const artifacts=[];
for(const p of ['packages/adapter-codex/dist/harness.js','packages/adapter-codex/dist/events.js','packages/adapter-codex/dist/options.js','packages/engine/dist/handlers/inference.js','apps/api/dist/app.js','apps/api/dist/container.js','apps/mcp/dist/server.js','apps/mcp/dist/tools.js','apps/web/dist/index.html']){artifacts.push({path:join(built,p),sha256:hash(await readFile(join(built,p)))})}
const buildLog='C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-362-independent-01/raw/02-pnpm-build.log';
const log=await readFile(buildLog,'utf8');assert(log.includes('pnpm-build-exit=0'));assert(log.includes('12 successful, 12 total'));
const result={candidate:head,tree:git(repo,'rev-parse','HEAD^{tree}'),base,builtCheckout:built,node:process.version,typescript:ts.default.version,changed,runtimeChanged:runtime,commentOnlyRuntimeProof:true,candidateEmittedSha256:hash(candidateJs),previousEmittedSha256:hash(previousJs),builtOptionsNormalizedEqual:true,sources,artifacts,buildLog,buildLogSha256:hash(log),scope:'Read-only reuse of exact base runtime; candidate source differs only by non-emitted JSDoc; docs are reviewed at candidate. Not an independent full build.'};
await writeFile(join(out,'source-binding.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
