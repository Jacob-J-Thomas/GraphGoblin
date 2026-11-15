// #208 stationarity baseline orchestrator (measurement only).
// Derived from canvas-207-final-independent/run-native.mjs. Differences, all additive:
//  * the frozen binding is the byte-identical report produced by verify-final-binding.mjs
//    (binding/binding-before.json, sha256 1bd7d02c...);
//  * a loopback "sink" owned by this process receives raw per-frame observations from the
//    driver, so the CLI's stdout only carries a small summary;
//  * after the gateway has exited, the disposable file-SQLite store is listed (names, sizes,
//    lock/WAL/SHM presence) and then deleted, so no SQLite/profile bytes are curated.
// Usage: node run-case.mjs <worktree> <cli-entry> <config> <driver> <case> <label> [extra=qs ...]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree, cli, configName, driverName, scenario, label, ...extra] = process.argv.slice(2);
assert(worktree && cli && configName && driverName && scenario && label, 'usage');
assert(existsSync(cli) && existsSync(worktree));
assert(/^[a-z0-9][a-z0-9-]+$/.test(label) && /^[a-z0-9][a-z0-9,-]+$/.test(scenario));
assert.equal(process.version, 'v22.23.4');
const here = dirname(fileURLToPath(import.meta.url));
const base = resolve(here, '..');
const binding = JSON.parse(await readFile(join(base, 'binding', 'binding-before.json'), 'utf8'));
assert.equal(binding.mapping?.id, '207-final-independent-native-v1');
const runs = join(base, 'runs');
await mkdir(runs, { recursive: true });
const output = join(runs, label);
await mkdir(output); // never reuse a run directory: retained traces stay immutable
const config = configName + '.edge.json';
await copyFile(join(here, 'gateway.mjs'), join(output, 'gateway.mjs'));
await copyFile(join(here, 'configs', config), join(output, config));
await copyFile(join(base, 'binding', 'binding-before.json'), join(output, 'binding-before.json'));
await copyFile(join(here, driverName), join(output, driverName));
await mkdir(join(output, 'raw'));
const session = 'gg208-' + label;
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
      await writeFile(join(output, 'raw', match[1]), body);
      sunk.push({ name: match[1], bytes: body.length });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } catch (error) { res.writeHead(500).end(String(error)); }
  });
});
await new Promise((done) => sink.listen(0, '127.0.0.1', done));
const sinkOrigin = 'http://127.0.0.1:' + sink.address().port;

const gateway = spawn(process.execPath, [join(output, 'gateway.mjs'), worktree, binding.head,
  join(output, 'binding-before.json'), scenario], { cwd: output, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
  orchestratorPid: process.pid, gatewayPid: gateway.pid, sinkOrigin, session };
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
  const query = new URLSearchParams({ 'qa-pid': String(gateway.pid), 'qa-bundle': binding.bundle, 'qa-map': '207-final-independent-native-v1',
    'qa-case': scenario, 'qa-config': configName, 'qa-sink': sinkOrigin, 'qa-label': label });
  for (const pair of extra) { const [k, v] = pair.split('='); query.set(k, v); }
  const open = await cliCall('open', 40000, 'open', start.origin + '/app/loops?' + query, '--config=' + config);
  browserOpened = true;
  info.browserPid = Number(open.output.match(/opened with pid (\d+)/)?.[1]) || null;
  assert.equal(open.code, 0, open.output);
  const run = await cliCall('run', 900000, 'run-code', '--filename=' + driverName);
  info.driverExit = run.code ?? (run.timeout ? 'timeout' : null);
  const line = run.output.split(/\r?\n/).find((row) => /^\{"suite"/.test(row));
  if (line) {
    const result = JSON.parse(line);
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
    const scratch = resolve(closed.scratch);
    assert(scratch.startsWith(output + '\\') || scratch.startsWith(output + '/'), 'scratch escaped run dir');
    const names = [];
    for (const name of await readdir(scratch)) { const s = await stat(join(scratch, name)); names.push({ name, bytes: s.size, dir: s.isDirectory() }); }
    info.store = { scratch, listing: names, residualLockWalShm: names.filter((n) => /(\.lock(\..+)?|-(wal|shm))$/i.test(n.name)).map((n) => n.name),
      sqliteFilePresent: names.some((n) => n.name === 'graphgoblin.db'), gatewayListening: closed.listening };
    await rm(scratch, { recursive: true, force: true });
    info.store.removed = !existsSync(scratch);
  } catch (error) { info.storeError = String(error); }
  await writeFile(join(output, 'gateway.log'), gatewayLog + gatewayError);
  await writeFile(join(output, 'run.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(JSON.stringify(info, null, 2));
}
