// Focused native quota recovery. The fake preserves the requested session ID on continuation.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('quota-recovery');let g;
const dir=L.makeStore('quota-recovery');const fake=L.fakeCli(dir);
const thread='gg-qa-426f-quota-session';
function setSpec(events,exit) {
  fake.mode('codex','spec');
  fs.writeFileSync(path.join(fake.cli,'spec-events.txt'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');
  fs.writeFileSync(path.join(fake.cli,'spec-stderr.txt'),'');fs.writeFileSync(path.join(fake.cli,'spec-exit.txt'),String(exit));
}
try {
  const rate=JSON.stringify({status:429,error:{type:'rate_limit_exceeded',message:'Recoverable quota failure'}});
  setSpec([{type:'thread.started',thread_id:thread},{type:'turn.started'},{type:'error',message:rate},{type:'turn.failed',error:{message:rate}}],1);
  g=await L.startGateway({dir,port:6737,label:'quota-fail',env:fake.env,rec});
  const loop=await L.publishLoop(g.call,L.single('Quota restart recovery',L.inferenceNode('work',{model:'gpt-6-luna',effort:'low',template:'Exact authored quota task'})));
  const id=await L.startRun(g.call,loop);
  const failed=await L.waitFor(async()=>{const r=(await g.call('/runs/'+id)).json;return r.status==='failed'&&r.recovery?.resume?.allowed?r:null;},{timeoutMs:30000});
  rec.check('quota failure is resumable',failed?.failure?.code==='HARNESS_QUOTA_EXHAUSTED'&&failed.failure.resumable&&fake.requests().length===1,failed);
  rec.check('first gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('quota-recovery-before-gateway.log.txt');
  const firstPid=g.pid;g=await L.startGateway({dir,port:6737,label:'quota-resume',env:fake.env,rec});
  const reopened=(await g.call('/runs/'+id)).json;
  rec.check('fresh gateway retains quota failure and Resume permission',g.pid!==firstPid&&JSON.stringify(reopened.failure)===JSON.stringify(failed.failure)&&reopened.recovery.resume.allowed,{firstPid,reopenedPid:g.pid,failure:reopened.failure,recovery:reopened.recovery});
  setSpec([{type:'thread.started',thread_id:thread},{type:'turn.started'},{type:'item.completed',item:{id:'ready',type:'agent_message',text:'READY'}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}],0);
  const resume=await g.call('/runs/'+id+'/resume',{method:'POST',body:{observedSeq:reopened.recovery.observedSeq}});
  const done=await L.waitFor(async()=>{const r=(await g.call('/runs/'+id)).json;return r.status==='succeeded'?r:null;},{timeoutMs:30000});
  const evs=await L.events(g.call,id);
  rec.check('quota Resume returns HTTP 200 and succeeds on its original provider session',resume.status===200&&done?.status==='succeeded'&&fake.requests().length===2&&fake.requests()[1].resume===true,{http:resume.status,body:resume.json,finalRun:done??(await g.call('/runs/'+id)).json,events:evs,requests:fake.requests()});
}catch(error){rec.check('quota recovery completed without exception',false,String(error.stack??error));}
finally{if(g){rec.check('final gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('quota-recovery-after-gateway.log.txt');}rec.finish();L.cleanupStore(dir,rec);}
