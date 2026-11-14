import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout, label = 'before-backend'] = process.argv.slice(2);
assert(/^before-backend(?:-[a-z0-9]+)?$/.test(label));
const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, 'runs', label);
await mkdir(output);
for (const file of ['gateway.mjs', 'verify-backend.mjs', 'ae8-artifacts-before.json']) {
  await copyFile(join(here, file), join(output, file));
}
const binding = JSON.parse(await readFile(join(output, 'ae8-artifacts-before.json')));
let gatewayLog = '', probeLog = '';
const gateway = spawn(process.execPath, [join(output, 'gateway.mjs'), checkout, binding.head,
  join(output, 'ae8-artifacts-before.json')], { cwd: output, windowsHide: true });
const completed = (child) => new Promise((done) => child.once('close', (code, signal) => done({ code, signal })));
const gatewayExit = completed(gateway);
const ready = new Promise((done) => gateway.stdout.on('data', (bytes) => {
  gatewayLog += bytes;
  const match = /GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(gatewayLog);
  if (match) done({ origin: match[1] });
}));
gateway.stderr.on('data', (bytes) => { gatewayLog += bytes; });
gateway.stdin.on('error', (error) => { gatewayLog += String(error); });
const stall = (ms) => new Promise((done) => setTimeout(() => done({ timeout: true }), ms).unref());
const result = { gatewayPid: gateway.pid, startedAt: new Date().toISOString() };
try {
  const admission = await Promise.race([ready, gatewayExit, stall(20000)]);
  assert(admission.origin, JSON.stringify(admission));
  assert(!/:474[78]$/.test(admission.origin));
  result.origin = admission.origin;
  const probe = spawn(process.execPath, [join(output, 'verify-backend.mjs'), checkout, join(output, 'gateway.json'),
    join(output, 'ae8-artifacts-before.json'), join(output, 'observed.json'), 'before'], {
    cwd: output, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  result.probePid = probe.pid;
  probe.stdout.on('data', (bytes) => { probeLog += bytes; });
  probe.stderr.on('data', (bytes) => { probeLog += bytes; });
  const probeExit = completed(probe);
  result.probeExit = await Promise.race([probeExit, stall(120000)]);
  if (result.probeExit.timeout) { probe.kill(); result.probeAfterTimeout = await probeExit; }
  if (result.probeExit.code !== 0) process.exitCode = 2;
} catch (error) {
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  gateway.stdin.end('\n');
  result.gatewayExit = await Promise.race([gatewayExit, stall(12000)]);
  if (result.gatewayExit.timeout) { gateway.kill(); result.gatewayAfterTimeout = await gatewayExit; }
  if (result.gatewayExit.code !== 0) process.exitCode = 1;
  result.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'gateway.log'), gatewayLog);
  await writeFile(join(output, 'probe.log'), probeLog);
  await writeFile(join(output, 'run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
