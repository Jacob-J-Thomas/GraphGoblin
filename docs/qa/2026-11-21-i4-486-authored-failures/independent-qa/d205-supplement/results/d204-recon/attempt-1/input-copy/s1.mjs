import {assert,testing,domain,recorder,withEngine,loop,turns,canon,snapshot,noAuthored,parity} from './common.mjs';
const r=recorder('s1');
const shapes=[()=>new domain.TemplateError('D205-S1-domain'),()=>Object.assign(new Error('D205-S1-name'),{name:'TemplateError'}),()=>({code:'TEMPLATE_ERROR',message:'D205-S1-object'})];
for(let i=0;i<shapes.length;i++)await r.scenario(`S1-${i+1}`,()=>withEngine(async e=>{
 const h=e.ports.harness;h.script([{accepted:true,submission:'delivery-uncertain',items:[],error:{code:'HARNESS_TURN_FAILED',message:'D205 held prior accepted task'}},{finalText:'continued successfully'}]);
 let armed=true;const calls=[];e.ports.harnesses.codex={id:'codex',preflight:()=>h.preflight(),start:(...a)=>h.start(...a),resume(id,req,signal){calls.push({id,req:structuredClone(req)});if(armed){armed=false;throw shapes[i]();}return h.resume(id,req,signal);}};
 const v=e.publish(loop(`D205 S1 ${i}`));const first=await e.runToIdle(v.loopId);assert.equal(first.failure?.code,'HARNESS_DELIVERY_UNCERTAIN');assert.equal(first.failure?.resumable,true);
 const before=turns(e.events(first.id));await e.manager.resume(first.id);const second=await e.settle(first.id);parity(e,second);noAuthored(second.failure);assert.equal(second.failure?.code,'HARNESS_TURN_FAILED');assert.equal(second.failure?.resumable,true);assert.equal(second.failure?.inference?.submission,'definitely-not-submitted');assert.equal(second.failure?.inference?.promptKind,'continuation');
 const task=turns(e.events(first.id)).at(-1);assert.notEqual(task.turnId,before[0].turnId);assert.equal(task.turnId,second.failure.inference.turnId);assert.ok(task.prompt.includes('previous turn was interrupted'));assert.equal(second.failure.inference.retry,undefined);
 await e.manager.resume(first.id);const final=await e.settle(first.id);assert.equal(final.status,'succeeded');assert.equal(h.started.length,1);assert.equal(h.resumed.length,1);assert.deepEqual(calls[0],calls[1]);assert.equal(turns(e.events(first.id)).at(-1).turnId,task.turnId);
 return {first:first.failure,second:second.failure,finalStatus:final.status,task,calls,...snapshot(e,first.id)};
}));
r.finish();
