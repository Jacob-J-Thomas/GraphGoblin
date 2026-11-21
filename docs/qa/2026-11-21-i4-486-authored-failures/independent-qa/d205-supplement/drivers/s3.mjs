import {assert,engine,domain,recorder,withEngine,loop,turns,snapshot,noAuthored,parity,inferEvidence,coerce,set} from './common.mjs';
const r=recorder('s3');
await r.scenario('S3-structured-timeout',()=>withEngine(async e=>{
 let calls=0;e.ports.structured={complete:(_req,signal)=>{calls++;return new Promise((_res,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
 const run=await e.runToIdle(e.publish(loop('D205 structured timeout',{output:{transforms:[coerce()]}},{structuredTimeoutMs:50})).loopId);assert.equal(run.failure?.code,'STRUCTURED_COMPLETION_TIMEOUT');assert.equal(run.failure?.resumable,true);inferEvidence(run.failure);noAuthored(run.failure);parity(e,run);assert.equal(calls,1);assert.equal(e.ports.harness.started.length,1);assert.equal(turns(e.events(run.id)).length,1);
 return {failure:run.failure,calls,recovery:await e.manager.getRecovery(run.id),...snapshot(e,run.id)};
}));
await r.scenario('S3-artifact',()=>withEngine(async e=>{
 const put=e.ports.artifacts.put.bind(e.ports.artifacts);let broken=true;let calls=0;e.ports.artifacts.put=(...a)=>{calls++;if(broken)return Promise.reject(new engine.ArtifactStoreError('ARTIFACT_WRITE_FAILED',`artifact:transcript/${'a'.repeat(64)}`));return put(...a);};
 const first=await e.runToIdle(e.publish(loop('D205 typed artifact',{output:{captureTranscript:'artifact'}})).loopId);assert.equal(first.failure?.code,'ARTIFACT_WRITE_FAILED');assert.equal(first.failure?.resumable,true);inferEvidence(first.failure);noAuthored(first.failure);parity(e,first);assert.equal((await e.manager.getThread(first.id)).artifacts.length,0);
 broken=false;await e.manager.resume(first.id);const final=await e.settle(first.id);assert.equal(final.status,'succeeded');assert.equal(e.ports.harness.started.length,1);assert.equal(e.ports.harness.resumed.length,1);assert.equal(e.ports.harness.resumed[0].sessionId,first.failure.inference.sessionId);
 return {first:first.failure,finalStatus:final.status,calls,...snapshot(e,first.id)};
}));
await r.scenario('S3-accepted-structured-external',()=>withEngine(async e=>{
 let broken=true,calls=0;e.ports.structured={complete:async()=>{calls++;if(broken)throw new domain.TemplateError('D205 structured external private');return {value:true};}};
 const first=await e.runToIdle(e.publish(loop('D205 accepted structured external',{output:{transforms:[coerce()]}})).loopId);assert.equal(first.failure?.code,'INTERNAL_ERROR');assert.equal(first.failure?.resumable,true);inferEvidence(first.failure);noAuthored(first.failure);parity(e,first);assert.ok(!JSON.stringify([first.failure,e.events(first.id)]).includes('D205 structured external private'));
 broken=false;await e.manager.resume(first.id);const final=await e.settle(first.id);assert.equal(final.status,'succeeded');assert.equal(e.ports.harness.started.length,1);assert.equal(e.ports.harness.resumed.length,1);assert.equal(e.ports.harness.resumed[0].sessionId,first.failure.inference.sessionId);
 return {first:first.failure,finalStatus:final.status,calls,...snapshot(e,first.id)};
}));
await r.scenario('S3-output-coerce-prompt',()=>withEngine(async e=>{
 let calls=0;e.ports.structured={complete:async()=>{calls++;return {value:true};}};
 const run=await e.runToIdle(e.publish(loop('D205 output coerce prompt',{output:{transforms:[coerce('/vars/repaired',{prompt:"{% include 'D205-PATH-coerce' %}"})]}})).loopId);assert.equal(run.failure?.code,'MUTATION_ERROR');assert.equal(run.failure?.resumable,false);assert.equal(run.failure?.details?.boundary,'inference.output.transforms');assert.equal(run.failure?.details?.operationKind,'coerce');assert.equal(run.failure?.details?.phase,'after-result');assert.ok(run.failure?.message.includes('received the provider result'));inferEvidence(run.failure);parity(e,run);assert.equal(calls,0);await assert.rejects(e.manager.resume(run.id),{code:'FAILURE_NOT_RESUMABLE'});
 return {failure:run.failure,calls,...snapshot(e,run.id)};
}));
for(const phase of ['input','output'])await r.scenario(`S3-${phase}-coerce-write`,()=>withEngine(async e=>{
 let calls=0;e.ports.structured={complete:async()=>{calls++;return {value:true};}};const ops=[set('/vars/prior',1),{...coerce('/vars/prior/invalid'),...(phase==='input'?{source:'/vars/raw'}:{})}];if(phase==='input')ops.unshift(set('/vars/raw','not boolean'));
 const cfg=phase==='input'?{input:ops}:{output:{transforms:ops}};const run=await e.runToIdle(e.publish(loop(`D205 ${phase} coerce write`,cfg)).loopId);assert.equal(run.failure?.code,'MUTATION_ERROR');assert.equal(run.failure?.resumable,false);assert.equal(run.failure?.details?.operationKind,'coerce');assert.equal(run.failure?.details?.cause?.code,'PATCH_ERROR');assert.equal(run.failure?.details?.boundary,phase==='input'?'inference.input':'inference.output.transforms');assert.equal(calls,1);assert.equal(e.ports.harness.started.length,phase==='input'?0:1);if(phase==='output'){assert.equal(run.failure.details.phase,'after-result');inferEvidence(run.failure);}else{assert.equal(run.failure.inference,undefined);assert.equal(turns(e.events(run.id)).length,0);}parity(e,run);await assert.rejects(e.manager.resume(run.id),{code:'FAILURE_NOT_RESUMABLE'});
 return {failure:run.failure,calls,...snapshot(e,run.id)};
}));r.finish();
