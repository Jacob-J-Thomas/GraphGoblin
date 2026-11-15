import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const admission=JSON.parse(await readFile(join(root,'admission-native.json'),'utf8'));
const {LoopDefinitionSchema}=await import(pathToFileURL(join(admission.checkout,'packages/contracts/dist/index.js')).href);
const sha=b=>createHash('sha256').update(b).digest('hex');
const reports=[];
for(const label of (await readdir(join(root,'runs'))).sort()) {
  const path=join(root,'runs',label),run=JSON.parse(await readFile(join(path,'run.json'),'utf8'));
  const actions=JSON.parse(await readFile(join(path,'raw/actions.json'),'utf8'));
  const observed=JSON.parse(await readFile(join(path,'observed.json'),'utf8'));
  const retainedFixtureFailure=['h-r512-initial','ownership-d1-initial'].includes(label);
  if(retainedFixtureFailure) {assert(observed.failure);assert.equal(run.driverExit,0);}
  else {assert.equal(observed.failure,null);assert.equal(run.failure,null);assert.equal(run.driverExit,0);}
  assert.equal(observed.pageErrors.length,0);assert.equal(run.store.removed,true);
  assert.equal(run.gatewayExit.code,0);assert.equal(run.browserClose,0);
  const checkpoints=actions.out.checkpoints.filter(point=>point.request?.body?.definition);
  for(const point of checkpoints) {
    assert.deepEqual(point.device.definition,point.request.body.definition);
    assert.deepEqual(LoopDefinitionSchema.parse(point.request.body.definition),point.server.draft.definition);
    assert.equal(point.device.baseToken,point.server.draftToken);assert.equal(point.device.synced,true);
  }
  const publish=actions.out.checkpoints.find(point=>point.label==='post-publish current-only readback');
  if(publish){assert(!Object.hasOwn(publish.settled,'draft'));assert(!Object.hasOwn(publish.settled.loop,'draftVersionId'));
    assert.deepEqual(publish.settled.current.definition,publish.before.draft?.definition??publish.before.current.definition);
    assert.equal(publish.settled.draftToken,publish.before.draftToken);}
  const windows=[];
  const banners=[];
  const modalities=new Set();
  for(const phase of actions.phases) {
    const captured=JSON.parse(await readFile(join(path,'raw',phase.rawFile),'utf8'));
    assert.equal(captured.overflow,false);
    for(const f of captured.trace){if(f.input?.pointer)modalities.add(f.input.pointer);for(const b of f.banners)banners.push({where:b.where,text:b.text,visible:b.visible,hidden:b.hidden,role:b.role,ariaLive:b.ariaLive,ariaAtomic:b.ariaAtomic});}
    if(['top-undo','top-redo','held-put-transition','held-validation-transition','disabled-top-row'].includes(phase.label)) {
      const down=captured.trace.find(f=>f.type==='mousedown' && ['undo','redo'].includes(f.input?.target));
      const up=captured.trace.find(f=>f.type==='mouseup' && down && f.t>=down.t);
      const click=captured.trace.find(f=>f.type==='click' && up && f.t>=up.t);
      assert(down&&up&&click);assert(up.t-down.t>=245);
      assert.equal(click.input.target,down.input.target);assert.equal(up.input.target,down.input.target);
      const index=down.input.target==='undo'?0:1;
      windows.push({phase:phase.label,holdMs:Number((up.t-down.t).toFixed(3)),point:[down.input.x,down.input.y],
        bounds:down.boxes[index],disabledAtDown:down.directions[index].disabled,
        actualTargets:[down.input.target,up.input.target,click.input.target],trusted:[down,up,click].every(f=>f.input.trusted),
        labelsDuringHold:[...new Set(captured.trace.filter(f=>f.t>=down.t&&f.t<=up.t).map(f=>f.validation))],
        saveDuringHold:[...new Set(captured.trace.filter(f=>f.t>=down.t&&f.t<=up.t).map(f=>f.save))]});
    }
  }
  const geometry=observed.summary.geometry;
  const errors404=actions.requests.filter(req=>req.method==='GET'&&req.status===404);
  const report={group:run.scenario,label,status:retainedFixtureFailure?'retained-fixture-incomplete':'pass',failure:observed.failure,
    config:run.config,settings:actions.out.settings,
    recordedCheckpoints:actions.out.checkpoints.length,persistedGraphReplays:checkpoints.length,
    successfulConditionalPuts:actions.requests.filter(req=>req.method==='PUT'&&req.path.endsWith('/draft')&&req.status===200).length,
    frameWindows:actions.phases.length,verifiedStationarityWindows:geometry.length,
    geometryMax:geometry.reduce((a,g)=>a.map((value,i)=>Math.max(value,g.max[i])),[0,0,0,0]),
    fixedTargetMisses:geometry.reduce((sum,g)=>sum+g.misses,0),
    headerHeights:[...new Set(geometry.flatMap(g=>g.headerHeights))].sort((a,b)=>a-b),
    validationWidths:[...new Set(geometry.flatMap(g=>g.validationWidths).filter(v=>v!==null))].sort((a,b)=>a-b),
    pressWindows:windows,modalities:[...modalities],actual404Requests:errors404.length,
    banners:[...new Map(banners.map(b=>[JSON.stringify(b),b])).values()],
    pageErrors:observed.pageErrors,consoleErrorCount:actions.out.consoleErrors.length,limits:observed.summary.limits,
    cleanup:{gatewayExit:run.gatewayExit.code,browserClose:run.browserClose,storeRemoved:run.store.removed},
    artifacts:{actionsSha256:sha(await readFile(join(path,'raw/actions.json'))),observedSha256:sha(await readFile(join(path,'observed.json')))}};
  reports.push(report);
}
assert.equal(reports.length,8);
for(const group of admission.authorizedGroups)assert(reports.some(report=>report.group===group&&report.status==='pass'));
const summary={head:admission.head,tree:admission.tree,base:admission.base,actualMain:admission.actualMain,
  originalCorrectionsExhausted:2,escalationCorrectionsConsumed:2,escalationCorrectionCap:2,formalScans:0,reports};
await writeFile(join(root,'result-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(reports.map(r=>({group:r.group,status:r.status,graphs:r.persistedGraphReplays,puts:r.successfulConditionalPuts,
  windows:r.frameWindows,geometry:r.geometryMax,misses:r.fixedTargetMisses,header:r.headerHeights,holds:r.pressWindows.map(p=>[p.phase,p.holdMs]),http404:r.actual404Requests}))));
