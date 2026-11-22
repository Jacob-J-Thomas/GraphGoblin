import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const E = import.meta.dirname;
const W = 'G:/ggq/gg-i4-364-qa/GraphGoblin';
const { runClaudeProcess } = await import(pathToFileURL(W + '/packages/infrastructure/dist/claude/process.js'));
const { ClaudeHarness } = await import(pathToFileURL(W + '/packages/infrastructure/dist/claude/index.js'));
const root = join(E, 'fixtures', 'CANARY364_NATIVE_PATH');
const binary = join(E, 'bin', 'FakeClaude.exe');
const home = join(E, 'empty-home');
const temp = join(E, 'temp');
for (const p of [root,home,temp]) await mkdir(p,{recursive:true});
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT, TEMP:temp,TMP:temp, HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home };
const good = join(root, 'ordinary'); await mkdir(good);
const file = join(root, 'file-cwd'); await writeFile(file,'ordinary data');
function ofLength(n) { let p=root; while (n-p.length-1>80) p=join(p,'d'.repeat(79)); return join(p,'e'.repeat(n-p.length-1)); }
const boundaries={}; for (const n of [258,259,260]) { boundaries[n]=ofLength(n); await mkdir(boundaries[n],{recursive:true}); }
const missingBinary=join(root,'CANARY364_ABSENT_EXE.exe');
const cases=[['ordinary',binary,good,true],['missing-cwd',binary,join(root,'missing'),false],['file-cwd',binary,file,false],...[258,259,260].map(n=>['length-'+n,binary,boundaries[n],n===258]),['absent-exe',missingBinary,good,false],['bare-name','CANARY364_UNRESOLVED_COMMAND',good,false]];
const observations=[]; const checks=[];
function check(name,pass,detail) { checks.push({name,pass,detail}); }
async function markers(){ try{return (await readFile(binary+'.starts.jsonl','utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;} }
function rawRun(bin,cwd) { return new Promise((resolve,reject)=> {const started=Date.now(); let out='',err=''; const errors=[],pipes=[]; const c=spawn(bin,['--version'],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']}); const pid=c.pid??null; const t=setTimeout(()=>{c.kill();reject(new Error('raw child timeout'));},5000); c.on('error',e=>errors.push({name:e.name,code:e.code,message:e.message,syscall:e.syscall,path:e.path,spawnargs:e.spawnargs})); for(const [name,s] of [['stdout',c.stdout],['stderr',c.stderr],['stdin',c.stdin]])s?.on('error',e=>pipes.push({name,code:e.code,message:e.message})); c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('close',(exitCode,signal)=>{clearTimeout(t);resolve({pid,exitCode,signal,stdout:out,stderr:err,errors,pipes,elapsedMs:Date.now()-started});});c.stdin.end(); }); }
for(const [name,bin,cwd,shouldStart]of cases){const before=await markers();const raw=await rawRun(bin,cwd);const after=await markers();const result=await runClaudeProcess({binary:bin,args:['--version'],cwd,env,signal:new AbortController().signal,timeoutMs:5000,maxOutputBytes:65536});const harness=new ClaudeHarness({binary:bin,env});const preflight=await harness.preflight();const s=harness.start({workingDirectory:cwd,options:{sandbox:'read-only',approval:'never'},model:'claude-opus-5-5',effort:'low',turn:{prompt:'CANARY364_PRIVATE_PROMPT'}},new AbortController().signal);const eventsPromise=(async()=>{const es=[];for await(const e of s.events)es.push(e);return es;})();const turn=await s.result.then(value=>({ok:true,value}),error=>({ok:false,code:error.code,message:error.message}));const events=await eventsPromise;const final=await markers();let pathState;try{const fs=await stat(cwd);pathState=fs.isDirectory()?'directory':'file';}catch(e){pathState=e.code;}
 observations.push({name,binary:bin,cwd,length:cwd.length,pathState,raw,runner:result,preflight,turn,events,rawMarkers:after.slice(before.length),allMarkers:final.slice(before.length)});
 check(name+' native-launch',shouldStart?raw.pid!==null&&raw.exitCode===0:raw.pid===null&&raw.errors.length===1,{pid:raw.pid,code:raw.errors[0]?.code});
 check(name+' runner-class',shouldStart?result.exitCode===0:result.spawnCode==='ENOENT',{spawnCode:result.spawnCode,startRefusal:result.startRefusal});
 if(shouldStart){check(name+' harmless-turn',turn.ok&&turn.value.finalText==='independent-harmless-success'&&final.slice(before.length).some(m=>m.kind==='turn'&&m.cwd.toLowerCase()===cwd.toLowerCase()),turn);}
 else{const expected=name==='absent-exe'?'HARNESS_NOT_INSTALLED':['missing-cwd','file-cwd'].includes(name)?'HARNESS_INVALID_CONFIGURATION':'HARNESS_TURN_FAILED';check(name+' harness-code',turn.code===expected,turn);check(name+' definitely-not-submitted',events.some(e=>e.type==='error'&&e.submission==='definitely-not-submitted'),events);check(name+' no-turn-marker',!final.slice(before.length).some(m=>m.kind==='turn'),final.slice(before.length));const publicFailure={turn,events};const serialized=JSON.stringify(publicFailure);check(name+' diagnostic-privacy',!['CANARY364','spawn ','syscall','errno'].some(canary=>serialized.includes(canary)),publicFailure);}
 console.log(name,JSON.stringify({pid:raw.pid,rawCode:raw.errors[0]?.code,runner:result.startRefusal,turn:turn.code??'success'}));
 await writeFile(join(E,'native-observations.json'),JSON.stringify({observations,checks},null,2));
}
await writeFile(join(E,'native-fixture-env.json'),JSON.stringify({node:process.version,nodePath:process.execPath,platform:process.platform,architecture:process.arch,env,root,binary,home,temp},null,2));
console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,total:checks.length}));
if(checks.some(c=>!c.pass))process.exitCode=1;
