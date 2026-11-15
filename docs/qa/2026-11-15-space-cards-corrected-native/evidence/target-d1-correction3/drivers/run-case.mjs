// #208 queued-fit D1 fixture correction3 authorized separately under D-035.
// Requires root's exact source/build and exclusive native grant. Every run directory is immutable evidence.
// Usage: node run-case.mjs <admission.json> <cached-cli-entry> <group> <attempt>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const [admissionFile, cli, group, attempt] = process.argv.slice(2);
assert(admissionFile && cli && group && attempt, 'Usage: node run-case.mjs <admission.json> <cached-cli.js> <group> correction3');
const here = dirname(fileURLToPath(import.meta.url));
const base = dirname(here);
assert.equal(process.version, 'v22.23.4');
const matrix = { 'queued-fit-d1': 'd1-fine-light' };
const admission = JSON.parse(await readFile(resolve(admissionFile), 'utf8'));
assert.equal(admission.status, 'authorized');
assert.equal(admission.schema, '208-space-corrected-native-admission/v1');
assert(admission.exclusiveSlotGrant, 'Requires exclusive heavy slot');
assert(['corrected-stack','actual-main'].includes(admission.candidateScope));
if(admission.candidateScope==='actual-main')assert.equal(admission.base,admission.actualMain);
assert.equal(admission.cliPath, resolve(cli), 'Exact admitted cached Playwright CLI required');
assert.equal(createHash('sha256').update(await readFile(resolve(cli))).digest('hex'), admission.cliSha256, 'Playwright CLI bytes differ');
assert(admission.nativeGrant && admission.authorizedGroups.includes(group), 'Missing root grant for the exact native group');
assert(attempt === 'correction3' && group === 'queued-fit-d1', 'Only the D1 correction3 attempt is admitted');
const expectedManifest = 'driver-manifest.json';
assert.equal(admission.driverManifest, expectedManifest, 'Use the attempt-specific root-approved driver');
assert.equal(basename(here), 'drivers');
const frozenBytes = await readFile(join(base, expectedManifest));
const frozen = JSON.parse(frozenBytes);
assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), admission.driverManifestSha256);
const driverDir = basename(here);
for (const name of ['run-case.mjs','gateway.mjs','verify-reuse.mjs','space.playwright.js','configs/' + matrix[group] + '.edge.json']) {
  assert(Object.hasOwn(frozen.files, driverDir + '/' + name), 'Driver manifest omits ' + name);
}
for (const [name, expected] of Object.entries(frozen.files)) {
  assert(!isAbsolute(name) && !name.split('/').includes('..') && !name.includes(String.fromCharCode(92)), 'Invalid manifest path');
  assert.equal(createHash('sha256').update(await readFile(join(base,name))).digest('hex'), expected, 'Frozen driver changed: ' + name);
}

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
assert.equal(binding.mapping?.id, '208-space-corrected-native-v1');
for (const name of ['head', 'tree', 'actualMain', 'base','spaceAnchor','mergedCanvas','mergedHistory','candidateScope']) assert.equal(binding[name], admission[name], name);
assert(Number.isInteger(binding.autosaveMs) && binding.autosaveMs > 0);
const ledgerBytes=await readFile(resolve(admission.fixtureLedgerPath));
assert.equal(createHash('sha256').update(ledgerBytes).digest('hex'),admission.fixtureLedgerSha256);
const corrections=JSON.parse(ledgerBytes);
const beforeLedger=JSON.parse(await readFile(join(base,'fixture-corrections-historical.json'),'utf8'));
const priorLedgerBytes=await readFile(join(base,'fixture-corrections-correction2.json'));
assert.equal(corrections.length,3,'One D-035 extension after the two spent fixture batches');
assert.equal(createHash('sha256').update(priorLedgerBytes).digest('hex'),corrections[2].beforeLedgerSha256);
assert.deepEqual(corrections.slice(0,2),JSON.parse(priorLedgerBytes));
assert.deepEqual(corrections[0],beforeLedger[0],'The first correction must remain exactly recorded');
const extension=corrections[2];
assert.equal(extension.attempt,attempt);
assert.deepEqual(extension.groups,[group]);
assert.equal(extension.policy.id,'D-035');
assert.equal(extension.unchangedOracles,true);
assert.equal(extension.firstStopHead,binding.head);
assert.equal(extension.firstStopTree,binding.tree);
assert.equal(extension.firstStopBindingSha256,bindingHash);
const firstEvidence=join(base,'..','target-d1');
for (const {path,sha256} of extension.firstStop) {
  assert(!isAbsolute(path) && !path.split('/').includes('..') && !path.includes(String.fromCharCode(92)), 'Invalid first-stop path');
  assert.equal(createHash('sha256').update(await readFile(join(firstEvidence,path))).digest('hex'),sha256,'First-stop bytes differ: '+path);
}
const first=JSON.parse(await readFile(join(firstEvidence,'runs','queued-fit-d1-initial','run.json'),'utf8'));
const terminal=JSON.parse(await readFile(join(firstEvidence,'cleanup-after-queued-fit-d1.json'),'utf8'));
assert.equal(first.head,binding.head);
assert.equal(first.label,'queued-fit-d1-initial');
assert.equal(first.failure?.phase,'fit-trusted-rapid-undo');
assert.match(first.failure.error,/No remaining Undo step/);
assert(terminal.recorded.length===1 && terminal.recorded[0].resourceClean,'First-stop cleanup was not clean');
const runs = join(base, 'runs');
await mkdir(runs, { recursive: true });
const output = join(runs, label);
await mkdir(output); // never reuse a run directory: retained traces stay immutable
execFileSync(process.execPath, [join(here, 'verify-reuse.mjs'), resolve(admissionFile),
  join(output, 'binding-readonly-before.json'), join(base, 'binding', 'read-only-before.json')],
  {cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:128*1024*1024});
const config = configName + '.edge.json';
await copyFile(join(here, 'gateway.mjs'), join(output, 'gateway.mjs'));
await copyFile(join(here, 'configs', config), join(output, config));
await copyFile(join(base, 'binding', 'binding-before.json'), join(output, 'binding-before.json'));
await copyFile(join(here, driverName), join(output, driverName));
await copyFile(join(base,expectedManifest),join(output,'driver-manifest.json'));
await copyFile(resolve(admissionFile),join(output,'admission.json'));
await mkdir(join(output, 'raw'));
const session = 'gg208spacefix-' + binding.head.slice(0, 8) + '-' + label;
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
  join(output, 'binding-before.json'), admission.actualMain], { cwd: output, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const gatewayExit = new Promise((done) => {
  gateway.once('error', (error) => done({ error: String(error) }));
  gateway.once('close', (code, signal) => done({ code, signal }));
});
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
  orchestratorPid: process.pid, gatewayPid: gateway.pid, sinkOrigin, session, head: binding.head, buildMain: binding.actualMain, observedMain: admission.actualMain };
async function cliCall(stage, timeoutMs, ...args) {
  const child = spawn(process.execPath, [cli, '-s=' + session, ...args], {
    cwd: output, windowsHide: true, env: {...process.env,PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1'}, stdio: ['ignore', 'pipe', 'pipe'] });
  let combined = '';
  child.stdout.on('data', (d) => combined += d);
  child.stderr.on('data', (d) => combined += d);
  const exited = new Promise((settled) => {
    child.once('error', (error) => settled({ error: String(error) }));
    child.once('close', (code, signal) => settled({ code, signal }));
  });
  const result = await Promise.race([exited, stall(timeoutMs)]);
  if (result.timeout) {
    child.kill();
    await Promise.race([exited,stall(5000)]);
  }
  await writeFile(join(output, 'browser-' + stage + '.log'), combined);
  return { stage, pid: child.pid, ...result, output: combined };
}
try {
  const start = await Promise.race([ready, gatewayExit, stall(20000)]);
  assert(start.origin, JSON.stringify(start));
  assert(!/:474[78]$/.test(start.origin));
  info.origin = start.origin;
  const query = new URLSearchParams({ 'qa-pid': String(gateway.pid), 'qa-bundle': binding.bundle, 'qa-map': '208-space-corrected-native-v1', 'qa-autosave-ms': String(binding.autosaveMs),
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
  if (info.gatewayExit.timeout) { gateway.kill(); info.gatewayAfterKill = await Promise.race([gatewayExit,stall(5000)]); }
  await new Promise((done) => sink.close(done));
  info.sunk = sunk;
  info.finishedAt = new Date().toISOString();
  // Disposable store listing, then removal (no SQLite bytes curated).
  try {
    const closed = JSON.parse(await readFile(join(output, 'gateway-closed.json'), 'utf8'));
    assert.equal(info.gatewayExit.code,0,'Require graceful gateway close before removing its store');
    assert.equal(closed.pid,gateway.pid);
    assert.equal(closed.listening,false);
    const scratch = await realpath(closed.scratch);
    const outputReal = await realpath(output);
    assert.equal(dirname(scratch),outputReal,'Scratch is not a direct child of this fixture');
    assert(basename(scratch).startsWith('gateway-store-'),'Unexpected scratch directory name');
    const names = [];
    for (const name of await readdir(scratch)) { const s = await stat(join(scratch, name)); names.push({ name, bytes: s.size, dir: s.isDirectory() }); }
    info.store = { scratch, listing: names, residualLockWalShm: names.filter((n) => /(\.lock(\..+)?|-(wal|shm))$/i.test(n.name)).map((n) => n.name),
      sqliteFilePresent: names.some((n) => n.name === 'graphgoblin.db' && !n.dir && n.bytes > 0), gatewayListening: closed.listening };
    await rm(scratch, { recursive: true, force: true });
    info.store.removed = !existsSync(scratch);
  } catch (error) { info.storeError = String(error); process.exitCode ||= 3; }
  if (info.browserClose !== 0 || info.gatewayExit.code !== 0 || !info.store?.removed || !info.store.sqliteFilePresent || info.store.residualLockWalShm.length) process.exitCode ||= 3;
  await writeFile(join(output, 'gateway.log'), gatewayLog + gatewayError);
  await writeFile(join(output, 'run.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify(info, null, 2));
}
