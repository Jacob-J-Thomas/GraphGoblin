import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const admissionPath=process.argv[2];
assert(admissionPath,'Supply the authorized native admission');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const admission=await read(resolve(admissionPath));
assert.equal(admission.status,'authorized');
assert.equal(admission.schema,'208-history-final-native-admission/v1');
assert(admission.nativeGrant && admission.exclusiveSlotGrant);
const binding=await read(join(root,'binding/binding-before.json'));
const finalBinding=await read(join(root,'binding/binding-after.json'));
assert.deepEqual(finalBinding,binding);
for(const key of ['head','tree','base','actualMain','historyAnchor','mergedCanvas']) {
  assert.equal(binding[key],admission[key]);
}
const evidence=join(root,'binding/read-only-after.json');
assert.deepEqual(await read(evidence),await read(join(root,'binding/read-only-before.json')));
assert.deepEqual(await read(join(root,'binding/domain-map-after.json')),await read(join(root,'binding/domain-map-before.json')));
const cleanup=await read(join(root,'cleanup-final.json'));
const clean=['resourceFailures','ownedLive','listeners','leftoverStoresOrSqlite','unqualifiedPidMatches']
  .every(field=>Array.isArray(cleanup[field])&&cleanup[field].length===0);
const {LoopDefinitionSchema}=await import(pathToFileURL(join(admission.checkout,'packages/contracts/dist/index.js')).href);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const graph=response=>response?.draft?.definition??response?.current?.definition;
const witnessedPress=new Set(['top-undo','top-redo','held-put-transition','held-validation-transition','disabled-top-row','held-offline-transition']);
const reports=[];
for(const entry of await readdir(join(root,'runs'),{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const here=join(root,'runs',entry.name);
  const run=await read(join(here,'run.json'));
  const report={label:entry.name,group:run.scenario,config:run.config,head:run.head,
    failure:run.failure??null,harnessError:run.harnessError??null};
  assert.equal(run.head,admission.head);
  assert(admission.authorizedGroups.includes(run.scenario));
  const passed=run.driverExit===0&&!run.failure&&!run.harnessError&&!run.noStructuredResult&&!run.pageErrors?.length
    &&run.browserClose===0&&run.gatewayExit.code===0&&run.store?.removed;
  report.status=passed?'pass':run.failure?.kind==='product'?'product-failure':'incomplete';
  // Preserve failed run artifacts without turning a partial window into a passing row.
  const actionFile=join(here,'raw/actions.json');
  const actionBytes=await readFile(actionFile).catch(error=>{
    if (error.code!=='ENOENT' || passed) throw error;
    return null;
  });
  if(!actionBytes){reports.push(report);continue;}
  const {out,phases,requests}=JSON.parse(actionBytes);
  report.actionsSha256=digest(actionBytes);
  report.pageErrors=out.pageErrors;
  report.consoleErrors=out.consoleErrors;
  report.limits=out.limits;
  report.settings=out.settings;
  report.completedPhases=phases.map(phase=>phase.label);
  report.recordedCheckpoints=out.checkpoints.map(point=>point.label);
  report.conditionalGraphChecks=0;
  report.acceptedBrowserDraftPuts=requests.filter(req=>req.method==='PUT'&&req.path.endsWith('/draft')&&req.status===200).length;
  report.native404Responses=requests.filter(req=>req.method==='GET'&&req.status===404).length;
  report.pressWindows=[];
  report.geometry=out.geometry;
  if(passed){
    let previous;
    for(const point of out.checkpoints){
      if(point.label==='post-publish current-only readback'){
        assert(point.settled.current);
        assert(!Object.hasOwn(point.settled,'draft'));
        assert(!Object.hasOwn(point.settled.loop,'draftVersionId'));
        assert.deepEqual(point.settled.current.definition,graph(point.before));
        assert.equal(point.settled.draftToken,point.before.draftToken);
      }
      if(point.request?.body?.definition){
        assert.equal(point.request.ifMatch,'"'+previous.draftToken+'"');
        assert.deepEqual(point.device.definition,point.request.body.definition);
        assert.deepEqual(LoopDefinitionSchema.parse(point.request.body.definition),graph(point.server));
        assert.equal(point.device.baseToken,point.server.draftToken);
        assert.equal(point.device.synced,true);
        report.conditionalGraphChecks++;
      }
      previous=point.server??point.settled??point.baseline??previous;
    }
    assert.equal(report.conditionalGraphChecks,report.acceptedBrowserDraftPuts);
    for(const phase of phases){
      const frames=await read(join(here,'raw',phase.rawFile));
      assert.equal(frames.overflow,false);
      assert.equal(frames.trace.length,phase.samples);
      assert(frames.trace.every(frame=>frame.banners.filter(banner=>banner.visible&&!banner.hidden).length<=1));
      const window=out.geometry.find(row=>row.label===phase.label);
      if(window){
        assert.equal(window.excluded,0);
        assert(window.layoutSamples>0);
        assert.equal(window.misses,0);
        assert(window.max.every(value=>value<=0.02));
      }
      if(witnessedPress.has(phase.label)){
        const down=frames.trace.find(frame=>frame.type==='mousedown'&&['undo','redo'].includes(frame.input?.target));
        const up=frames.trace.find(frame=>frame.type==='mouseup'&&down&&frame.t>=down.t);
        const click=frames.trace.find(frame=>frame.type==='click'&&up&&frame.t>=up.t);
        assert(down&&up&&click);
        assert(up.t-down.t>=245);
        assert([down,up,click].every(frame=>frame.input.trusted&&frame.input.target===down.input.target));
        report.pressWindows.push({phase:phase.label,durationMs:up.t-down.t,target:down.input.target,point:[down.input.x,down.input.y]});
      }
    }
    if(run.scenario.startsWith('ownership-')){
      assert.equal(report.native404Responses,2);
      assert(report.completedPhases.includes('ownership-transfer'));
      assert(report.completedPhases.includes('ownership-native-load-error'));
    }
  }
  reports.push(report);
}
const omitted=admission.authorizedGroups.filter(group=>!reports.some(report=>report.group===group&&report.status==='pass'));
const corrections=await read(join(root,'fixture-corrections.json'));
assert(corrections.length<=2);
const summary={schema:'208-history-final-native-results/v1',head:admission.head,tree:admission.tree,base:admission.base,
  actualMain:admission.actualMain,mergedCanvas:admission.mergedCanvas,allGroupsPassed:omitted.length===0&&clean,
  missingPassingGroups:omitted,fixtureCorrectionBatches:corrections.length,cleanupClean:clean,formalScans:0,reports};
await writeFile(join(root,'result-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({head:summary.head,allGroupsPassed:summary.allGroupsPassed,missingPassingGroups:omitted,runCount:reports.length}));
if(!summary.allGroupsPassed)process.exitCode=2;
