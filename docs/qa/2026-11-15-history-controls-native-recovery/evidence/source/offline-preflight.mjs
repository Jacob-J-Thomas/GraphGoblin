import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const prior=join(root,'..','history-208-independent');
const admission=JSON.parse(await readFile(join(root,'admission-offline.json'),'utf8'));
assert.equal(process.version,'v22.23.4');
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(await readFile(join(prior,'handoff.md'))),'05f38f4a64e7e2e66479163aede0693937bcdca3757bd884b7c74c57661b9dbb');
const originals={};
for(const name of ['handoff.md','history.playwright.js','run-case.mjs','gateway.mjs','verify-binding.mjs','verify-cleanup.ps1','fixture-corrections.json']) originals[name]=sha(await readFile(join(prior,name)));
const binding=JSON.parse(await readFile(join(root,'binding','binding-before.json'),'utf8'));
const build=JSON.parse(await readFile(join(prior,'forced-build-exit.json'),'utf8'));
assert.equal(sha(await readFile(join(prior,'forced-build.log'))),build.logSha256);
assert.equal(build.logSha256,binding.buildLogSha256);
// Pure compiled contracts only: no API/infrastructure/native-addon import.
const {LoopDefinitionSchema}=await import(pathToFileURL(join(admission.checkout,'packages/contracts/dist/index.js')).href);
const actions=JSON.parse(await readFile(join(prior,'runs/h-d1-correction2/raw/actions.json'),'utf8'));
const saved=actions.out.checkpoints.filter(row=>row.request?.body?.definition && row.server?.draft?.definition);
assert(saved.length>0,'Retained actual PUT/device/API evidence required');
const replays=[];
for(const row of saved) {
  const wire=row.request.body.definition,expected={...wire,nodes:wire.nodes.map(node=>node.kind==='script'?{...node,config:{cwd:'workspace',stdin:'thread',stdout:'last-output',...node.config}}:node)};
  assert.deepEqual(LoopDefinitionSchema.parse(wire),expected);
  assert.deepEqual(row.server.draft.definition,expected);
  assert.deepEqual(row.device.definition,wire);
  replays.push({label:row.label,scriptDefaultsOnly:true,wireDeviceExact:true,fullCanonicalApiExact:true});
}
const example=saved[0].server;
const def=record=>{assert((record?.draft??record?.current)?.definition && record.draftToken);return(record.draft??record.current).definition;};
assert.deepEqual(def(example),example.draft.definition);
assert.deepEqual(def({current:example.draft,draftToken:example.draftToken}),example.draft.definition);
assert.deepEqual(def({current:{definition:{sentinel:'older'}},...example}),example.draft.definition);
assert.throws(()=>def({}));
const files={};
async function visit(relative) {
  for(const entry of await readdir(join(root,relative),{withFileTypes:true})) {
    const path=relative+'/'+entry.name;
    if(entry.isDirectory()) await visit(path);
    else files[path]=sha(await readFile(join(root,path)));
  }
}
await visit('driver-v1');
for(const path of Object.keys(files).filter(path=>/\.(mjs|js)$/.test(path))) execFileSync(process.execPath,['--check',join(root,path)],{windowsHide:true,stdio:'pipe'});
const manifest={version:'v1',files};
const manifestBytes=JSON.stringify(manifest,null,2)+'\n';
await writeFile(join(root,'driver-v1-manifest.json'),manifestBytes,{flag:'wx'});
admission.driverManifestSha256=sha(manifestBytes);
await writeFile(join(root,'admission-offline-frozen.json'),JSON.stringify(admission,null,2)+'\n',{flag:'wx'});
const report={status:'offline-preflight-pass',model:'gpt-6-astra',reasoning:'xhigh',priorModel:'Independent Sol QA; exact 6 versus 6.1 version not re-established',originals,
  priorFixtureCorrectionsExhausted:2,newCorrectionBatchesConsumed:0,newCorrectionBatchCap:2,
  replays,syntheticFallbackCases:['draft-only','current-only','draft-precedence','missing-refusal'],
  driverManifestSha256:sha(manifestBytes),nativeWorkStarted:false,buildStarted:false,formalScans:0,
  unchangedPriorHandoff:true};
await writeFile(join(root,'offline-preflight.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
