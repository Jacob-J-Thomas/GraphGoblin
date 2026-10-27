import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const imported=(p)=>import(pathToFileURL(resolve(p)));
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!k.startsWith('GG_')&&!['LIVE','JEV_API_KEY','NODE_OPTIONS','NODE_V8_COVERAGE'].includes(k)));
const raw=(status,type,message,param)=>JSON.stringify({status,error:{type,message,...(param?{param}: {})}});
const a=raw(400,'invalid_request_error','Effort A refused','reasoning.effort');
const b=raw(400,'invalid_request_error','Schema B refused','response_format');
const m=raw(404,'not_found_error','No rollout found with id genuinely-new-session');
const tricky=raw(400,'invalid_request_error','Thread not found in referenced input.','reasoning.effort');
const cases=[
  {name:'repeat-then-new-refusal',order:'SF',stream:a,stderr:a+'\n'+b,expected:'Schema B refused'},
  {name:'repeat-then-new-missing',order:'SF',stream:a,stderr:a+'\n'+m,expectedCode:'HARNESS_SESSION_MISSING'},
  {name:'completed-before-refusal',order:'SCF',stream:tricky,stderr:'ERROR: '+tricky,expectedCode:'HARNESS_TURN_FAILED'},
  {name:'completed-after-refusal',order:'SFC',stream:tricky,stderr:'ERROR: '+tricky,expectedCode:'HARNESS_TURN_FAILED'},
];
const [phase,store,index,runId]=process.argv.slice(2);
if(phase){
  const {createContainer,loadConfig}=await imported('apps/api/dist/index.js');
  const {buildApp}=await imported('apps/api/dist/app.js');
  const {CodexHarness}=await imported('packages/adapter-codex/dist/index.js');
  const {FakeHarness,FakeDecider,FakeStructured,FakeClassifierRegistry,CapturingLogger}=await imported('packages/engine/dist/testing/index.js');
  const spec=cases[Number(index)];const ready=new FakeHarness();
  const events=[{type:'thread.started',thread_id:'durable-r3-thread'},...[...spec.order].map(x=>x==='S'?{type:'turn.started'}:x==='C'?{type:'turn.completed',usage:{input_tokens:1,output_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,reasoning_output_tokens:0}}:{type:'turn.failed',error:{message:spec.stream}})];
  const native=new CodexHarness({codexBinary:process.execPath,env:{...env,NODE_OPTIONS:`--import=${new URL('./fixture-cli.mjs',import.meta.url).href}`,GG_AUDIT_SPEC:JSON.stringify({events,stderr:spec.stderr,exit:1})}});
  const codex=phase==='read'?ready:{id:'codex',preflight:()=>ready.preflight(),start:(...a)=>native.start(...a),resume:(...a)=>native.resume(...a)};
  const container=await createContainer(loadConfig({GG_DATA_DIR:store,GG_HOST:'127.0.0.1',GG_PORT:'6733',GG_REQUIRE_API_KEY:'false',GG_WEB_DIST:'',GG_MASTER_KEY:Buffer.alloc(32,7).toString('base64')}),{harnesses:{codex},deciders:[new FakeDecider('codex')],structured:new FakeStructured(),classifiers:new FakeClassifierRegistry(),startTimers:false,logger:new CapturingLogger(),storageCapacity:{read:async()=>({totalBytes:100*1024**3,availableBytes:50*1024**3})}});
  await container.start();const app=await buildApp(container,{logger:false});await app.listen({host:'127.0.0.1',port:6733});
  process.send({ready:true,pid:process.pid,phase,runId});
  process.stdin.once('data',async()=>{await app.close();await container.dispose();process.disconnect();});
}else{
  const {singleNodeLoop}=await imported('packages/engine/dist/testing/index.js');const rows=[];
  const api=async(path,body)=>{const r=await fetch('http://127.0.0.1:6733'+path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
  async function boot(args){const c=fork(fileURLToPath(import.meta.url),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe','ipc']});let log='';c.stdout.on('data',x=>log+=x);c.stderr.on('data',x=>log+=x);await Promise.race([once(c,'message'),once(c,'exit').then(([code])=>{throw Error('Gateway exited early '+code+': '+log);})]);return c;}
  async function stop(c){const done=once(c,'exit');c.stdin.end('stop\n');const [code]=await done;assert.equal(code,0);}
  for(const [i,spec] of cases.entries()){
    const store=mkdtempSync(join(tmpdir(),'gg-qa-426f-scan3-durable-'));let child=await boot(['produce',store,String(i)]);let row;
    try{
      const definition=singleNodeLoop(spec.name,{id:'work',kind:'inference',label:'Work',config:{model:'gpt-6-luna',effort:'low',prompt:{template:'Exact authored task'}}});
      const created=await api('/loops',{definition});assert.equal(created.status,201);const loopId=created.body.loop.id;
      assert.equal((await api(`/loops/${loopId}/publish`,{})).status,200);const started=await api(`/loops/${loopId}/runs`,{input:null});assert.equal(started.status,202);const id=started.body.run.id;
      let run;const until=Date.now()+30000;do{run=(await api(`/runs/${id}`)).body;if(run.status==='failed'&&run.recovery.resume.code!=='RECOVERY_STALE')break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<until);assert.equal(run.status,'failed');assert.notEqual(run.recovery.resume.code,'RECOVERY_STALE');
      const resume=await api(`/runs/${id}/resume`,{observedSeq:run.recovery.observedSeq});
      row={name:spec.name,store:store.replace(process.env.USERPROFILE,'%USERPROFILE%'),producedPid:child.pid,id,failure:run.failure,recovery:run.recovery,resumeStatus:resume.status,resumeCode:resume.body.code};
    }finally{await stop(child);}
    child=await boot(['read',store,String(i),row.id]);try{const reopened=(await api(`/runs/${row.id}`)).body;assert.deepEqual(reopened.failure,row.failure);assert.deepEqual(reopened.recovery,row.recovery);rows.push({...row,reopenedPid:child.pid,identicalAfterRestart:true});}finally{await stop(child);}
  }
  writeFileSync(new URL('../durable-http.log.txt',import.meta.url),JSON.stringify({rows},null,2)+'\n','utf8');
  console.log(JSON.stringify(rows.map(r=>({name:r.name,code:r.failure.code,message:r.failure.message,submission:r.failure.inference.submission,resumeCode:r.resumeCode,identicalAfterRestart:r.identicalAfterRestart})),null,2));
}
