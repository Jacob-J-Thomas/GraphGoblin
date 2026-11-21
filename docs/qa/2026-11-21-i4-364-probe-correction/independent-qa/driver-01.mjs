import { readFile, writeFile, appendFile, mkdir, rmdir, unlink, copyFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, dirname, basename } from 'node:path';
import { EventEmitter } from 'node:events';
import cp from 'node:child_process';
import { syncBuiltinESMExports, createRequire } from 'node:module';
import net from 'node:net';

const Q = dirname(fileURLToPath(import.meta.url));
const REPO = 'G:/ggq/gg-i4-364-qa/GraphGoblin';
const S = 'G:/ggq/qa-scratch/i4-364-probe-independent-01';
const url = p => pathToFileURL(join(REPO, p)).href;
const { ClaudeHarness } = await import(url('packages/infrastructure/dist/claude/harness.js'));
const { ClaudeHarnessError } = await import(url('packages/infrastructure/dist/claude/errors.js'));
const { runClaudeProcess } = await import(url('packages/infrastructure/dist/claude/process.js'));
const HELP = '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume';
const LOST = 'Claude CLI check output could not be read.';
const STEP = ' Check that the Claude CLI starts and responds, then retry preflight.';
const CANARIES = ['OUTPUT_CANARY_Q364', 'PROMPT_CANARY_Q364', 'PATH_CANARY_Q364', 'BINARY_CANARY_Q364'];
const ID = '963a6b3b-30ad-4f26-95c1-16aed5f017a4';
const request = { workingDirectory: S, model: 'claude-opus-5-5', effort: 'xhigh', options: { sandbox: 'read-only', approval: 'never' }, turn: { prompt: CANARIES[1] } };
const result = (stdout='', extra={}) => ({ exitCode: 0, stdout, timedOut:false, aborted:false, overflow:false, ...extra });
const complete = [
 {type:'system',subtype:'init',session_id:ID,tools:['Read','Glob','Grep'],permissionMode:'dontAsk',model:request.model,apiKeySource:'none',mcp_servers:[],plugins:[],skills:[]},
 {type:'result',subtype:'success',is_error:false,session_id:ID,result:'owned harmless completion',usage:{input_tokens:2,output_tokens:3},modelUsage:{[request.model]:{}}}
];
const observations = [];
const checks = [];
let allCalls = [];
function check(name, pass, detail) { checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})}); }
function privateClosed(value) { const text=JSON.stringify(value); return CANARIES.every(x=>!text.includes(x)) && !text.includes('spawn ') && !text.includes('syscall'); }
async function save(name, value) { await writeFile(join(Q,name), JSON.stringify(value,null,2)); }
async function stage(name, fn) {
 const before=checks.length;
 try { const data=await fn(); observations.push({name,tier:data.tier??'controlled-runner',...data}); }
 catch(error) { await save('instrumentation-or-product-error.json',{stage:name,message:error.message,stack:error.stack}); throw error; }
 await save('observations-01.json',observations); await save('checks-01.json',checks);
 const failed=checks.slice(before).filter(x=>!x.pass);
 console.log(JSON.stringify({stage:name,checks:checks.length-before,failed}));
 if(failed.length) throw new Error('Product oracle failed; dependent work stopped');
}
function harnessFor({target, fault, turnFault, runner:custom, Klass=ClaudeHarness}={}) {
 const calls=[];
 const runner=async(r,on)=>{
  const kind=r.args.includes('--version')?'version':r.args.includes('--help')?'help':r.args.includes('auth')?'auth':'turn';
  const call={kind,binary:r.binary,args:[...r.args],cwd:r.cwd,stdin:r.stdin,classifyDiagnostics:r.classifyDiagnostics}; calls.push(call); allCalls.push(call);
  if(custom) return custom(r,on,kind);
  if(kind===target) return typeof fault==='function'?fault(r):fault;
  if(kind==='version')return result('2.1.285 (Claude Code)');
  if(kind==='help')return result(HELP);
  if(kind==='auth')return result('{"authMethod":"claude.ai"}');
  if(turnFault)return turnFault;
  for(const record of complete)on?.(Buffer.from(JSON.stringify(record)+'\n'));
  return result();
 };
 return {calls,harness:new Klass({platform:'win32',binary:join(S,CANARIES[3]+'.exe'),runner})};
}
async function start(harness, action) {
 const session=harness.start(request,new AbortController().signal);
 if(action)await action(session);
 const events=[]; for await(const e of session.events)events.push(e);
 const settled=await session.result.then(value=>({value}),error=>({error:{code:error.code,name:error.name,message:error.message,retriable:error.retriable}}));
 return {...settled,events};
}
async function failureCase(name, options, expected) {
 await stage(name,async()=>{
  const {harness,calls}=harnessFor(options);
  const preflight=await harness.preflight(); const turn=await start(harness);
  check(name+' state',preflight.state===expected.state,preflight.state);
  check(name+' auth fact',expected.auth===undefined?!Object.hasOwn(preflight,'authenticated'):preflight.authenticated===expected.auth,preflight.authenticated);
  check(name+' cause',preflight.problems.some(p=>p===expected.message+ (expected.step===false?'':STEP)),preflight.problems);
  check(name+' turn code',turn.error?.code===expected.code,turn.error);
  check(name+' turn detail',turn.error?.message===expected.message,turn.error);
  check(name+' no turn process',calls.every(c=>c.kind!=='turn'));
  check(name+' closed messages',privateClosed({preflight,turn}));
  check(name+' submission',turn.events.length===1 && turn.events[0].submission==='definitely-not-submitted',turn.events);
  if(expected.retriable!==undefined)check(name+' retriable',turn.error?.retriable===expected.retriable);
  return {preflight,turn,calls};
 });
}

await stage('F1-auth-partial-stdout-exit1', async()=>{
 const {harness,calls}=harnessFor({target:'auth',fault:result('{"authMethod":"claude.ai","email":"authentication@'+CANARIES[0],{exitCode:1,outputFailed:true})});
 const preflight=await harness.preflight(), turn=await start(harness);
 check('F1 unknown',preflight.state==='unknown'); check('F1 auth absent',!Object.hasOwn(preflight,'authenticated'));
 check('F1 fixed cause',preflight.problems[0]===LOST+STEP,preflight.problems);
 check('F1 fixed error',turn.error?.code==='HARNESS_TURN_FAILED' && turn.error?.message===LOST && turn.error?.retriable===false,turn.error);
 check('F1 no turn effects',calls.every(c=>c.kind!=='turn') && turn.events.length===1 && turn.events[0].submission==='definitely-not-submitted',turn.events);
 check('F1 closed messages',privateClosed({preflight,turn})); return {preflight,turn,calls};
});
for(const [name,fault] of [
 ['auth-partial-null',result('authentication '+CANARIES[0],{exitCode:null,outputFailed:true})],
 ['auth-partial-quota',result('quota exceeded '+CANARIES[0],{exitCode:1,outputFailed:true})],
 ['auth-partial-transport',result('connection refused '+CANARIES[0],{exitCode:null,outputFailed:true})],
 ['explicit-signout-incomplete',result('{"loggedIn":false}',{exitCode:1,outputFailed:true})]
]) await failureCase(name,{target:'auth',fault},{state:'unknown',message:LOST,code:'HARNESS_TURN_FAILED',retriable:false});

for(const [name,fault,message] of [
 ['help-folder-missing',result('',{exitCode:null,spawnCode:'ENOENT',startRefusal:'working-directory-missing'}),'Claude CLI could not be started because its temporary check folder does not exist.'],
 ['help-folder-file',result('',{exitCode:null,spawnCode:'ENOENT',startRefusal:'working-directory-not-directory'}),'Claude CLI could not be started because its temporary check folder is not a folder.'],
 ...['ENOENT','EACCES','UNKNOWN'].map(code=>['help-unexplained-'+code,result('',{exitCode:null,spawnCode:code}),'Claude CLI could not be started ('+code+').']),
 ...[0,1,null].map(code=>['help-output-loss-'+code,result('error: unknown option '+CANARIES[0],{exitCode:code,outputFailed:true,failureState:'cli-incompatible'}),LOST])
]) await failureCase(name,{target:'help',fault},{state:'unknown',auth:true,message,code:'HARNESS_TURN_FAILED',retriable:false});

await stage('completed-auth-and-help-controls',async()=>{
 const signedout=harnessFor({target:'auth',fault:result('{"loggedIn":false}',{exitCode:1})});
 const out=await signedout.harness.preflight();check('complete signout auth false',out.state==='auth' && out.authenticated===false,out);
 const ready=harnessFor(); const preflight=await ready.harness.preflight(),turn=await start(ready.harness);
 check('complete login ready true',preflight.state==='ready' && preflight.authenticated===true,preflight);
 check('complete harmless turn',turn.value?.finalText==='owned harmless completion' && ready.calls.filter(c=>c.kind==='turn').length===1,turn);
 const ordinary=[];
 for(const [code,extra] of [[1,{}],[null,{}],[1,{failureState:'cli-incompatible'}]]){
  const h=harnessFor({target:'help',fault:result('error: unknown option '+CANARIES[0],{exitCode:code,...extra})});
  const p=await h.harness.preflight(),t=await start(h.harness); ordinary.push({p,t,calls:h.calls});
  check('ordinary completed help wrapper '+code,p.problems.some(v=>v.startsWith('Claude CLI 2.1.285 failed the --max-turns/--help check.')),p.problems);
  check('ordinary help privacy '+code,privateClosed({p,t}));
 }
 return {out,preflight,turn,calls:ready.calls,ordinary};
});

for(const target of ['auth','help'])for(const [name,extra,code] of [
 ['termination',{terminationUnconfirmed:true},'HARNESS_TERMINATION_UNCONFIRMED'],
 ['deadline',{timedOut:true},'HARNESS_TIMEOUT'],
 ['overflow',{overflow:true},'HARNESS_OUTPUT_LIMIT'],
 ['callback',{callbackError:new ClaudeHarnessError('HARNESS_PROTOCOL_ERROR','fixed parser cause')},'HARNESS_PROTOCOL_ERROR'],
 ['start-refusal',{spawnCode:'EACCES'},'HARNESS_TURN_FAILED']
])await stage('precedence-'+target+'-'+name,async()=>{
 const {harness,calls}=harnessFor({target,fault:result('authentication '+CANARIES[0],{exitCode:1,outputFailed:true,...extra})});
 const preflight=await harness.preflight(),turn=await start(harness);
 check('stronger '+target+' '+name,code?turn.error?.code===code:turn.error?.name==='AbortError',turn.error);
 check('stronger no lost cause '+target+' '+name,!preflight.problems.some(x=>x.startsWith(LOST)),preflight.problems);
 check('stronger no print '+target+' '+name,calls.every(c=>c.kind!=='turn'));
 check('stronger privacy '+target+' '+name,privateClosed({preflight,turn}));
 return {preflight,turn,calls};
});

for(const target of ['auth','help'])await stage('actual-session-cancel-'+target,async()=>{
 let entered,release;
 const reached=new Promise(r=>{entered=r});const gate=new Promise(r=>{release=r});
 const h=harnessFor({target,fault:async r=>{entered();await gate;return result('authentication '+CANARIES[0],{exitCode:1,outputFailed:true,aborted:r.signal.aborted});}});
 const t=await start(h.harness,async session=>{await reached;const cancellation=session.cancel();release();await cancellation;});
 check('actual session cancellation '+target,t.error?.name==='AbortError',t);
 check('cancel no print '+target,h.calls.every(c=>c.kind!=='turn'));
 return {t,calls:h.calls};
});

await stage('controlled-real-runner-stderr-classifier',async()=>{
 const nativeSpawn=cp.spawn;const raw=[];let mode;
 cp.spawn=(binary,args,opts)=>{
  const child=new EventEmitter(); child.exitCode=null;child.signalCode=null;
  if(binary==='taskkill'){queueMicrotask(()=>child.emit('close',0));return child;}
  child.pid=600001;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  child.stdin.end=()=>queueMicrotask(()=>{
   child.stderr.emit('data',Buffer.from('API Error: 401 '+CANARIES[0]));
   if(mode.lost)child[mode.pipe].emit('error',Object.assign(new Error(CANARIES[0]),{code:'EPIPE'}));
   child.exitCode=mode.exit;child.emit('close',mode.exit);
  });return child;
 };syncBuiltinESMExports();
 try{
  for(const exit of [1,null])for(const pipe of ['stdout','stderr']){
   mode={lost:true,exit,pipe};
   const h=harnessFor({runner:async(r,on,kind)=>{
    if(kind!=='auth')return result(kind==='version'?'2.1.285 (Claude Code)':HELP);
    const v=await runClaudeProcess(r,on);raw.push(v);return v;
   }});
   const p=await h.harness.preflight(),t=await start(h.harness);
   check('actual stderr classifier '+exit+pipe,raw.at(-1)?.failureState==='auth' && raw.at(-1)?.outputFailed===true,raw.at(-1));
   check('actual classifier guarded '+exit+pipe,p.state==='unknown'&&!Object.hasOwn(p,'authenticated')&&p.problems[0]===LOST+STEP&&t.error?.code==='HARNESS_TURN_FAILED',{p,t});
  }
  mode={lost:false,exit:1,pipe:'stderr'};
  const h=harnessFor({runner:async(r,on,kind)=>kind==='auth'?runClaudeProcess(r,on):result(kind==='version'?'2.1.285 (Claude Code)':HELP)});
  const completeAuth=await h.harness.preflight();check('completed actual classifier remains auth',completeAuth.state==='auth'&&completeAuth.authenticated===false,completeAuth);
  return {tier:'controlled-spawn-streams-real-runner-and-classifier',raw,completeAuth};
 }finally{cp.spawn=nativeSpawn;syncBuiltinESMExports();}
});

await stage('turn-submission-recovery-controls',async()=>{
 const cases=[];
 for(const [name,turnFault,code,submission] of [
  ['lost-refusal',result('',{exitCode:1,outputFailed:true,turnRejection:'session-missing'}),'HARNESS_TURN_FAILED','delivery-uncertain'],
  ['completed-auth-refusal',result('',{exitCode:1,turnRejection:'auth'}),'HARNESS_NOT_AUTHENTICATED','definitely-not-submitted'],
  ['completed-session-missing',result('',{exitCode:1,turnRejection:'session-missing'}),'HARNESS_SESSION_MISSING','session-missing']
 ]){const h=harnessFor({turnFault});const t=await start(h.harness);cases.push({name,t,calls:h.calls});check(name+' existing outcome',t.error?.code===code&&t.events.at(-1)?.submission===submission,t);}
 return {cases};
});

await stage('native-induced-help-folder-and-success',async()=>{
 const binary=join(S,CANARIES[3]+'.exe'),cli=join(Q,'harmless-cli.mjs'),sink=join(Q,'native-sink.jsonl');
 await copyFile(process.execPath,binary);
 const source=`import {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(3);const sink=process.argv[2];\nconst help=${JSON.stringify(HELP)};\nappendFileSync(sink,JSON.stringify({pid:process.pid,argv:process.argv,cwd:process.cwd(),kind:args.includes('--print')?'turn':args.includes('--version')?'version':args.includes('--help')?'help':'auth'})+'\\n');\nif(args.includes('--version'))console.log('2.1.285 (Claude Code)');else if(args.includes('--help'))console.log(help);else if(args.includes('auth'))console.log('{"authMethod":"claude.ai"}');else {for(const record of ${JSON.stringify(complete)})console.log(JSON.stringify(record));}\n`;
 await writeFile(cli,source);
 const cases=[];
 for(const type of ['missing','file','ready']){
  const calls=[],native=[];
  const h=new ClaudeHarness({binary,platform:'win32',runner:async(r,on)=>{
   const help=r.args.includes('--help'), mutate=help&&type!=='ready';
   if(mutate){if(resolve(dirname(r.cwd))!==resolve(S)||!/^gg-claude-probe-[0-9a-f]{8}$/.test(basename(r.cwd)))throw new Error('Native ownership guard failed');await rmdir(r.cwd);if(type==='file')await writeFile(r.cwd,CANARIES[2]);}
   try{const command={...r,args:[cli,sink,...r.args]};calls.push({binary:command.binary,args:command.args,cwd:command.cwd,stdin:command.stdin});const v=await runClaudeProcess(command,on);native.push(v);return v;}
   finally{if(mutate){if(type==='file')await unlink(r.cwd);await mkdir(r.cwd);}}
  }});
  const p=await h.preflight(),t=await start(h);
  if(type==='ready'){check('native success real turn',p.state==='ready'&&t.value?.finalText==='owned harmless completion',t);check('native success single print',calls.filter(c=>c.args.includes('--print')).length===1);}
  else{const message='Claude CLI could not be started because its temporary check folder '+(type==='missing'?'does not exist.':'is not a folder.');check('native fixed '+type,p.state==='unknown'&&p.authenticated===true&&p.problems[0]===message+STEP&&t.error?.message===message,{p,t});check('native actual refusal '+type,native.some(v=>v.spawnCode==='ENOENT'&&v.startRefusal===(type==='missing'?'working-directory-missing':'working-directory-not-directory')),native);check('native no print '+type,calls.every(c=>!c.args.includes('--print')));check('native private '+type,privateClosed({p,t}));}
  cases.push({type,p,t,calls,native});
 }
 return {tier:'native-Windows-deliberately-induced-owned-check-folder',cases,sink:(await readFile(sink,'utf8')).trim().split('\n').map(JSON.parse),binarySha256:createHash('sha256').update(await readFile(binary)).digest('hex')};
});

await stage('original-bound-external-counterfactual',async()=>{
 const old=await readFile(join(Q,'original-harness.js'),'utf8');
 const transformed=old.replace(/from '([^']+)'/g,(match,spec)=>{
  if(spec.startsWith('./'))return `from '${url('packages/infrastructure/dist/claude/'+spec.slice(2))}'`;
  if(spec==='@graphgoblin/domain')return `from '${url('packages/domain/dist/index.js')}'`;
  return match;
 });
 await writeFile(join(Q,'original-external-harness.mjs'),transformed);
 const {ClaudeHarness:Original}=await import(pathToFileURL(join(Q,'original-external-harness.mjs')).href);
 const first=harnessFor({Klass:Original,target:'auth',fault:result('authentication '+CANARIES[0],{exitCode:1,outputFailed:true})});
 const p1=await first.harness.preflight();const t1=await start(first.harness);
 const second=harnessFor({Klass:Original,target:'help',fault:result('',{exitCode:null,spawnCode:'ENOENT',startRefusal:'working-directory-missing'})});
 const p2=await second.harness.preflight();const t2=await start(second.harness);
 check('counterfactual oracle rejects original F1',p1.state==='auth'&&p1.authenticated===false&&t1.error?.code==='HARNESS_NOT_AUTHENTICATED',{p1,t1});
 check('counterfactual oracle rejects original F2',p2.problems[0].startsWith('Claude CLI 2.1.285 failed the --max-turns/--help check.')&&t2.error?.message==='Claude CLI 2.1.285 failed the --max-turns/--help check.',{p2,t2});
 return {tier:'original-preserved-build-external-import-rebinding-only',originalSHA256:createHash('sha256').update(old).digest('hex'),transformedSHA256:createHash('sha256').update(transformed).digest('hex'),p1,t1,p2,t2};
});

await save('all-runner-calls-01.json',allCalls);
await save('driver-01-complete.json',{time:new Date().toISOString(),pid:process.pid,checks:checks.length,passed:checks.filter(x=>x.pass).length,remainingProbeDirectories:(await readdir(S)).filter(x=>x.startsWith('gg-claude-probe-'))});
console.log(JSON.stringify({complete:true,checks:checks.length,passed:checks.filter(x=>x.pass).length}));
