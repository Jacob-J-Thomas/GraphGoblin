import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree,cli,phase,scenario,commit='pointer',bindingFile] = process.argv.slice(2);
assert(existsSync(cli));
assert(['before','corrected'].includes(phase));
assert(['rows','warning','held-json'].includes(scenario));
assert(['pointer','enter'].includes(commit));
const here = dirname(fileURLToPath(import.meta.url));
const selectedBinding=bindingFile??(phase==='before'?'ae8-artifacts-before.json':'binding-before.json');
assert(/^(?:ae8-artifacts-before|binding-before)\.json$/.test(selectedBinding));
const binding = JSON.parse(await readFile(join(here,selectedBinding),'utf8'));
assert.equal(phase==='before',binding.evidenceMode==='ae8 immutable-source / retained compiled-artifact baseline');
const token=phase+'-'+scenario+(scenario==='rows' ? '-'+commit : '');
await mkdir(join(here,'runs'),{recursive:true});
const output = join(here,'runs',token);
await mkdir(output);
for (const name of ['gateway.mjs','desktop.edge.json','verify-review-correction.playwright.js']) {
  await copyFile(join(here,name),join(output,name));
}
await copyFile(join(here,selectedBinding),join(output,'binding-before.json'));
const session = 'gg273-review-'+token;
const driver = 'verify-review-correction.playwright.js';
const gateway = spawn(process.execPath,[join(output,'gateway.mjs'),worktree,binding.head,
  join(output,'binding-before.json')],{
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
const info = {startedAt:new Date().toISOString(),orchestratorPid:process.pid,gatewayPid:gateway.pid,session,phase,scenario,commit};
async function cliCall(stage,...args) {
  const child = spawn(process.execPath,[cli,'-s='+session,...args],{
    cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],
  });
  let combined = '';
  child.stdout.on('data',(data)=>combined+=data);
  child.stderr.on('data',(data)=>combined+=data);
  const exited = new Promise((settled)=>child.once('close',(code,signal)=>settled({code,signal})));
  const result = await Promise.race([exited,stall(stage==='run' ? 150000 : 25000)]);
  if (result.timeout) child.kill();
  await writeFile(join(output,'browser-'+stage+'.log'),combined);
  return {stage,pid:child.pid,...result,output:combined};
}
try {
  const start = await Promise.race([ready,gatewayExit,stall(15000)]);
  assert(start.origin,JSON.stringify(start));
  assert(!/:474[78]$/.test(start.origin));
  info.origin = start.origin;
  const parameters = new URLSearchParams({'qa-pid':String(gateway.pid),'qa-bundle':binding.bundle,
    'qa-scenario':scenario,'qa-phase':phase,'qa-commit':commit});
  const open = await cliCall('open','open',start.origin+'/app/loops?'+parameters,'--config=desktop.edge.json');
  browserOpened = true;
  info.browserPid = Number(open.output.match(/opened with pid (\d+)/)?.[1]) || null;
  assert.equal(open.code,0,open.output);
  const run = await cliCall('run','run-code','--filename='+driver);
  info.driverExit = run.code;
  assert.equal(run.code,0,run.output);
  const line = run.output.split(/\r?\n/).find((row)=>row.startsWith('{"origin"'));
  assert(line,'CLI did not return structured browser evidence');
  const observed = JSON.parse(line);
  await writeFile(join(output,'observed.json'),JSON.stringify(observed,null,2)+'\n');
  info.outcome = observed.outcome;
  info.failure = observed.failure;
  info.pageErrors = observed.pageErrors.length;
  if (info.failure || info.pageErrors || !info.outcome ||
      (phase==='before' && !info.outcome.finding) || (phase==='corrected' && info.outcome.finding)) process.exitCode = 2;
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
