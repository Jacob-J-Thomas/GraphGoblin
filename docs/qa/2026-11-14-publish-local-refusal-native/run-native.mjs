import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree,cli] = process.argv.slice(2);
assert(existsSync(cli));
const here = dirname(fileURLToPath(import.meta.url));
const binding = JSON.parse(await readFile(join(here,'binding-before.json'),'utf8'));
for (const name of ['gateway.json','gateway-closed.json']) {
  if (existsSync(join(here,name))) await rename(join(here,name),join(here,'pre-browser-'+name));
}
const session = 'gg237-independent-refusal';
const driver = 'verify-refusal.playwright.js';
const gateway = spawn(process.execPath,[join(here,'gateway.mjs'),worktree,binding.head,binding.base,
  join(here,'source-paths.json'),join(here,'binding-before.json')],{
  cwd:here,windowsHide:true,stdio:['pipe','pipe','pipe'],
});
const gatewayExit = new Promise((done)=>gateway.once('exit',(code,signal)=>done({code,signal})));
let gatewayLog = '', gatewayError = '';
gateway.stderr.on('data',(buf)=>gatewayError+=buf);
const stall = (ms) => new Promise((done)=>{
  const timer = setTimeout(()=>done({timeout:true}),ms);
  timer.unref();
});
const ready = new Promise((done)=>{
  gateway.stdout.on('data',(buf)=>{
    gatewayLog += buf;
    const match = /GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(gatewayLog);
    if (match) done({origin:match[1]});
  });
});
let browserOpened = false;
const info = {startedAt:new Date().toISOString(),orchestratorPid:process.pid,gatewayPid:gateway.pid,session};
async function cliCall(stage,...args) {
  const child = spawn(process.execPath,[cli,'-s='+session,...args],{
    cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  let combined = '';
  child.stdout.on('data',(data)=>combined+=data);
  child.stderr.on('data',(data)=>combined+=data);
  const exited = new Promise((settled)=>child.once('close',(code,signal)=>settled({code,signal})));
  const result = await Promise.race([exited,stall(60000)]);
  if (result.timeout) child.kill();
  await writeFile(join(here,'browser-'+stage+'.log'),combined);
  return {stage,pid:child.pid,...result,output:combined};
}
try {
  const start = await Promise.race([ready,gatewayExit,stall(15000)]);
  assert(start.origin,JSON.stringify(start));
  assert(!/:474[78]$/.test(start.origin));
  info.origin = start.origin;
  const open = await cliCall('open','open',start.origin+'/app/loops?qa-pid='+gateway.pid,'--config=desktop.edge.json');
  browserOpened = true;
  info.browserPid = Number(open.output.match(/opened with pid (\d+)/)?.[1]) || null;
  assert.equal(open.code,0,open.output);
  const run = await cliCall('run','run-code','--filename='+driver);
  info.driverExit = run.code;
  assert.equal(run.code,0,run.output);
} catch (error) {
  info.harnessError = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (browserOpened) info.browserClose = (await cliCall('close','close')).code;
  gateway.stdin.end('\n');
  info.gatewayExit = await Promise.race([gatewayExit,stall(12000)]);
  if (info.gatewayExit.timeout) { gateway.kill(); info.gatewayAfterKill = await gatewayExit; }
  info.finishedAt = new Date().toISOString();
  await writeFile(join(here,'gateway.log'),gatewayLog+gatewayError);
  await writeFile(join(here,'run.json'),JSON.stringify(info,null,2)+'\n');
  console.log(JSON.stringify(info,null,2));
}
