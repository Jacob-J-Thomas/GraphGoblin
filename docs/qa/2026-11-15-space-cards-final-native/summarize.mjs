import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const admissionPath=process.argv[2];
assert(admissionPath,'Supply the authorized native admission');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const admission=await json(resolve(admissionPath));
assert.equal(admission.status,'authorized');
assert.equal(admission.schema,'208-space-corrected-native-admission/v1');
assert(admission.nativeGrant&&admission.exclusiveSlotGrant);
const binding=await json(join(root,'binding/binding-before.json'));
assert.deepEqual(await json(join(root,'binding/binding-after.json')),binding);
for(const key of ['head','tree','base','actualMain','candidateScope','spaceAnchor','mergedCanvas','mergedHistory']) {
  assert.equal(binding[key],admission[key],key);
}
assert.deepEqual(await json(join(root,'binding/read-only-after.json')),await json(join(root,'binding/read-only-before.json')));
assert.deepEqual(await json(join(root,'binding/domain-map-after.json')),await json(join(root,'binding/domain-map-before.json')));
const cleanup=await json(join(root,'cleanup-final.json'));
const clean=['resourceFailures','ownedLive','listeners','leftoverStoresOrSqlite','unqualifiedPidMatches']
  .every(field=>Array.isArray(cleanup[field])&&cleanup[field].length===0);
const {LoopDefinitionSchema}=await import(pathToFileURL(join(admission.checkout,'packages/contracts/dist/index.js')).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const def=record=>record.draft?.definition??record.current?.definition;
const reports=[];
for(const entry of await readdir(join(root,'runs'),{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const folder=join(root,'runs',entry.name);
  const run=await json(join(folder,'run.json'));
  assert.equal(run.head,admission.head);
  assert(admission.authorizedGroups.includes(run.scenario));
  const passes=!run.failure&&!run.harnessError&&!run.noStructuredResult&&!run.pageErrors?.length
    &&run.driverExit===0&&run.browserClose===0&&run.gatewayExit.code===0&&run.store?.removed&&run.store.sqliteFilePresent;
  const report={label:run.label,group:run.scenario,config:run.config,status:passes?'pass':run.failure?.kind==='product'?'product-failure':'incomplete',
    failure:run.failure??null,harnessError:run.harnessError??null};
  const raw=await readdir(join(folder,'raw'));
  const resultFiles=raw.filter(name=>name.endsWith('-full-result.json'));
  if(!passes&&resultFiles.length===0){reports.push(report);continue;}
  assert.equal(resultFiles.length,1);
  const bytes=await readFile(join(folder,'raw',resultFiles[0]));
  const result=JSON.parse(bytes);
  report.resultSha256=sha(bytes);
  report.labels=result.checks.map(row=>row.label);
  report.browserDraftRequests=result.requests.length;
  report.consoleErrors=result.consoleErrors;
  report.pageErrors=result.pageErrors;
  report.limits=result.limits;
  report.passingFullGraphChecks=0;
  if(passes){
    assert.equal(result.failure,null);
    assert.equal(result.pageErrors.length,0);
    for(const name of raw.filter(name=>/^\d+-saved-.*\.json$/.test(name))){
      const row=await json(join(folder,'raw',name));
      const wire=JSON.parse(row.put.requestText).definition;
      const acknowledgement=JSON.parse(row.put.responseText);
      assert.deepEqual(wire,row.device.definition);
      assert.deepEqual(LoopDefinitionSchema.parse(wire),def(row.server));
      assert.deepEqual(def(acknowledgement),def(row.server));
      assert.equal(row.device.baseToken,row.server.draftToken);
      assert.equal(acknowledgement.draftToken,row.server.draftToken);
      report.passingFullGraphChecks++;
    }
    if(run.scenario==='double-r512'){
      assert(report.labels.includes('repeated-verdict-r512-count-two'));
      assert(report.labels.includes('repeated-verdict-r512-count-one'));
      assert(report.labels.includes('repeated-verdict-r512-count-three'));
      assert(report.labels.includes('repeated-verdict-r512-shift-drag'));
      assert(report.labels.includes('quiet-ordinary-zoom-remains-viewport-only'));
    }
  }
  reports.push(report);
}
const missing=admission.authorizedGroups.filter(group=>!reports.some(report=>report.group===group&&report.status==='pass'));
const corrections=await json(resolve(admission.fixtureLedgerPath));
assert(corrections.length>=1&&corrections.length<=2);
const summary={schema:'208-space-corrected-native-results/v1',scope:admission.candidateScope,
  head:admission.head,tree:admission.tree,base:admission.base,actualMain:admission.actualMain,
  allGroupsPassed:missing.length===0&&clean,missingPassingGroups:missing,cleanupClean:clean,
  globalFixtureCorrectionBatches:corrections.length,formalScans:0,reports};
await writeFile(join(root,'result-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head:summary.head,scope:summary.scope,allGroupsPassed:summary.allGroupsPassed,missing,runCount:reports.length}));
if(!summary.allGroupsPassed)process.exitCode=2;
