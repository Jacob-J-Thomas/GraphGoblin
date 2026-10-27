import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const evidence={};
const markerA=path.join(L.ROOT,'parent-effect-a');
const markerB=path.join(L.ROOT,'parent-effect-b');
const releaseA=path.join(L.ROOT,'parent-release-a');
const releaseB=path.join(L.ROOT,'parent-release-b');
const count=(p)=>fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).length:0;
let api;
try {
  api=await L.startApi('parent-store',6655);
  const childLoop=await L.publish(api,L.loop('Pending child consent',[
    L.scriptNode(path.join(L.RECORD,'effect.mjs'),['hold',markerA,releaseA],'a'),
    L.scriptNode(path.join(L.RECORD,'effect.mjs'),['hold',markerB,releaseB],'b'),
  ]));
  const parentLoop=await L.publish(api,L.loop('Pending parent consent',[
    {id:'sub',kind:'subloop',label:'Child',config:{loopRef:{loopId:childLoop}}},
  ]));
  const parent=await L.run(api,parentLoop);
  await L.until(()=>count(markerA)===1);
  await api.kill();
  fs.writeFileSync(releaseA,'release original');
  api=await L.startApi('parent-store',6655,{},path.join(L.RECORD,'pending-parent.fixture.mjs'));
  const reviewed=await L.state(api,parent.id,['failed']);
  assert.equal(reviewed.failure.code,'SCRIPT_OUTCOME_UNCERTAIN');
  const childId=reviewed.failure.details.childRunId;
  const childA=await api.get(`/runs/${childId}`);
  const failureA=(await L.events(api,childId)).findLast(e=>e.type==='run.failed');
  evidence.reviewed={parent:reviewed,child:childA,failureA};
  const pending=api.call('POST',`/runs/${parent.id}/resume`,{observedSeq:reviewed.recovery.observedSeq,retryUncertainScript:true}).catch(e=>({connectionError:String(e)}));
  const commitPath=path.join(api.dir,'resume-committed.json');
  await L.until(()=>fs.existsSync(commitPath));
  const intent=JSON.parse(fs.readFileSync(commitPath,'utf8'));
  assert.equal(intent.childRecovery.runId,childId);
  assert.equal(intent.childRecovery.failureSeq,failureA.seq);
  assert.equal(intent.childRecovery.observedSeq,childA.recovery.observedSeq);
  const pendingChild=await api.get(`/runs/${childId}`);
  assert.equal(pendingChild.recovery.resume.code,'PARENT_RECOVERY_REQUIRED');
  for(const action of ['resume','replay']){
    const refusal=await api.call('POST',`/runs/${childId}/${action}`,{observedSeq:pendingChild.recovery.observedSeq,retryUncertainScript:true,...(action==='replay'?{nodeId:'a'}:{})});
    assert.equal(refusal.status,409);
    assert.equal(refusal.body.code,'PARENT_RECOVERY_REQUIRED');
  }
  evidence.committedIntent=intent;
  await api.kill();
  evidence.lostAcknowledgement=await pending;
  api=await L.startApi('parent-store',6655);
  await L.until(()=>count(markerB)===1);
  assert.equal(count(markerA),2);
  await api.kill();
  fs.writeFileSync(releaseB,'release original');
  api=await L.startApi('parent-store',6655);
  const changed=await L.state(api,parent.id,['failed']);
  const childB=await api.get(`/runs/${childId}`);
  assert.equal(childB.failure.nodeId,'b');
  assert.equal(count(markerA),2);
  assert.equal(count(markerB),1);
  const stale=await api.call('POST',`/runs/${parent.id}/resume`,{observedSeq:reviewed.recovery.observedSeq,retryUncertainScript:true});
  assert.equal(stale.status,409);
  assert.equal(stale.body.code,'RECOVERY_STALE');
  const unconsented=await api.call('POST',`/runs/${parent.id}/resume`,{observedSeq:changed.recovery.observedSeq});
  assert.equal(unconsented.status,409);
  assert.equal(unconsented.body.code,'SCRIPT_CONSENT_REQUIRED');
  await api.post(`/runs/${parent.id}/resume`,{observedSeq:changed.recovery.observedSeq,retryUncertainScript:true});
  const completed=await L.state(api,parent.id,['succeeded']);
  assert.equal(count(markerA),2);
  assert.equal(count(markerB),2);
  assert.equal((await api.get(`/runs/${childId}`)).status,'succeeded');
  assert.deepEqual((await api.get(`/runs?parent=${parent.id}`)).items.map(r=>r.id),[childId]);
  evidence.final={parent:completed,child:await api.get(`/runs/${childId}`),countA:count(markerA),countB:count(markerB),stale,unconsented};
  L.check('real restart while bound parent recovery is pending preserves exact consent and one child',true);
  L.check('new uncertain child failure after restart requires fresh parent observation and consent',true);
} catch(error){
  evidence.error=L.redact(error.stack);
  L.check('pending parent native scenario completed',false,evidence.error);
} finally {
  fs.writeFileSync(releaseA,'release');fs.writeFileSync(releaseB,'release');
  await L.cleanup();
  L.save('pending-parent-results.json',{checks:L.checks,evidence});
}
process.exitCode=L.checks.some(c=>!c.passed)?1:0;
