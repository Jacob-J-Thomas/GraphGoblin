import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { CodexHarness } = await import(pathToFileURL(resolve('packages/adapter-codex/dist/index.js')));
const { createTestEngine, singleNodeLoop, FakeHarness } = await import(pathToFileURL(resolve('packages/engine/dist/testing/index.js')));
const env = Object.fromEntries(Object.entries(process.env).filter(([k,v]) => v !== undefined && !k.toUpperCase().startsWith("GG_") && !['NODE_OPTIONS','NODE_V8_COVERAGE','JEV_API_KEY','GG_JEV_API_KEY','LIVE'].includes(k)));
const rows = [];
function orders(prefix='', remaining='SEF') {
  return [prefix, ...[...remaining].flatMap((c) => orders(prefix+c, remaining.replace(c,'')))];
}
const specs = orders().flatMap(order => ['E','F','both'].filter(refusal => refusal==='both' ? /[EF]/.test(order) : order.includes(refusal)).flatMap(refusal => [0,1].map(exit => ({order,refusal,exit,text: 'Thread not found; Error: invalid value; quota; Not logged in; network'}))));
for (const spec of specs) {
  const e = await createTestEngine();
  e.ports.harnesses.codex = new CodexHarness({ codexBinary: process.execPath, env: {...env, NODE_OPTIONS: `--import=${new URL('./order-cli.mjs', import.meta.url).href}`, GG_AUDIT_ORDER: JSON.stringify(spec)} });
  try {
    const version = e.publish(singleNodeLoop(`Ordering ${spec.order} ${spec.refusal} ${spec.exit}`, {id:'work',kind:'inference',label:'Work',config:{model:'gpt-6-luna',effort:'low',prompt:{template:'Preserve this exact authored task'},harnessOptions:{sandbox:'read-only',approval:'never'}}}));
    const run = await e.runToIdle(version.loopId);
    assert.equal(run.status,'failed',JSON.stringify(run));
    assert.equal(run.failure.code,'HARNESS_TURN_FAILED',JSON.stringify(run.failure));
    assert.equal(run.failure.details.adapterCode,'HARNESS_ARGUMENTS_REJECTED');
    assert.equal(run.failure.resumable,false);
    assert.equal(run.failure.inference.submission,spec.order.includes('S') ? 'delivery-uncertain' : 'definitely-not-submitted');
    assert.ok(run.failure.message.includes(spec.text));
    const history = e.events(run.id);
    assert.equal(history.find(x=>x.type==='harness.turn').prompt,'Preserve this exact authored task');
    const state = await e.manager.getRecovery(run.id);
    assert.equal(state.resume.allowed,false);
    assert.equal(state.replay.find(x=>x.nodeId==='work').action.allowed,true);
    await assert.rejects(()=>e.manager.resume(run.id));
    assert.equal(e.events(run.id).filter(x=>x.type==='harness.turn').length,1);
    rows.push({...spec, failure:run.failure.code,adapterCode:run.failure.details.adapterCode,submission:run.failure.inference.submission,resume:false,replay:true});
  } finally {e.manager.stop();}
}
for (const family of ['codex','claude']) for (const code of ['HARNESS_ARGUMENTS_REJECTED','HARNESS_INVALID_CONFIGURATION','HARNESS_UNSUPPORTED_POLICY']) for (const accepted of [false,true]) {
  const e = await createTestEngine();
  e.ports.modelCatalog.entries.push({harness:'claude',model:'claude-opus-5-5',source:'harness',displayName:'Opus',efforts:['low'],defaultEffort:'low',enabled:true});
  const h = new FakeHarness([{accepted,submission:'definitely-not-submitted',error:{code,message:'Pinned refusal',retriable:true}}],family);
  e.ports.harnesses[family] = h;
  try {
    const v=e.publish(singleNodeLoop('Pinned '+family+code+accepted,{id:'work',kind:'inference',label:'Work',config:{harness:family,model:family==='codex'?'gpt-6-luna':'claude-opus-5-5',effort:'low',prompt:{template:'Exact task'},harnessOptions:{sandbox:'read-only',approval:'never'}}}));
    const r=await e.runToIdle(v.loopId);
    assert.equal(r.failure.code,'HARNESS_TURN_FAILED');
    assert.equal(r.failure.resumable,false);
    assert.equal(r.failure.inference.submission,accepted?'delivery-uncertain':'definitely-not-submitted');
    await assert.rejects(()=>e.manager.resume(r.id));
    const recovery=await e.manager.getRecovery(r.id);
    assert.equal(recovery.replay.find(x=>x.nodeId==='work').action.allowed,true);
    const fork=await e.manager.replay({runId:r.id,nodeId:'work',observedSeq:recovery.observedSeq});
    assert.notEqual(fork.id,r.id);
    assert.equal((await e.settle(fork.id)).status,'succeeded');
    rows.push({family,code,accepted,submission:r.failure.inference.submission,resume:false,replay:'succeeded'});
  } finally {e.manager.stop();}
}
writeFileSync(new URL('../order-matrix.log.txt',import.meta.url),JSON.stringify({passed:rows.length,rows},null,2)+'\n','utf8');
console.log('PASS '+rows.length+' refusal ordering/recovery cases; real SDK with controlled child CLI, or labelled fake harness.');
