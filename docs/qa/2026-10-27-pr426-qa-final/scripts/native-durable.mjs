// Actual built main.js, public HTTP, disk SQLite, native fake CLI, fresh process restart.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
const rec=new L.Recorder('native-durable');
const dir=L.makeStore('native-durable');const fake=L.fakeCli(dir);
const p=(status,type,message,param)=>JSON.stringify({status,error:{type,message,...(param?{param}:{})}});
const a=p(400,'invalid_request_error','Effort A refused','reasoning.effort');
const b=p(400,'invalid_request_error','Schema B refused','response_format');
const missing=p(404,'not_found_error','No rollout found with id genuinely-new-session');
const auth=p(401,'authentication_error','Credentials expired');
const rate=p(429,'rate_limit_exceeded','Capacity unavailable');
const quota=p(429,'insufficient_quota','Capacity unavailable');
const tricky=p(400,'invalid_request_error','Thread not found in referenced input.','reasoning.effort');
const invalid=p(400,'invalid_request_error','Error: invalid value for reasoning.effort.','reasoning.effort');
const cases=[
  {name:'diagnostic-then-malformed',malformed:true,expectedText:'Failed to parse item: MALFORMED_PROTOCOL_ITEM'},
  ...[tricky,invalid].map((first,i)=>({name:'structured-refusal-'+i,first,stderr:'',expectedText:i?'Error: invalid value':'Thread not found',pinned:true})),
  ...[tricky,invalid].flatMap((first,i)=>[false,true].map(banner=>({name:'sdk-repeat-'+i+'-'+banner,first,stderr:(banner?'Banner\n':'')+first,pinned:true,expectedText:i?'Error: invalid value':'Thread not found'}))),
  {name:'repeat-new-refusal',first:a,stderr:a+'\n'+b,pinned:true,expectedText:'Schema B refused'},
  {name:'repeat-new-missing-json',first:a,stderr:a+'\n'+missing,expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'repeat-new-missing-text',first:a,stderr:a+'\nNo rollout found with id genuinely-new-session',expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'quota-repeat-auth',first:rate,stderr:rate+'\n'+auth,expectedCode:'HARNESS_NOT_AUTHENTICATED'},
  {name:'rate-new-quota-same-message',first:rate,stderr:quota,expectedCode:'HARNESS_QUOTA_EXHAUSTED',resumable:true},
  {name:'quota-new-rate-same-message',first:quota,stderr:rate,expectedCode:'HARNESS_QUOTA_EXHAUSTED',resumable:true},
  ...[tricky,invalid].flatMap((first,i)=>['SCF','SFC'].map(order=>({name:'completed-'+i+'-'+order,order,first,stderr:'ERROR: '+first,pinned:true,expectedText:i?'Error: invalid value':'Thread not found'}))),
];
const snapshots=[];let g;
function spec(c) {
  const usage={input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0};
  const events=[{type:'thread.started',thread_id:'gg-qa-426f-native-thread'},...(c.malformed?[{type:'turn.started'},{type:'error',message:'An earlier generic diagnostic'}]:[...(c.order??'SEF')].map(x=>x==='S'?{type:'turn.started'}:x==='C'?{type:'turn.completed',usage}:x==='E'?{type:'error',message:c.first}:{type:'turn.failed',error:{message:c.first}}))];
  return {events,stderr:c.stderr??'',exit:c.malformed?0:1};
}
async function settled(id) {return L.waitFor(async()=>{const run=(await g.call('/runs/'+id)).json;return run.status==='failed'&&run.recovery?.resume?.code!=='RECOVERY_STALE'?run:null;},{timeoutMs:30000,intervalMs:50});}
function check(c,run) {
  const f=run.failure;
  rec.check(c.name+': failed with expected cause',run.status==='failed'&&(!c.expectedCode||f.code===c.expectedCode)&&(!c.expectedText||f.message.includes(c.expectedText)),f);
  if(c.pinned) {
    rec.check(c.name+': pinned refusal, accepted provenance, Replay offered',f.code==='HARNESS_TURN_FAILED'&&f.details?.adapterCode==='HARNESS_ARGUMENTS_REJECTED'&&f.resumable===false&&f.inference?.submission==='delivery-uncertain'&&!f.inference?.missingSession&&run.recovery.resume.allowed===false&&run.recovery.replay.some(r=>r.nodeId==='work'&&r.action.allowed),{failure:f,recovery:run.recovery});
  }
  if(c.resumable) rec.check(c.name+': quota stays resumable',f.resumable===true&&run.recovery.resume.allowed===true,{failure:f,recovery:run.recovery});
}
try {
  g=await L.startGateway({dir,port:6739,label:'native-produce',env:fake.env,rec});
  for(const c of cases) {
    const s=spec(c);fake.mode('codex','spec');
    fs.writeFileSync(path.join(fake.cli,'spec-events.txt'),s.events.map(e=>JSON.stringify(e)).join('\n')+(c.malformed?'\nMALFORMED_PROTOCOL_ITEM':'')+'\n');
    fs.writeFileSync(path.join(fake.cli,'spec-stderr.txt'),s.stderr);fs.writeFileSync(path.join(fake.cli,'spec-exit.txt'),String(s.exit));
    const before=fake.requests().length;
    const loopId=await L.publishLoop(g.call,L.single(c.name,L.inferenceNode('work',{model:'gpt-6-luna',effort:'low',template:'Exact authored task for '+c.name})));
    const id=await L.startRun(g.call,loopId);const run=await settled(id);assert.ok(run,'Run did not settle');check(c,run);
    const events=await L.events(g.call,id);
    rec.check(c.name+': exactly one native fake turn and retained authored prompt',fake.requests().length===before+1&&events.find(e=>e.type==='harness.turn')?.prompt==='Exact authored task for '+c.name,{requests:fake.requests().slice(before)});
    if(c.pinned) {const resumed=await g.call('/runs/'+id+'/resume',{method:'POST',body:{observedSeq:run.recovery.observedSeq}});rec.check(c.name+': Resume 409 FAILURE_NOT_RESUMABLE without another turn',resumed.status===409&&resumed.json.code==='FAILURE_NOT_RESUMABLE'&&fake.requests().length===before+1,resumed.json);}
    snapshots.push({name:c.name,id,failure:run.failure,recovery:run.recovery,events});
  }
  rec.check('produce gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('native-produce-gateway.log.txt');
  const firstPid=g.pid;g=await L.startGateway({dir,port:6739,label:'native-reopen',env:fake.env,rec});
  rec.check('restart is a fresh gateway PID',g.pid!==firstPid,{firstPid,reopenedPid:g.pid});
  const requestsAtRestart=fake.requests().length;
  for(const [i,c] of cases.entries()) {
    const before=snapshots[i];const run=(await g.call('/runs/'+before.id)).json;
    check(c,run);const events=await L.events(g.call,before.id);
    rec.check(c.name+': failure, recovery and durable events identical after restart',JSON.stringify(run.failure)===JSON.stringify(before.failure)&&JSON.stringify(run.recovery)===JSON.stringify(before.recovery)&&JSON.stringify(events)===JSON.stringify(before.events),{id:before.id,failure:run.failure,recovery:run.recovery});
    if(c.pinned) {const r=await g.call('/runs/'+before.id+'/resume',{method:'POST',body:{observedSeq:run.recovery.observedSeq}});rec.check(c.name+': restarted Resume refused 409',r.status===409&&r.json.code==='FAILURE_NOT_RESUMABLE',r.json);}
  }
  rec.check('restart and refused resumes made zero extra CLI turns',fake.requests().length===requestsAtRestart,{requestsAtRestart,after:fake.requests().length});
  const quotaRun=snapshots.find(x=>x.name==='quota-new-rate-same-message');
  // A continuation must report its original provider session, unlike the generic start fixture.
  fake.mode('codex','spec');
  fs.writeFileSync(path.join(fake.cli,'spec-events.txt'),[{type:'thread.started',thread_id:'gg-qa-426f-native-thread'},{type:'turn.started'},{type:'item.completed',item:{id:'ready',type:'agent_message',text:'READY'}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(e=>JSON.stringify(e)).join('\n')+'\n');
  fs.writeFileSync(path.join(fake.cli,'spec-stderr.txt'),'');fs.writeFileSync(path.join(fake.cli,'spec-exit.txt'),'0');
  const resume=await g.call('/runs/'+quotaRun.id+'/resume',{method:'POST',body:{observedSeq:(await g.call('/runs/'+quotaRun.id)).json.recovery.observedSeq}});
  // Resume is HTTP 200. Wait for the new attempt, rather than matching the old failed snapshot.
  const resumed=await L.waitFor(async()=>{const run=(await g.call('/runs/'+quotaRun.id)).json;const evs=await L.events(g.call,quotaRun.id);return run.status==='succeeded'||(run.status==='failed'&&evs.filter(e=>e.type==='harness.turn').length>1)?run:null;},{timeoutMs:30000});
  rec.check('quota Resume is accepted and succeeds through fake CLI after restart',resume.status===200&&resumed?.status==='succeeded'&&fake.requests().length===requestsAtRestart+1,{resume:resume.status,status:resumed?.status,requests:fake.requests().slice(requestsAtRestart)});
  fs.writeFileSync(path.join(L.OUT,'native-durable-snapshots.json'),L.redact(JSON.stringify({store:dir,cases:snapshots},null,2))+'\n');
} catch(error){rec.check('native durable completed without exception',false,String(error.stack??error));}
finally{if(g){rec.check('final gateway exit 0',await g.stop()===0,g.exitCode());g.copyLog('native-reopen-gateway.log.txt');}rec.finish({caseCount:cases.length});L.cleanupStore(dir,rec);}
