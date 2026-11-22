import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, copyFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createConnection } from 'node:net';
const E=import.meta.dirname;
const attempt='public-attempt2';
const root=join(E,attempt); await mkdir(root);
const binary=join(root,'CANARY364_PRIVATE_EXECUTABLE.exe');
const source=join(E,'bin','PublicFakeClaude.exe'); await copyFile(source,binary);
const home=join(root,'empty-home'),temp=join(root,'temp'),data=join(root,'data');
for(const p of [home,temp,data])await mkdir(p);
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,COMSPEC:process.env.COMSPEC,PATHEXT:process.env.PATHEXT,PATH:process.env.PATH,TEMP:temp,TMP:temp,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,GG_DATA_DIR:data,GG_HOST:'127.0.0.1',GG_PORT:'0',GG_CLAUDE_BINARY:binary,GG_CODEX_BINARY:join(root,'absent-codex.exe'),GG_OLLAMA_ENABLED:'false',GG_LOG_LEVEL:'silent',GG_SWAGGER_UI:'false',GG_DEFAULTS:JSON.stringify({byHarness:{claude:{model:'claude-opus-5-5',effort:'low'}}})};
const observations=[],checks=[],transcript=[];let server,origin,port,exitPromise,serverExit;let stdout='',stderr='';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(name,pass,detail){checks.push({name,pass,detail}); console.log(name,pass?'PASS':'FAIL');}
async function save(){await writeFile(join(E,attempt+'-observations.json'),JSON.stringify({observations,checks,transcript,server:{pid:server?.pid,port,exit:serverExit,stdout,stderr}},null,2));}
async function markers(){try{return(await readFile(binary+'.starts.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return[];throw e;}}
async function poll(name,job,predicate,ms=15000){const deadline=Date.now()+ms;let value;do{value=await job();if(predicate(value))return value;await sleep(25);}while(Date.now()<deadline);throw new Error(name+' timed out: '+JSON.stringify(value));}
async function call(method,path,body){const r=await fetch(origin+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}const result={status:r.status,value};transcript.push({at:new Date().toISOString(),method,path,body,...result});return result;}
async function ok(method,path,body,expected=200){const r=await call(method,path,body);if(r.status!==expected)throw new Error(method+' '+path+' expected '+expected+' got '+JSON.stringify(r));return r.value;}
function definition(name,cwd){return{schemaVersion:4,name:'Independent364 '+name,settings:{workingDirectory:{kind:'fixed',path:cwd}},nodes:[{id:'start',kind:'trigger',label:'Start',config:{type:'manual'}},{id:'hold',kind:'wait',label:'Hold',config:{mode:'input',prompt:'Continue independent QA?'}},{id:'infer',kind:'inference',label:'Infer',config:{harness:'claude',model:'claude-opus-5-5',effort:'low',prompt:{template:'CANARY364_PRIVATE_PROMPT_ARGV'},harnessOptions:{sandbox:'read-only',approval:'never'},output:{captureTranscript:'none'}}},{id:'done',kind:'exit',label:'Done',config:{returns:'outputs.infer.value'}}],edges:[{id:'a',from:{node:'start',port:'out'},to:{node:'hold'}},{id:'b',from:{node:'hold',port:'out'},to:{node:'infer'}},{id:'c',from:{node:'infer',port:'out'},to:{node:'done'}}]};}
async function waiting(name,cwd){const created=await ok('POST','/loops',{definition:definition(name,cwd)},201);const started=await ok('POST','/loops/'+created.loop.id+'/runs',{allowDraft:true,versionId:created.draft.id},202);const run=await poll('wait '+name,()=>ok('GET','/runs/'+started.run.id),s=>s.status==='waiting');return{loop:created.loop,run};}
async function release(run){return ok('POST','/runs/'+run.id+'/input',{waitId:run.waiting.waitId,input:'continue'});}
async function terminal(id){return poll('terminal '+id,()=>ok('GET','/runs/'+id),s=>['succeeded','failed','cancelled','exhausted'].includes(s.status));}
function safeOwned(path){const absolute=resolve(path),limit=resolve(E)+sep;if(!absolute.startsWith(limit))throw new Error('Outside evidence root: '+path);return absolute;}
function diagnosticOnly(events){return events.items.filter(e=>/failed|error/.test(e.type));}
function privacy(name,value){const s=JSON.stringify(value);check(name+' fixed-diagnostic-privacy',!['CANARY364',E,'spawn ','syscall','errno','--safe-mode','--print','\n    at '].some(v=>s.includes(v)),value);}
async function failureCase(name,cwd,mode){const startMarkers=await markers();const{run}=await waiting(name,cwd);let gateObservation;
 if(mode){await writeFile(binary+'.gate-auth','hold bounded auth');const before=await markers();await release(run);const gated=await poll('auth marker '+name,markers,ms=>ms.slice(before.length).some(m=>m.kind==='auth'));gateObservation=gated.slice(before.length);await rm(safeOwned(cwd),{recursive:true});if(mode==='file')await writeFile(cwd,'synthetic file cwd');await rm(binary+'.gate-auth');}
 else await release(run);
 const snapshot=await terminal(run.id);const events=await ok('GET','/runs/'+run.id+'/events');const currentMarkers=(await markers()).slice(startMarkers.length);const expected=mode?'HARNESS_INVALID_CONFIGURATION':'HARNESS_TURN_FAILED';const diagnostics={failure:snapshot.failure,recovery:snapshot.recovery,events:diagnosticOnly(events)};
 check(name+' failure-code',snapshot.status==='failed'&&snapshot.failure?.code==='HARNESS_TURN_FAILED'&&snapshot.failure?.details?.adapterCode===expected,snapshot.failure);
 check(name+' pinned-nonresumable',snapshot.failure?.resumable===false&&snapshot.recovery.resume.allowed===false,snapshot.recovery);
 check(name+' no-turn-marker',!currentMarkers.some(m=>m.kind==='turn'),currentMarkers);
 check(name+' no-false-installation',!JSON.stringify(diagnostics).includes('HARNESS_NOT_INSTALLED')&&!JSON.stringify(diagnostics).includes('cli-missing'),diagnostics);
 check(name+' definitely-not-submitted',JSON.stringify(events.items).includes('definitely-not-submitted'),diagnosticOnly(events));
 privacy(name,diagnostics);
 const firstFailure=JSON.stringify(snapshot.failure);
 if(mode){if(mode==='file')await rm(safeOwned(cwd));await mkdir(cwd);}
 const refreshed=await ok('GET','/runs/'+run.id);check(name+' pinned-after-repair',JSON.stringify(refreshed.failure)===firstFailure&&refreshed.recovery.resume.allowed===false,refreshed.recovery);
 const resume=await call('POST','/runs/'+run.id+'/resume',{observedSeq:refreshed.recovery.observedSeq});check(name+' resume-refused',resume.status===409,resume);privacy(name+' resume',resume);
 observations.push({name,cwd,mode,gateObservation,runId:run.id,snapshot,events,currentMarkers,resume});await save();return snapshot;
}
try{
 server=spawn(process.execPath,[join(E,'api-boot.mjs')],{cwd:'G:/ggq/gg-i4-364-qa/GraphGoblin',env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 exitPromise=new Promise((resolve,reject)=>{server.once('error',reject);server.once('close',(code,signal)=>{serverExit={code,signal};resolve(serverExit);});});
 server.stdout.on('data',b=>stdout+=b);server.stderr.on('data',b=>stderr+=b);
 const ready=await poll('server readiness',()=>Promise.resolve(stdout.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}}).find(x=>x.qaReady)),Boolean,30000);port=ready.address.port;origin='http://127.0.0.1:'+port;
 check('ephemeral-loopback-isolation',ready.address.address==='127.0.0.1'&&![4747,4748].includes(port),ready);
 const preflight=await ok('GET','/harness/preflight');const claude=preflight.items.find(x=>x.harness==='claude');check('public-ready-probes',claude?.state==='ready'&&claude.ok===true,claude);privacy('public-ready',claude);
 const good=join(root,'CANARY364_GOOD_CWD');await mkdir(good);
 const goodStart=await markers();const{run:goodRun}=await waiting('good',good);await release(goodRun);const goodSnapshot=await terminal(goodRun.id);const goodMarkers=(await markers()).slice(goodStart.length);check('public-harmless-success',goodSnapshot.status==='succeeded',goodSnapshot);check('public-exact-cwd-one-turn',goodMarkers.filter(m=>m.kind==='turn').length===1&&goodMarkers.find(m=>m.kind==='turn')?.cwd.toLowerCase()===good.toLowerCase(),goodMarkers);observations.push({name:'good',snapshot:goodSnapshot,markers:goodMarkers});
 for(const mode of ['missing','file']){const cwd=join(root,'CANARY364_'+mode.toUpperCase()+'_CWD');await mkdir(cwd);await failureCase('public-'+mode+'-cwd',cwd,mode);}
 const longRoot=join(root,'CANARY364_LONG_CWD');await mkdir(longRoot);function ofLength(n){let p=longRoot;while(n-p.length-1>80)p=join(p,'d'.repeat(79));return join(p,'e'.repeat(n-p.length-1));}
 for(const n of [258,259,260]){const cwd=ofLength(n);await mkdir(cwd,{recursive:true});if(n===258){const before=await markers();const{run}=await waiting('length258',cwd);await release(run);const snapshot=await terminal(run.id),ms=(await markers()).slice(before.length);check('public-length258-success',snapshot.status==='succeeded'&&ms.filter(m=>m.kind==='turn').length===1,snapshot);observations.push({name:'public-length258',cwd,snapshot,markers:ms});}else await failureCase('public-length'+n,cwd);}
 const recoveryBefore=await markers();const{run:recoverRun}=await waiting('missing-executable',good);await rename(binary,binary+'.held');await release(recoverRun);const absentSnapshot=await terminal(recoverRun.id);const absentEvents=await ok('GET','/runs/'+recoverRun.id+'/events');check('public-absent-exe-restorable',absentSnapshot.failure?.code==='HARNESS_NOT_INSTALLED'&&absentSnapshot.failure.resumable===true&&absentSnapshot.recovery.resume.allowed===true,absentSnapshot);check('public-absent-exe-no-turn',!(await markers()).slice(recoveryBefore.length).some(m=>m.kind==='turn'),(await markers()).slice(recoveryBefore.length));check('public-absent-exe-definitely-not-submitted',JSON.stringify(absentEvents.items).includes('definitely-not-submitted'),diagnosticOnly(absentEvents));privacy('public-absent-exe',{failure:absentSnapshot.failure,recovery:absentSnapshot.recovery,events:diagnosticOnly(absentEvents)});
 const absentPreflight=await ok('GET','/harness/preflight');const missingFact=absentPreflight.items.find(x=>x.harness==='claude');check('public-absent-exe-preflight-cli-missing',missingFact?.state==='cli-missing'&&missingFact.ok===false,missingFact);privacy('public-absent-exe-preflight',missingFact);
 await rename(binary+'.held',binary);const restoredResume=await call('POST','/runs/'+recoverRun.id+'/resume',{observedSeq:absentSnapshot.recovery.observedSeq});check('public-restored-resume-admitted',restoredResume.status===200,restoredResume);const restored=await terminal(recoverRun.id);check('public-restored-resume-success',restored.status==='succeeded',restored);const restoredMarkers=(await markers()).slice(recoveryBefore.length);check('public-restored-exactly-one-actual-turn',restoredMarkers.filter(m=>m.kind==='turn').length===1,restoredMarkers);observations.push({name:'public-absent-restored',runId:recoverRun.id,absentSnapshot,absentEvents,missingFact,restoredResume,restored,markers:restoredMarkers});
 const persistentFile=await stat(join(data,'graphgoblin.db'));check('real-sqlite-file',persistentFile.isFile()&&persistentFile.size>0,{bytes:persistentFile.size});
}catch(error){observations.push({fixtureError:{name:error.name,message:error.message,stack:error.stack}});process.exitCode=1;console.error(error);}
finally{
 try{await rm(binary+'.gate-auth',{force:true});}catch{}
 if(server&&serverExit===undefined){try{const state=await ok('GET','/system/shutdown');if(state.activeRunIds?.length)await call('POST','/system/shutdown',{action:'force'});else await call('POST','/system/shutdown',{action:'drain'});await Promise.race([exitPromise,sleep(10000).then(()=>{throw new Error('shutdown exceeded 10 seconds');})]);}catch(error){observations.push({cleanupError:String(error)});server.kill();await Promise.race([exitPromise,sleep(5000)]);}}
 if(server){let absent=false;try{process.kill(server.pid,0);}catch(e){absent=e.code==='ESRCH';}check('server-process-absent',absent,{pid:server.pid,exit:serverExit});}
 if(port){const closed=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});check('listener-released',closed,{port});}
 const ms=await markers();const pids=[...new Set(ms.map(m=>m.pid))];const alive=pids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});check('fake-cli-processes-absent',alive.length===0,{recordedPids:pids,alive});
 await writeFile(join(E,attempt+'-environment.json'),JSON.stringify({runtime:process.version,node:process.execPath,env,serverPid:server?.pid,port},null,2));await writeFile(join(E,attempt+'-stdout.log'),stdout);await writeFile(join(E,attempt+'-stderr.log'),stderr);await save();
}
console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length,fixtureErrors:observations.filter(o=>o.fixtureError).length}));
if(checks.some(c=>!c.pass))process.exitCode=1;

