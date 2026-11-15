// Offline-only preparation. Executes no application, build, gateway or browser.
import assert from 'node:assert/strict';
import { mkdir,readFile,readdir,writeFile,copyFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const final=join(root,'final-parent'), drivers=join(final,'driver-v1');
const prior=join(root,'..','history-208-independent');
await mkdir(final);await mkdir(drivers);await mkdir(join(drivers,'configs'));
for(const name of await readdir(join(root,'driver-v1','configs'))) await copyFile(join(root,'driver-v1','configs',name),join(drivers,'configs',name));
for(const name of ['history.playwright.js','run-case.mjs','gateway.mjs','verify-reuse.mjs','verify-cleanup.ps1']) {
  let code=await readFile(join(root,'driver-v1',name),'utf8');
  if(name==='history.playwright.js') {
    assert(code.includes('settled.loop.draftVersionId === null'));
    code=code.replace("settled.current && !settled.draft && settled.loop.draftVersionId === null", "settled.current && !Object.hasOwn(settled, 'draft') && !Object.hasOwn(settled.loop, 'draftVersionId') && settled.loop.currentVersionId === settled.current.id");
  }
  if(name==='run-case.mjs') {
    code=code.replace('Frozen build binding 2eeb7e19..., candidate 82155142.', 'Final-parent frozen source/build binding comes from the exact root admission.');
    code=code.replace("join(base, 'fixture-corrections.json')", "join(base, '..', 'fixture-corrections.json')");
    code=code.replace("'read-only-offline.json'", "'read-only-before.json'");
  }
  if(name==='verify-reuse.mjs') {
    code=code.replace("for (const entry of git('ls-tree','-r','-z','HEAD').toString('utf8').split('\\0').filter(Boolean)) {", "for (const entry of git('ls-tree','-r','-z','HEAD').toString('utf8').split('\\0').filter(Boolean)) {");
    code=code.replace("  const [,mode,gitBlob,path] = match;", "  const [,mode,gitBlob,path] = match;\n  if (!Object.hasOwn(bound.sourceReadback,path)) continue;");
    code=code.replace('assert.equal(Object.keys(artifacts).length,1227);', 'assert.equal(Object.keys(artifacts).length,bound.builtFiles);');
    code=code.replace('mapped:16,built:1227,trees:13', 'mapped:16,built:bound.builtFiles,trees:13');
  }
  code=code.replaceAll('208-history-independent-native-v1','208-history-escalation-final-native-v1');
  await writeFile(join(drivers,name),code,{flag:'wx'});
}
await copyFile(join(prior,'build-frozen.ps1'),join(final,'build-frozen.ps1'));
let verifier=await readFile(join(prior,'verify-binding.mjs'),'utf8');
verifier=verifier.replace("for (const ancestor of [base, actualMain, historyParent, corrected207Integration])", "for (const ancestor of [base, actualMain, historyParent, corrected207Integration, admission.finalParent])");
const begin=verifier.indexOf('const files = [...new Set(');
const end=verifier.indexOf('const emit = ',begin);
assert(begin>0&&end>begin);
verifier=verifier.slice(0,begin)+`// Hash the complete effective runtime/build-source closure and its exact Git blobs.
// Historical docs/qa artifacts are bound by immutable HEAD/tree rather than reread per run.
const tracked = new Map(rawGit('ls-tree','-r','-z','HEAD').toString('utf8').split('\\0').filter(Boolean).map(entry => {
  const match = /^(\\d+) blob ([0-9a-f]{40})\\t(.+)$/.exec(entry);
  assert(match,'Non-blob entry'); return [match[3],match[2]];
}));
const rootInputs=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','tsconfig.json','tsconfig.build.json','.npmrc','.nvmrc','eslint.config.js','vitest.config.ts'];
const files=[...new Set([...tracked.keys()].filter(path=>/^(apps|packages|tooling)\\//.test(path)).concat(mapped,rootInputs.filter(path=>tracked.has(path)),
  stackDelta.filter(path=>!path.startsWith('docs/qa/') && !path.startsWith('docs/delivery/'))))].sort();
const sourceReadback={};
let cursor=0;
await Promise.all(Array.from({length:16},async()=>{
  while(cursor<files.length) {
    const file=files[cursor++], bytes=await readFile(join(checkout,file));
    const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\\0')).update(bytes).digest('hex');
    assert.equal(blob,tracked.get(file),file+' working/Git bytes');
    sourceReadback[file]=digest(bytes);
  }
}));
const sorted=Object.fromEntries(Object.keys(sourceReadback).sort().map(path=>[path,sourceReadback[path]]));
for(const path of Object.keys(sourceReadback)) delete sourceReadback[path];
Object.assign(sourceReadback,sorted);
`+verifier.slice(end);
verifier=verifier.replaceAll('208-history-independent-native-v1','208-history-escalation-final-native-v1');
await writeFile(join(final,'verify-binding.mjs'),verifier,{flag:'wx'});
await writeFile(join(final,'admission-template.json'),JSON.stringify({status:'inactive-awaiting-root-exact-target',buildGrant:null,nativeGrant:null,
  checkout:'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin',head:null,tree:null,base:'993d58a781ed2f0b4d13756c39e83162307b0ccd',
  finalParent:'993d58a781ed2f0b4d13756c39e83162307b0ccd',actualMain:null,observedMain:null,
  historyParent:'fc4c89d9ae2b9c854838787ae7d3375435106130',corrected207Integration:'bc9094fd426fe1c1a4b81b0e490e3887f977dbc7',
  beforeBindingSha256:null,driverManifestSha256:null,
  authorizedGroups:['h-d1','h-d2','h-n768','h-r512','ownership-d1','ownership-r512'],
  escalation:{model:'gpt-6-astra',reasoning:'xhigh',priorFixtureCorrectionsExhausted:2,maxNewFixtureCorrectionBatches:2,formalScans:0}},null,2)+'\n',{flag:'wx'});
console.log(final);
