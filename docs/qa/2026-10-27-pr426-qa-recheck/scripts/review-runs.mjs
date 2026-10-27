// Review defects through the built HTTP API and real Codex SDK, using only fake CLIs.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('review-runs');
const dir=L.makeStore('review');
const fake=L.fakeCli(dir);
let g,browser;
const outcomes={};
try {
  g=await L.startGateway({dir,port:6719,label:'review',env:fake.env,rec});
  for(const mode of ['parse','invalid-value','missing-thread-text','refused']) {
    if(mode==='refused') await L.withDb(dir,db=>db.execute("UPDATE model_catalog SET efforts = '[\"minimal\",\"low\",\"medium\",\"high\",\"xhigh\",\"max\"]' WHERE harness = 'codex' AND model = 'gpt-6-luna'"));
    fake.mode('codex',mode);
    const effort=mode==='refused'?'minimal':'low';
    const loopId=await L.publishLoop(g.call,L.single('QA recheck '+mode,L.inferenceNode('work',{model:'gpt-6-luna',effort})));
    const before=fake.requests().length;
    const runId=await L.startRun(g.call,loopId);
    const done=await L.waitRun(g.call,runId,['failed','succeeded','cancelled'],30_000);
    const evs=await L.events(g.call,runId);
    const snap=(await g.call(`/runs/${runId}`)).json;
    const requests=fake.requests().slice(before);
    outcomes[mode]={runId,status:done.status,failure:done.failure,recovery:snap.recovery,events:evs,requests};
    rec.log(mode,outcomes[mode]);
    rec.check(`${mode}: exactly one fake turn with authored effort`,requests.length===1 && requests[0].model==='gpt-6-luna' && requests[0].effort===effort,requests);
    if(mode==='parse') {
      rec.check('B1: durable failure names SDK parse failure',done.status==='failed' && done.failure?.message.includes('Failed to parse item: MALFORMED_PROTOCOL_ITEM') && !done.failure?.message.includes('An earlier generic diagnostic'),done.failure);
    } else {
      const text=mode==='invalid-value'?"Error: invalid value for reasoning.effort: 'minimal'.":mode==='missing-thread-text'?'Thread not found in referenced input.':"Unsupported value: 'minimal'";
      rec.check(`${mode}: refusal remains HARNESS_TURN_FAILED / HARNESS_ARGUMENTS_REJECTED with exact provider reason`,done.status==='failed' && done.failure?.code==='HARNESS_TURN_FAILED' && done.failure?.details?.adapterCode==='HARNESS_ARGUMENTS_REJECTED' && done.failure?.message.includes(text) && !JSON.stringify(snap).includes('HARNESS_SESSION_MISSING'),done.failure);
      rec.check(`${mode}: no Resume; retained acceptance and delivery uncertainty`,done.failure?.resumable===false && snap.recovery?.resume?.allowed===false && done.failure?.inference?.submission==='delivery-uncertain' && evs.some(e=>e.type==='harness.submission' && e.submission==='submitted' && e.marker==='codex.turn.started'),{failure:done.failure,recovery:snap.recovery});
      const resume=await g.call(`/runs/${runId}/resume`,{method:'POST',body:{observedSeq:snap.recovery.observedSeq}});
      rec.check(`${mode}: Resume is 409 and makes no further turn`,resume.status===409 && fake.requests().length===before+1,{status:resume.status,body:resume.json});
    }
    rec.check(`${mode}: startup banner absent from record and durable events`,!JSON.stringify({snap,evs}).includes('Reading prompt from stdin'),null);
    if(mode==='refused') {
      rec.check('ordinary minimal: original refusal prefix, Replay available',done.failure?.message.startsWith("harness turn failed: The provider refused the request (HTTP 400, reasoning.effort): Unsupported value: 'minimal'") && snap.recovery?.replay?.some(r=>r.nodeId==='work' && r.action.allowed),done.failure);
      browser=await L.launchEdge();
      const page=await browser.newPage({viewport:{width:1440,height:1100}});
      await page.goto(`${g.origin}/app/runs/${runId}`);
      await page.getByRole('button',{name:'Replay...',exact:true}).waitFor({timeout:30_000});
      const resumeButton=page.getByRole('button',{name:'Resume',exact:true});
      const replayButton=page.getByRole('button',{name:'Replay...',exact:true});
      const text=await page.locator('body').innerText();
      rec.check('ordinary minimal: inspector names refusal, disables Resume, enables Replay',text.includes('HARNESS_TURN_FAILED') && text.includes("Unsupported value: 'minimal'") && await resumeButton.isDisabled() && await replayButton.isEnabled(),text.slice(0,5000));
      await L.shot(page,'refused-minimal-inspector');
      await browser.close(); browser=undefined;
    }
  }
  rec.check('gateway drains to exit 0',await g.stop()===0,g.exitCode());
} catch(error) { rec.check('scenario completed without exception',false,String(error.stack??error)); }
finally {
  await browser?.close().catch(()=>{});
  if(g) {await g.stop();g.copyLog('review-gateway.log.txt');}
  fs.writeFileSync(path.join(L.OUT,'review-run-snapshots.json'),L.redact(JSON.stringify(outcomes,null,2))+'\n');
  rec.finish();L.cleanupStore(dir,rec);
}
