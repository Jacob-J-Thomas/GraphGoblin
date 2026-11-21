import {assert,recorder,withEngine,loop,turns,snapshot,noAuthored,parity} from './common.mjs';
const r=recorder('s2');
await r.scenario('S2-D-automatic',()=>withEngine(async e=>{
 const h=e.ports.harness;h.script([{accepted:false,announceSession:false,items:[],submission:'definitely-not-submitted',error:{code:'HARNESS_TRANSPORT_FAILED',message:'D205 acknowledged before send',retriable:true}},{finalText:'retry succeeded'}]);
 const run=await e.runToIdle(e.publish(loop('D205 automatic retry')).loopId);assert.equal(run.status,'succeeded');assert.equal(h.started.length,2);assert.equal(h.resumed.length,0);assert.equal(h.cancelled.length,1);assert.deepEqual(h.started[0],h.started[1]);const ts=turns(e.events(run.id));assert.equal(ts.length,2);assert.equal(ts[0].turnId,ts[1].turnId);assert.equal(e.events(run.id).filter(x=>x.type==='run.resumed').length,0);
 return {status:run.status,turns:ts,...snapshot(e,run.id)};
}));
await r.scenario('S2-Q-no-automatic',()=>withEngine(async e=>{
 const h=e.ports.harness;h.script([{accepted:true,items:[],submission:'delivery-uncertain',error:{code:'HARNESS_TRANSPORT_FAILED',message:'D205 accepted transport lost',retriable:true}},{finalText:'explicit continuation'}]);
 const first=await e.runToIdle(e.publish(loop('D205 Q transport')).loopId);assert.equal(first.failure?.code,'HARNESS_TRANSPORT_FAILED');assert.equal(first.failure?.inference?.submission,'delivery-uncertain');assert.equal(first.failure?.resumable,true);assert.equal(h.started.length,1);assert.equal(h.resumed.length,0);parity(e,first);noAuthored(first.failure);
 await e.manager.resume(first.id);const final=await e.settle(first.id);assert.equal(final.status,'succeeded');assert.equal(h.started.length,1);assert.equal(h.resumed.length,1);assert.ok(h.resumed[0].request.turn.prompt.includes('previous turn was interrupted'));
 return {first:first.failure,finalStatus:final.status,...snapshot(e,first.id)};
}));
await r.scenario('S2-admission-timeout',()=>withEngine(async e=>{
 const h=e.ports.harness;let cw=0;let aborted=false;e.ports.harnesses.codex={id:'codex',preflight:()=>h.preflight(),start:(...a)=>h.start(...a),resume:(...a)=>h.resume(...a),contextWindow:(_req,signal)=>{cw++;return new Promise((_res,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}};
 const run=await e.runToIdle(e.publish(loop('D205 timeout before admission',{timeoutSeconds:1})).loopId);assert.equal(run.failure?.code,'INFERENCE_TIMEOUT');assert.equal(run.failure?.resumable,true);assert.equal(run.failure?.inference,undefined);assert.equal(h.started.length+h.resumed.length,0);assert.equal(turns(e.events(run.id)).length,0);assert.equal(cw,1);assert.equal(aborted,true);noAuthored(run.failure);parity(e,run);
 return {failure:run.failure,cw,aborted,...snapshot(e,run.id)};
}));r.finish();
