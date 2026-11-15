import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree,cli,scenario,only] = process.argv.slice(2);
assert(existsSync(cli));
assert(/^[a-z0-9][a-z0-9-]+$/.test(scenario));
assert(only === undefined || /^[a-z0-9][a-z0-9-]+$/.test(only));
const here = dirname(fileURLToPath(import.meta.url));
const binding = JSON.parse(await readFile(join(here,'binding-before.json'),'utf8'));
const runs = join(here,'runs');
await mkdir(runs,{recursive:true});
const suffix=process.env.GG_QA_RUN_SUFFIX??'';
assert(/^$|^-fixture-[a-z0-9-]+$/.test(suffix));
const output = join(runs,scenario+suffix);
await mkdir(output);
for (const file of ['gateway.mjs','source-paths.json','binding-before.json','desktop.edge.json']) {
  await copyFile(join(here,file),join(output,file));
}
const session = 'gg237-final-'+scenario+suffix;
const uncertainty = ['committed','not-admitted'].includes(only ?? scenario);
const driver = uncertainty ? 'verify-uncertainty.playwright.js' : 'verify-save-publish.playwright.js';
await copyFile(join(here,driver),join(output,driver));
const gateway = spawn(process.execPath,[join(output,'gateway.mjs'),worktree,binding.head,
  join(output,'source-paths.json'),join(output,'binding-before.json')],{
  cwd:output,windowsHide:true,stdio:['pipe','pipe','pipe'],
});
const gatewayExit = new Promise((done)=>gateway.once('exit',(code,signal)=>done({code,signal})));
let gatewayLog = '', gatewayError = '';
gateway.stderr.on('data',(buf)=>gatewayError+=buf);
gateway.stdin.on('error',(error)=>gatewayError+=String(error));
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
    cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  let combined = '';
  child.stdout.on('data',(data)=>combined+=data);
  child.stderr.on('data',(data)=>combined+=data);
  const exited = new Promise((settled)=>child.once('close',(code,signal)=>settled({code,signal})));
  const result = await Promise.race([exited,stall(stage==='run' ? 240000 : 25000)]);
  if (result.timeout) child.kill();
  await writeFile(join(output,'browser-'+stage+'.log'),combined);
  return {stage,pid:child.pid,...result,output:combined};
}
try {
  const start = await Promise.race([ready,gatewayExit,stall(15000)]);
  assert(start.origin,JSON.stringify(start));
  assert(!/:474[78]$/.test(start.origin));
  info.origin = start.origin;
  const profile = new URLSearchParams({'qa-pid':String(gateway.pid),'qa-bundle':binding.bundle,
    'qa-profile':'237-corrected-independent-v1',[uncertainty?'qa-variant':'qa-group']:only??scenario});
  const open = await cliCall('open','open',start.origin+'/app/loops?'+profile,'--config=desktop.edge.json');
  browserOpened = true;
  info.browserPid = Number(open.output.match(/opened with pid (\d+)/)?.[1]) || null;
  assert.equal(open.code,0,open.output);
  const run = await cliCall('run','run-code','--filename='+driver);
  info.driverExit = run.code;
  assert.equal(run.code,0,run.output);
  const line = run.output.split(/\r?\n/).find((row)=>/^\{"(?:suite|origin)"/.test(row));
  assert(line,'Missing structured CLI result');
  const result = JSON.parse(line);
  await writeFile(join(output,'observed.json'),JSON.stringify(result,null,2)+'\n');
  info.failure = result.failure ?? null;
  info.finding = result.finding ?? null;
  info.failures = result.failures ?? [];
  info.outcomes = result.outcomes?.map(({active})=>active) ?? [];
  info.pageErrors = result.pageErrors ?? [];
  if (info.failure || info.finding || info.failures.length || info.pageErrors.length) process.exitCode=2;
} catch (error) {
  info.harnessError = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (browserOpened) info.browserClose = (await cliCall('close','close')).code;
  gateway.stdin.end('\n');
  info.gatewayExit = await Promise.race([gatewayExit,stall(12000)]);
  if (info.gatewayExit.timeout) { gateway.kill(); info.gatewayAfterKill = await gatewayExit; }
  info.finishedAt = new Date().toISOString();
  await writeFile(join(output,'gateway.log'),gatewayLog+gatewayError);
  await writeFile(join(output,'run.json'),JSON.stringify(info,null,2)+'\n');
  console.log(JSON.stringify(info,null,2));
}
