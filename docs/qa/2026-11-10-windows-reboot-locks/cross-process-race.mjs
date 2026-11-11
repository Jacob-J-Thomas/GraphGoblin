import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const evidence='C:/Users/98jak/graphgoblin-qa/2026-11-10-launcher-recovery';
const candidate='C:/Users/98jak/.codex/worktrees/windows-reboot-lock-recovery/GraphGoblin/apps/api/dist/data-dir-lock.js';
const baseline='C:/Users/98jak/source/repos/GraphGoblin/apps/api/dist/data-dir-lock.js';
const identityModule='C:/Users/98jak/.codex/worktrees/windows-reboot-lock-recovery/GraphGoblin/apps/api/dist/windows-process-identity.js';
const {windowsProcessIdentity}=await import(pathToFileURL(identityModule));
const base=await mkdtemp(join(evidence,'cross-process-race-'));
const fixture=spawn(process.execPath,['-e','process.stdin.resume(); process.stdin.on("end",()=>process.exit(0));'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
const fixtureExited=new Promise(resolve=>fixture.once('exit',resolve));
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GG_') && key.toUpperCase()!=='JEV_API_KEY'));
const workerScript=`
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const {acquireDataDirLock}=await import(process.argv[1]);
try {
 const lock=await acquireDataDirLock(process.argv[2]);
 const record=JSON.parse(await readFile(join(process.argv[2],'graphgoblin.lock'),'utf8'));
 process.stdout.write(JSON.stringify({status:'acquired',pid:process.pid,observedRecord:record})+'\\n');
 process.stdin.resume();
 await new Promise(resolve=>process.stdin.once('end',resolve));
 await lock.release();
} catch(error) {process.stdout.write(JSON.stringify({status:'refused',pid:process.pid,error:error.message})+'\\n');}
`;
const runs=[];
function startContender(module,dir) {
 const child=spawn(process.execPath,['--input-type=module','-e',workerScript,pathToFileURL(module).href,dir],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:cleanEnv});
 let out='',err='';
 let settled=false;
 const exited=new Promise(resolve=>child.once('exit',resolve));
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('Contender did not report within 20s: '+child.pid+' '+err));}},20000);
  child.stdout.on('data',chunk=>{
   out+=chunk;
   const end=out.indexOf('\n');
   if(end>=0 && !settled) {settled=true;clearTimeout(timer);try{resolve(JSON.parse(out.slice(0,end)));}catch(error){reject(error);}}
  });
  child.stderr.on('data',chunk=>err+=chunk);
  child.once('error',error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
  child.once('exit',code=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error('Contender exited without result: '+code+' '+out+' '+err));}});
 });
 return {child,ready,exited};
}
try {
 const actual=await windowsProcessIdentity(fixture.pid);
 assert.match(actual,/^[1-9][0-9]{16,18}$/);
 const old=JSON.stringify({pid:fixture.pid,windowsCreationTime:(BigInt(actual)-10000000n).toString(),token:'former-owner'});
 for(const [name,module] of [['candidate-1',candidate],['candidate-2',candidate],['candidate-3',candidate],['candidate-4',candidate],['baseline',baseline]]) {
  const dir=join(base,name); await mkdir(dir);
  await writeFile(join(dir,'graphgoblin.lock'),old); await writeFile(join(dir,'graphgoblin.lock.reclaim'),old);
  const children=Array.from({length:5},()=>startContender(module,dir));
  try {
   const results=await Promise.all(children.map(worker=>worker.ready));
   const acquired=results.filter(result=>result.status==='acquired');
   for(const owner of acquired){const worker=children.find(worker=>worker.child.pid===owner.pid);assert.equal(worker.child.exitCode,null);process.kill(owner.pid,0);}
   const mainRecord=await readFile(join(dir,'graphgoblin.lock'),'utf8').catch(error=>'READ-ERROR:'+error.code);
   const guardRecord=await readFile(join(dir,'graphgoblin.lock.reclaim'),'utf8').catch(error=>'READ-ERROR:'+error.code);
   const run={name,simultaneousOwners:acquired.length,ownershipInvariant:acquired.length<=1?'PASS':'FAIL',results,mainRecord,guardRecord};
   runs.push(run); console.log(JSON.stringify(run));
  } finally {
   for(const worker of children)worker.child.stdin.end();
   await Promise.all(children.map(worker=>Promise.race([worker.exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Contender failed to stop on EOF')),5000))])));
  }
 }
 const report={runtime:process.version,base,unrelatedFixturePid:fixture.pid,runs};
 await writeFile(join(evidence,'cross-process-race-results.json'),JSON.stringify(report,null,2));
 assert.equal(fixture.exitCode,null); process.kill(fixture.pid,0);
 if(runs.some(run=>run.ownershipInvariant==='FAIL'))process.exitCode=2;
} finally {
 fixture.stdin.end();
 await Promise.race([fixtureExited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Unrelated fixture failed to stop on EOF')),5000))]);
}
