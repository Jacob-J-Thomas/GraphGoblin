import { writeFile, readFile, appendFile, mkdir, rmdir, unlink, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import net from 'node:net';
const Q=dirname(fileURLToPath(import.meta.url)),R='G:/ggq/gg-i4-364-qa/GraphGoblin',S='G:/ggq/qa-scratch/i4-364-probe-independent-01';
const u=p=>pathToFileURL(join(R,p)).href;
const {ClaudeHarness}=await import(u('packages/infrastructure/dist/claude/harness.js'));
const {runClaudeProcess}=await import(u('packages/infrastructure/dist/claude/process.js'));
const {createContainer}=await import(u('apps/api/dist/container.js'));
const {buildApp}=await import(u('apps/api/dist/app.js'));
const {loadConfig}=await import(u('apps/api/dist/config.js'));
const {CURRENT_DEFINITION_FORMAT}=await import(u('packages/contracts/dist/index.js'));
const binary=join(S,'BINARY_CANARY_Q364.exe'),cli=join(Q,'harmless-cli.mjs'),sink=join(Q,'api-native-sink-02.jsonl');
const dataDir=join(S,'api-data-02'),db=join(dataDir,'graphgoblin.db');
await mkdir(dataDir);
const logs=[],checks=[],cases=[],ports=[];
const save=async()=>{await writeFile(join(Q,'api-observations-02.json'),JSON.stringify({cases,checks,ports,calls,http:logs},null,2));};
function check(name,pass,detail){checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});if(!pass)throw new Error('Product oracle failed: '+name);}
const outcome=(stdout='',extra={})=>({stdout,exitCode:0,timedOut:false,aborted:false,overflow:false,...extra});
let mode='ready',arm,container,app,origin,token;const calls=[];
const harness=new ClaudeHarness({binary,platform:'win32',runner:async(r,on)=>{
 const kind=r.args.includes('--version')?'version':r.args.includes('--help')?'help':r.args.includes('auth')?'auth':'turn';
 const entry={mode,kind,binary:r.binary,args:r.args,cwd:r.cwd,stdin:r.stdin};calls.push(entry);
 if(mode==='auth-lost'&&kind==='auth')return entry.result=outcome('{"authMethod":"claude.ai","email":"authentication@OUTPUT_CANARY_API364',{exitCode:1,outputFailed:true});
 if(mode==='help-lost'&&kind==='help')return entry.result=outcome('error: unknown option OUTPUT_CANARY_API364',{exitCode:null,outputFailed:true,failureState:'cli-incompatible'});
 if(mode==='help-EACCES'&&kind==='help')return entry.result=outcome('',{exitCode:null,spawnCode:'EACCES'});
 const mutate=mode==='help-missing'&&kind==='help';
 if(mutate){if(resolve(dirname(r.cwd))!==resolve(S)||!/^gg-claude-probe-[0-9a-f]{8}$/.test(basename(r.cwd)))throw new Error('API folder ownership guard');await rmdir(r.cwd);}
 try{return entry.result=await runClaudeProcess({...r,args:[cli,sink,...r.args]},on);}
 finally{if(mutate)await mkdir(r.cwd);}
}});
const adapter={id:'claude',preflight:async()=>{const p=await harness.preflight();if(arm){const selected=arm;arm=undefined;mode=selected;}return p;},start:(r,s)=>harness.start(r,s),resume:(id,r,s)=>harness.resume(id,r,s)};
async function boot(){
 const config=loadConfig({GG_DATA_DIR:dataDir,GG_REQUIRE_API_KEY:'true',GG_PORT:'0',GG_OLLAMA_ENABLED:'false',GG_WEB_DIST:'',GG_GOBLIN_DIST:'',GG_SWAGGER_UI:'false',GG_DEFAULTS:JSON.stringify({byHarness:{claude:{model:'claude-opus-5-5',effort:'xhigh'}}})});
 container=await createContainer(config,{masterKey:Buffer.alloc(32,47),harnesses:{claude:adapter},startTimers:false});
 await container.start();app=await buildApp(container,{logger:false});await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();origin=`http://127.0.0.1:${address.port}`;ports.push(address.port);
}
async function stop(){if(app){await app.close();app=undefined;}if(container){await container.dispose();container=undefined;}}
async function call(method,path,body,auth=true){const response=await fetch(origin+path,{method,headers:{...(auth?{authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const payload=await response.json();const record={method,path,status:response.status,body:payload,authenticated:auth};logs.push(record);return record;}
async function snapshot(){
 const names=await container.handle.client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
 const count={},rows={};
 for(const row of names.rows){const name=row.name;if(!/^[a-z_]+$/.test(name))continue;count[name]=(await container.handle.client.execute(`SELECT COUNT(*) AS n FROM ${name}`)).rows[0].n;if(/^(runs|run_events|invocations|sessions|context_entries|harness_sessions|run_sessions|context_messages)$/.test(name))rows[name]=(await container.handle.client.execute(`SELECT * FROM ${name} ORDER BY rowid`)).rows;}
 return {counts:count,rows};
}
function runProjection(x){return JSON.stringify({counts:Object.fromEntries(Object.entries(x.counts).filter(([k])=>/run|invocation|session|context/.test(k))),rows:x.rows});}
function closed(value){const t=JSON.stringify(value);return !['OUTPUT_CANARY_API364','PROMPT_CANARY_API364','BINARY_CANARY_Q364','PATH_CANARY_API364','spawn ','syscall'].some(v=>t.includes(v));}
const definition={schemaVersion:CURRENT_DEFINITION_FORMAT,name:'Independent corrective public probe',nodes:[{id:'start',kind:'trigger',label:'Start',config:{type:'manual'}},{id:'infer',kind:'inference',label:'Infer',config:{harness:'claude',model:'claude-opus-5-5',effort:'xhigh',harnessOptions:{sandbox:'read-only',approval:'never'},prompt:{template:'PROMPT_CANARY_API364'}}},{id:'done',kind:'exit',label:'Done',config:{}}],edges:[{id:'e1',from:{node:'start',port:'out'},to:{node:'infer'}},{id:'e2',from:{node:'infer',port:'out'},to:{node:'done'}}]};
let loopId;
try{
 await boot();token=(await container.repos.apiKeys.create('local','independent disposable QA',['*'])).token;
 check('actual HTTP auth enforced',(await call('GET','/harness/preflight',undefined,false)).status===401);
 const created=await call('POST','/loops',{definition});check('HTTP loop created',created.status===201,created);loopId=created.body.loop.id;
 check('HTTP publish ready',(await call('POST',`/loops/${loopId}/publish`)).status===200);
 const messages={
  'auth-lost':'Claude CLI check output could not be read.',
  'help-lost':'Claude CLI check output could not be read.',
  'help-EACCES':'Claude CLI could not be started (EACCES).',
  'help-missing':'Claude CLI could not be started because its temporary check folder does not exist.'
 };
 for(const selected of Object.keys(messages)){
  const caseStart=checks.length,callStart=calls.length;mode=selected;
  const before=await snapshot();const preflight=await call('GET','/harness/preflight');const afterPreflight=await snapshot();const p=preflight.body.items.find(x=>x.harness==='claude');
  check(selected+' API preflight unknown',preflight.status===200&&p?.state==='unknown',p);
  check(selected+' API auth fact',selected==='auth-lost'?!Object.hasOwn(p,'authenticated'):p.authenticated===true,p);
  check(selected+' API fixed cause',p.problems[0]===messages[selected]+' Check that the Claude CLI starts and responds, then retry preflight.',p.problems);
  check(selected+' preflight no persisted execution',runProjection(before)===runProjection(afterPreflight),{before:before.counts,after:afterPreflight.counts});
  const rejected=await call('POST',`/loops/${loopId}/runs`,{});const afterRejected=await snapshot();
  check(selected+' refused admission',rejected.status===422&&rejected.body.code==='HARNESS_NOT_READY',rejected);
  check(selected+' refused admission no new rows',runProjection(afterPreflight)===runProjection(afterRejected));
  // Controlled admission boundary: complete actual public preflight in ready mode, then make
  // only the following actual harness start prerequisite fail. No readiness fact is faked.
  mode='ready';arm=selected;
  const started=await call('POST',`/loops/${loopId}/runs`,{});check(selected+' admitted ready snapshot',started.status===202,started);
  const runId=started.body.run.id;await container.manager.waitForIdle();
  const run=await call('GET','/runs/'+runId),events=await call('GET',`/runs/${runId}/events?limit=500`);const afterFailure=await snapshot();
  check(selected+' persisted fixed nonresumable failure',run.body.status==='failed'&&run.body.failure?.code==='HARNESS_TURN_FAILED'&&run.body.failure?.resumable===false&&run.body.failure?.message==='harness turn failed: '+messages[selected],run.body.failure);
  check(selected+' public failure privacy',closed({p,failure:run.body.failure,events:events.body.items.filter(x=>x.type==='run.failed'||x.type==='node.failed')}));
  const resume=await call('POST',`/runs/${runId}/resume`,{});const afterResume=await snapshot();
  check(selected+' same process resume refused',resume.status===409,resume);
  check(selected+' refused resume rows unchanged',runProjection(afterFailure)===runProjection(afterResume));
  check(selected+' no print submission',calls.slice(callStart).every(c=>c.kind!=='turn'),calls.slice(callStart).map(c=>({kind:c.kind,mode:c.mode})));
  check(selected+' one turn intent',events.body.items.filter(x=>x.type==='harness.turn').length===1); check(selected+' no submitted proof',events.body.items.filter(x=>x.type==='harness.submission').every(x=>x.submission==='definitely-not-submitted')); const stored={run:run.body,events:events.body};await stop();mode='ready';await boot();
  const restarted=await call('GET','/runs/'+runId),restartedEvents=await call('GET',`/runs/${runId}/events?limit=500`);const restartBefore=await snapshot();
  check(selected+' failure survives restart',JSON.stringify(stored)===JSON.stringify({run:restarted.body,events:restartedEvents.body}));
  const restartResume=await call('POST',`/runs/${runId}/resume`,{});const restartAfter=await snapshot();
  check(selected+' restarted resume refused',restartResume.status===409,restartResume);
  check(selected+' restarted refusal no rows/effects',runProjection(restartBefore)===runProjection(restartAfter)&&calls.slice(callStart).every(c=>c.kind!=='turn'));
  cases.push({selected,tier:selected==='help-missing'?'native induced folder via actual built API':'controlled runner result with actual built API',before,afterPreflight,afterRejected,afterFailure,afterResume,restartBefore,restartAfter,p,run,events,resume,restartResume,calls:calls.slice(callStart)});await save();
  console.log(JSON.stringify({scenario:selected,checks:checks.length-caseStart,pass:true}));
 }
 mode='ready';const successStart=calls.length;const success=await call('POST',`/loops/${loopId}/runs`,{});check('success admitted',success.status===202,success);await container.manager.waitForIdle();const successRun=await call('GET','/runs/'+success.body.run.id);const successEvents=await call('GET',`/runs/${success.body.run.id}/events?limit=500`);
 check('actual native harmless API success',successRun.body.status==='succeeded',successRun.body);
 check('success reaches harmless sink once',calls.slice(successStart).filter(c=>c.kind==='turn').length===1);
 const nativeSink=(await readFile(sink,'utf8')).trim().split('\n').map(JSON.parse);check('exactly one native turn effect overall',nativeSink.filter(c=>c.kind==='turn').length===1,nativeSink.filter(c=>c.kind==='turn'));
 cases.push({selected:'ready-success',tier:'native harmless executable through actual built API',successRun,successEvents,calls:calls.slice(successStart),nativeSink});
 await stop();
 const sqliteHeader=(await readFile(db)).subarray(0,16).toString();check('real disk SQLite',sqliteHeader==='SQLite format 3\0',sqliteHeader);
 const listenerChecks=[];
 for(const port of new Set(ports)){const listening=await new Promise(r=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();r(true)});socket.once('error',()=>r(false));});listenerChecks.push({port,listening});check('owned listener closed '+port,!listening);}
 await save();await writeFile(join(Q,'api-driver-02-complete.json'),JSON.stringify({time:new Date().toISOString(),pid:process.pid,checks:checks.length,passed:checks.filter(c=>c.pass).length,sqliteHeader,listenerChecks,remainingProbeDirectories:(await readdir(S)).filter(x=>x.startsWith('gg-claude-probe-'))},null,2));
 console.log(JSON.stringify({complete:true,checks:checks.length,passed:checks.filter(c=>c.pass).length}));
}catch(error){await writeFile(join(Q,'api-driver-02-error.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));await save();throw error;}
finally{await stop();}

