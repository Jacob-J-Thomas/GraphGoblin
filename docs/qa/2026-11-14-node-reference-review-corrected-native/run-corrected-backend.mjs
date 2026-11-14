import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, 'runs', 'corrected-backend');
const files = ['corrected-gateway.mjs', 'verify-backend.mjs', 'corrected-binding-before.json'];
await mkdir(output);
for (const file of files) await copyFile(join(here,file),join(output,file));
const [launcher,driver,bindingPath] = files.map((file)=>join(output,file));
const binding = JSON.parse(await readFile(bindingPath));
assert.equal(binding.mapping.id,'273-review-correction-independent-v1');
const gateway=spawn(process.execPath,[launcher,checkout,binding.head,bindingPath],{cwd:output,windowsHide:true});
const terminated=(child)=>new Promise((done)=>child.once('close',(code,signal)=>done({code,signal})));
const timeout=(ms)=>new Promise((done)=>setTimeout(()=>done({timeout:true}),ms).unref());
const gatewayExit=terminated(gateway);
let gatewayLog='', probeLog='';
const ready=new Promise((done)=>gateway.stdout.on('data',(bytes)=>{
  gatewayLog+=bytes;
  const match=/GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(gatewayLog);
  if(match) done({origin:match[1]});
}));
gateway.stderr.on('data',(bytes)=>{gatewayLog+=bytes;});
gateway.stdin.on('error',(error)=>{gatewayLog+=String(error);});
const result={gatewayPid:gateway.pid,startedAt:new Date().toISOString()};
try{
  const admission=await Promise.race([ready,gatewayExit,timeout(20000)]);
  assert(admission.origin,JSON.stringify(admission));
  assert(!/:474[78]$/.test(admission.origin));
  result.origin=admission.origin;
  const probe=spawn(process.execPath,[driver,checkout,join(output,'gateway.json'),bindingPath,
    join(output,'observed.json'),'corrected'],{cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe']});
  result.probePid=probe.pid;
  probe.stdout.on('data',(bytes)=>{probeLog+=bytes;});
  probe.stderr.on('data',(bytes)=>{probeLog+=bytes;});
  const probeExit=terminated(probe);
  result.probeExit=await Promise.race([probeExit,timeout(120000)]);
  if(result.probeExit.timeout){probe.kill();result.probeAfterTimeout=await probeExit;}
  if(result.probeExit.code!==0)process.exitCode=2;
}catch(error){
  result.error=String(error?.stack??error);
  process.exitCode=1;
}finally{
  gateway.stdin.end('\n');
  result.gatewayExit=await Promise.race([gatewayExit,timeout(12000)]);
  if(result.gatewayExit.timeout){gateway.kill();result.gatewayAfterTimeout=await gatewayExit;}
  if(result.gatewayExit.code!==0)process.exitCode=1;
  result.finishedAt=new Date().toISOString();
  await writeFile(join(output,'gateway.log'),gatewayLog);
  await writeFile(join(output,'probe.log'),probeLog);
  await writeFile(join(output,'run.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
