import {assert,recorder,withEngine,loop,snapshot,noAuthored,parity,inferEvidence,set} from './common.mjs';
const r=recorder('s4');
await r.scenario('S4-handler-serialization',()=>withEngine(async e=>{
 const cfg={output:{transforms:[{op:'set',path:'/vars/nonjson',value:{kind:'expression',jsonata:'function($v){$v}'}}]}};
 const first=await e.runToIdle(e.publish(loop('D205 handler serializer',cfg)).loopId);assert.equal(first.failure?.code,'INTERNAL_ERROR');assert.equal(first.failure?.resumable,true);inferEvidence(first.failure);noAuthored(first.failure);parity(e,first);assert.equal((await e.manager.getThread(first.id)).vars.nonjson,undefined);
 await e.manager.resume(first.id);const second=await e.settle(first.id);assert.equal(second.failure?.code,'INTERNAL_ERROR');assert.equal(e.ports.harness.started.length,1);assert.equal(e.ports.harness.resumed.length,1);assert.equal(second.failure.inference.promptKind,'continuation');noAuthored(second.failure);
 return {first:first.failure,second:second.failure,...snapshot(e,first.id)};
}));
await r.scenario('S4-executor-invalid-thread',()=>withEngine(async e=>{
 const run=await e.runToIdle(e.publish(loop('D205 executor thread validation',{output:{transforms:[set('/vars',1)]}})).loopId);assert.equal(run.failure?.code,'INTERNAL_ERROR');assert.equal(run.failure?.resumable,false);assert.equal(run.failure.inference,undefined);noAuthored(run.failure);parity(e,run);assert.deepEqual((await e.manager.getThread(run.id)).vars,{});await assert.rejects(e.manager.resume(run.id),{code:'FAILURE_NOT_RESUMABLE'});
 return {failure:run.failure,...snapshot(e,run.id)};
}));r.finish();
