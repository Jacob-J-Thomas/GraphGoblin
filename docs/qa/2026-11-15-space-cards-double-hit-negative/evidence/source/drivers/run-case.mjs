// #208 separate higher-tier recovery. The two prior independent corrections remain exhausted.
// Final-parent frozen source/build binding comes from the exact root admission. Reuse only after complete read-only
// admission; preserve each run, unique raw files, exact source/asset identity and scoped cleanup.
// Usage: node run-case.mjs <admission.json> <cached-cli-entry> <group> <attempt>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const [admissionFile, cli, group, attempt] = process.argv.slice(2);
assert(admissionFile && cli && group && attempt, 'Usage: node run-case.mjs <admission.json> <cached-cli.js> <group> <initial|correction1|correction2>');
const here = dirname(fileURLToPath(import.meta.url));
const base = dirname(here);
assert.equal(process.version, 'v22.23.4');
const matrix = {
  'apply-d1': 'd1-fine-light', 'gestures-d1': 'd1-fine-light', 'n768': 'n768-fine-light',
  'touch-d2': 'd2-coarse-dark', 'double-r512': 'r512-reflow200', 'device-d1': 'd1-fine-light',
  'alternate-r512': 'r512-reflow200',
};
const admission = JSON.parse(await readFile(resolve(admissionFile), 'utf8'));
assert.equal(admission.status, 'authorized');
assert(admission.nativeGrant && admission.authorizedGroups.includes(group), 'Missing root grant for the exact native group');
const frozen = JSON.parse(await readFile(join(base, 'driver-manifest.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(join(base, 'driver-manifest.json'))).digest('hex'), admission.driverManifestSha256);
for (const [path, expected] of Object.entries(frozen.files)) assert.equal(createHash('sha256').update(await readFile(join(base,path))).digest('hex'), expected, 'Frozen driver changed: ' + path);
assert(/^(initial|correction[12])$/.test(attempt) && matrix[group], 'Outside the bounded matrix');
const worktree = admission.checkout;
const configName = matrix[group];
const driverName = 'space.playwright.js';
const scenario = group;
const label = group + '-' + attempt;
assert(existsSync(cli) && existsSync(worktree));
const bindingBytes = await readFile(join(base, 'binding', 'binding-before.json'));
const bindingHash = createHash('sha256').update(bindingBytes).digest('hex');
assert.equal(bindingHash, admission.beforeBindingSha256, 'Root grant must bind the frozen build result');
const binding = JSON.parse(bindingBytes);
assert.equal(binding.mapping?.id, '208-space-combined-native-v1');
for (const name of ['head', 'tree', 'actualMain', 'base']) assert.equal(binding[name], admission[name], name);
if (attempt !== 'initial') {
  const correction = JSON.parse(await readFile(join(base, 'fixture-corrections.json'), 'utf8'));
  assert(correction.length <= 2, 'Escalation correction-batch cap exhausted');
  assert(new Set(correction.map(row => row.attempt)).size === correction.length, 'One ledger row per correction batch');
  assert(correction.some((row) => row.groups.includes(group) && row.attempt === attempt && row.firstEvidence && row.fixtureCause),
    'Require a documented fixture-only cause and first outcome');
}
const runs = join(base, 'runs');
await mkdir(runs, { recursive: true });
const output = join(runs, label);
await mkdir(output); // never reuse a run directory: retained traces stay immutable
const options={cwd:worktree,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:128*1024*1024};
const readIdentity=()=>execFileSync('git',['rev-parse','HEAD','HEAD^{tree}','origin/main'],options).trim().split(/\r?\n/);
assert.deepEqual(readIdentity(),[admission.head,admission.tree,admission.actualMain]);
assert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],options).trim(),'');
const config = configName + '.edge.json';
await copyFile(join(here, 'gateway.mjs'), join(output, 'gateway.mjs'));
await copyFile(join(here, 'configs', config), join(output, config));
await copyFile(join(base, 'binding', 'binding-before.json'), join(output, 'binding-before.json'));
await copyFile(join(here, driverName), join(output, driverName));
await copyFile(join(base, 'driver-manifest.json'), join(output,'driver-manifest.json'));
await copyFile(resolve(admissionFile), join(output,'admission.json'));
for (const name of ['run-case.mjs','verify-cleanup.ps1']) await copyFile(join(here,name),join(output,name));
await mkdir(join(output, 'raw'));
const session = 'gg208space-' + label;
const stall = (ms) => new Promise((done) => { const t = setTimeout(() => done({ timeout: true }), ms); t.unref(); });

// Raw observation sink (loopback only, owned by this process).
const sunk = [];
const sink = createServer((req, res) => {
  const match = /^\/sink\/([A-Za-z0-9._-]+)$/.exec(req.url ?? '');
  if (req.method !== 'POST' || !match || match[1].includes('..')) { res.writeHead(400).end('bad'); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      await writeFile(join(output, 'raw', match[1]), body, {flag:'wx'});
      sunk.push({ name: match[1], bytes: body.length });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } catch (error) { res.writeHead(500).end(String(error)); }
  });
});
await new Promise((done) => sink.listen(0, '127.0.0.1', done));
const sinkOrigin = 'http://127.0.0.1:' + sink.address().port;
assert(![4747,4748].includes(sink.address().port));

const gateway = spawn(process.execPath, [join(output, 'gateway.mjs'), worktree, binding.head,
  join(output, 'binding-before.json'), admission.observedMain ?? admission.actualMain], { cwd: output, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const gatewayExit = new Promise((done) => gateway.once('exit', (code, signal) => done({ code, signal })));
let gatewayLog = '', gatewayError = '';
gateway.stderr.on('data', (buf) => gatewayError += buf);
gateway.stdin.on('error', (error) => gatewayError += String(error));
const ready = new Promise((done) => {
  gateway.stdout.on('data', (buf) => {
    gatewayLog += buf;
    const match = /GG_QA_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(gatewayLog);
    if (match) done({ origin: match[1] });
  });
});
let browserOpened = false;
const info = { label, scenario, config: configName, driver: driverName, startedAt: new Date().toISOString(),
  orchestratorPid: process.pid, gatewayPid: gateway.pid, sinkOrigin, session, head: binding.head, buildMain: binding.actualMain, observedMain: admission.observedMain ?? admission.actualMain };
async function cliCall(stage, timeoutMs, ...args) {
  const child = spawn(process.execPath, [cli, '-s=' + session, ...args], {
    cwd: output, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let combined = '';
  child.stdout.on('data', (d) => combined += d);
  child.stderr.on('data', (d) => combined += d);
  const exited = new Promise((settled) => child.once('close', (code, signal) => settled({ code, signal })));
  const result = await Promise.race([exited, stall(timeoutMs)]);
  if (result.timeout) child.kill();
  await writeFile(join(output, 'browser-' + stage + '.log'), combined);
  return { stage, pid: child.pid, ...result, output: combined };
}
try {
  const start = await Promise.race([ready, gatewayExit, stall(20000)]);
  assert(start.origin, JSON.stringify(start));
  assert(!/:474[78]$/.test(start.origin));
  info.origin = start.origin;
  const query = new URLSearchParams({ 'qa-pid': String(gateway.pid), 'qa-bundle': binding.bundle, 'qa-map': '208-space-combined-native-v1',
    'qa-case': scenario, 'qa-config': configName, 'qa-sink': sinkOrigin, 'qa-label': label });
  browserOpened = true;
  const open = await cliCall('open', 40000, 'open', start.origin + '/app/loops?' + query, '--config=' + config);
  info.browserPid = Number(open.output.match(/opened with pid (\d+)/)?.[1]) || null;
  assert.equal(open.code, 0, open.output);
  const run = await cliCall('run', 180000, 'run-code', '--filename=' + driverName);
  info.driverExit = run.code ?? (run.timeout ? 'timeout' : null);
  const line = run.output.split(/\r?\n/).find((row) => row.startsWith('{"suite"') || row.startsWith('"{\\"suite\\"'));
  if (line) {
    const payload = JSON.parse(line);
    const result = typeof payload === 'string' ? JSON.parse(payload) : payload;
    await writeFile(join(output, 'observed.json'), JSON.stringify(result, null, 2) + '\n');
    info.failure = result.failure ?? null;
    info.summary = result.summary ?? null;
    info.pageErrors = result.pageErrors ?? [];
    if (info.failure || info.pageErrors.length) process.exitCode = 2;
  } else {
    info.noStructuredResult = run.output.slice(0, 4000);
    process.exitCode = 2;
  }
  assert.equal(run.code, 0, run.output.slice(0, 4000));
} catch (error) {
  info.harnessError = String(error?.stack ?? error);
  process.exitCode ||= 1;
} finally {
  if (browserOpened) info.browserClose = (await cliCall('close', 25000, 'close')).code;
  gateway.stdin.end('\n');
  info.gatewayExit = await Promise.race([gatewayExit, stall(15000)]);
  if (info.gatewayExit.timeout) { gateway.kill(); info.gatewayAfterKill = await gatewayExit; }
  await new Promise((done) => sink.close(done));
  info.sunk = sunk;
  info.finishedAt = new Date().toISOString();
  // Disposable store listing, then removal (no SQLite bytes curated).
  try {
    const closed = JSON.parse(await readFile(join(output, 'gateway-closed.json'), 'utf8'));
    const scratch = await realpath(closed.scratch);
    assert.equal(dirname(scratch).toLowerCase(), (await realpath(output)).toLowerCase(), 'scratch escaped run dir');
    assert(/^gateway-store-[a-z0-9]+$/i.test(scratch.split(/[\\/]/).at(-1)), 'unexpected scratch basename');
    const names = [];
    for (const name of await readdir(scratch)) { const s = await stat(join(scratch, name)); names.push({ name, bytes: s.size, dir: s.isDirectory() }); }
    info.store = { scratch, listing: names, residualLockWalShm: names.filter((n) => /(\.lock(\..+)?|-(wal|shm))$/i.test(n.name)).map((n) => n.name),
      sqliteFilePresent: names.some((n) => n.name === 'graphgoblin.db'), gatewayListening: closed.listening };
    await rm(scratch, { recursive: true, force: true });
    info.store.removed = !existsSync(scratch);
  } catch (error) { info.storeError = String(error); process.exitCode ||= 3; }
  if (info.browserClose !== 0 || info.gatewayExit.code !== 0 || !info.store?.removed || !info.store.sqliteFilePresent || info.store.residualLockWalShm.length) process.exitCode ||= 3;
  await writeFile(join(output, 'gateway.log'), gatewayLog + gatewayError);
  await writeFile(join(output, 'run.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify(info, null, 2));
}
