import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const built=p=>import(pathToFileURL(resolve(p)).href);
const {RunManager}=await built('packages/engine/dist/index.js');
const {createTestEngine,singleNodeLoop}=await built('packages/engine/dist/testing/index.js');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<1000;i++){if(await check())return;await delay(5);}throw Error('Probe deadline');}
const result={state:'completed',exitCode:0,stdout:'null',stderr:'',stdoutBytes:4,stderrBytes:0,stdoutOverflow:false,stderrOverflow:false,timedOut:false};
const all=[];
for(const scenario of (process.env.GG_PROBE_SCENARIO?[process.env.GG_PROBE_SCENARIO]:['running-replay','paused-replay','paused-resume'])){
 const e=await createTestEngine();e.manager.stop();
 let dispatches=0,sourceId,committed=false,releaseFailure,failScript;
 const failureGate=new Promise(r=>{releaseFailure=r;});
 const scriptGate=new Promise(r=>{failScript=r;});
 e.ports.scripts.respondWith(async()=>{
   if(++dispatches===1){await scriptGate;return {...result,state:'outcome-uncertain',exitCode:null};}
   return result;
 });
 const store=e.ports.events;
 const events={
  recoveryFacts:(...args)=>store.recoveryFacts(...args),
  read:(...args)=>store.read(...args),subscribe:(...args)=>store.subscribe(...args),
  append:async(...args)=>{
   const stored=await store.append(...args);
   if(!committed && args[0]===sourceId && stored.some(e=>e.type==='run.failed')){committed=true;await failureGate;}
   return stored;
  },
 };
 const manager=new RunManager({...e.ports,events},e.settings);
 let restarted;
 try{
  await manager.start();
  const v=e.publish(singleNodeLoop('Projection '+scenario,{id:'effect',kind:'script',label:'Effect',config:{command:'effect'}}));
  const source=await manager.startRun({ownerId:'local',loopId:v.loopId,source:'manual.api'});sourceId=source.id;
  await until(()=>dispatches===1);
  if(scenario.startsWith('paused'))await manager.pause(sourceId);
  failScript();await until(()=>committed);
  const snapshot=await manager.getSnapshot(sourceId);
  const durable=(await store.read(sourceId)).at(-1);
  assert.equal(durable.type,'run.failed');assert.equal(durable.failure.code,'SCRIPT_OUTCOME_UNCERTAIN');
  const row={scenario,snapshotStatus:snapshot.status,observedSeq:snapshot.recovery.observedSeq,durableFailureSeq:durable.seq,resume:snapshot.recovery.resume,replay:snapshot.recovery.replay.find(n=>n.nodeId==='effect').action,scriptConsent:snapshot.recovery.scriptConsent};
  try{
   const accepted=scenario.endsWith('replay')
    ?await manager.replay({runId:sourceId,nodeId:'effect',observedSeq:snapshot.recovery.observedSeq})
    :await manager.resume(sourceId,{kind:'user',id:'reviewer'},{observedSeq:snapshot.recovery.observedSeq});
   row.acceptedRunId=accepted.id;
   if(scenario.endsWith('replay'))await until(async()=>(await manager.getRun(accepted.id)).status==='succeeded');
  }catch(error){row.refusal={code:error.code,message:error.message};}
  releaseFailure();await manager.waitForIdle();
  row.after={dispatches,status:(await manager.getRun(sourceId)).status,events:(await store.read(sourceId)).map(e=>({type:e.type,seq:e.seq,retryUncertainScript:e.retryUncertainScript}))};
  if(scenario==='paused-resume'){
   manager.stop();
   restarted=new RunManager(e.ports,e.settings);await restarted.start();await restarted.waitForIdle();
   row.afterRestart={dispatches,status:(await restarted.getRun(sourceId)).status,events:(await store.read(sourceId)).map(e=>({type:e.type,seq:e.seq,retryUncertainScript:e.retryUncertainScript}))};
   row.afterRestart.recovery=await restarted.getRecovery(sourceId);
  }
  all.push(row);console.log(JSON.stringify(row));
 }finally{failScript();releaseFailure();manager.stop();restarted?.stop();}
}
await writeFile(join(dirname(fileURLToPath(import.meta.url)),process.env.GG_PROBE_SCENARIO?'failure-projection-paused-results.json':'failure-projection-race-results.json'),JSON.stringify(all,null,2)+'\n','utf8');
