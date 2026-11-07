// Independent acceptance against already-built native launcher. Run only after parent readiness.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { access, link, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.argv[2] ?? 'C:/Users/98jak/.codex/worktrees/windows-launcher/GraphGoblin');
const exe = resolve(process.argv[4] ?? join(repo, 'apps/windows-launcher/GraphGoblin.exe'));
const node = process.execPath;
const selected = process.argv[3] ? new RegExp(process.argv[3]) : undefined;
let nextPort = Number(process.argv[5] ?? 4860);
assert.ok(nextPort >= 4860 && nextPort <= 4879);
const portStrategy = process.argv[6] ?? 'round-robin';
assert.ok(['round-robin', 'reuse'].includes(portStrategy));
assert.equal(process.versions.node.split('.')[0], '22');
const runRoot = join(ownRoot, `run-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
await mkdir(runRoot, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.toUpperCase().startsWith('GG_') && !/API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|NODE_V8_COVERAGE/i.test(key)));
for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
env.PATH = `${dirname(node)};${process.env.PATH}`;
const results = [], owners = new Map(), configurations = [];
const exitObservers = new Map();
const since = new Date().toISOString();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const exists = (path) => access(path).then(() => true, () => false);
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until(check, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) { assert.ok(Date.now() < deadline, 'Timed out'); await sleep(75); }
}
function execute(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: runRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '', exitAt, eofFailure = false, pipeTimer;
    const startedAt = new Date().toISOString();
    child.stdout.on('data', (v) => { stdout += v; });
    child.stderr.on('data', (v) => { stderr += v; });
    child.once('error', reject);
    child.once('exit', () => {
      exitAt = new Date().toISOString();
      if (command === exe) pipeTimer = setTimeout(() => {
        eofFailure = true;
        child.stdout.destroy(); child.stderr.destroy();
      }, 3000);
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out command PID${child.pid}`)); }, 90_000);
    child.once('close', (code, signal) => { clearTimeout(timer); clearTimeout(pipeTimer); done({ command, args, pid: child.pid, startedAt,
      exitAt, endedAt: new Date().toISOString(), code, signal, stdout, stderr, eofFailure }); });
  });
}
async function processInfo(pid) {
  const output = await execute('powershell.exe', ['-NoProfile', '-Command',
    `$p = Get-Process -Id ${Number(pid)} -ErrorAction Stop; [pscustomobject]@{Id=$p.Id; StartTime=$p.StartTime.ToUniversalTime().ToString('o'); Path=$p.Path} | ConvertTo-Json -Compress`]);
  return output.code === 0 ? JSON.parse(output.stdout) : { pid, unavailable: output.stderr };
}
async function observeExit(pid) {
  if (exitObservers.has(pid)) return exitObservers.get(pid);
  const child = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${Number(pid)}; $h=$p.Handle; [Console]::WriteLine('attached'); $p.WaitForExit(); [Console]::WriteLine($p.ExitCode)`],
  { cwd: runRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', attach;
  const attached = new Promise((done, reject) => { attach = done; child.once('error', reject); });
  child.stdout.on('data', (v) => { stdout += v; if (stdout.includes('attached')) attach(); });
  child.stderr.on('data', (v) => { stderr += v; });
  const completion = new Promise((done) => child.once('close', (code) => done({ pid, code, stdout, stderr, at: new Date().toISOString() })));
  await Promise.race([attached, completion.then((v) => { throw new Error(`Exit observer failed: ${JSON.stringify(v)}`); }),
    sleep(15_000).then(() => { throw new Error('Exit observer did not attach'); })]);
  exitObservers.set(pid, completion); return completion;
}
async function evidence(name, value) { await writeFile(join(runRoot, name), JSON.stringify(value, null, 2)); return value; }
async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1800) });
  return { at: new Date().toISOString(), status: response.status, identity: response.headers.get('x-graphgoblin-instance'),
    pid: Number(response.headers.get('x-graphgoblin-pid')), phase: response.headers.get('x-graphgoblin-phase'), body: await response.text() };
}
async function call(c, method, path, body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:${c.Port}${path}`, { method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  const text = await response.text(); assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return JSON.parse(text);
}
async function freePort(excluded = []) {
  for (let index = 0; index < 20; index++) {
    const port = 4860 + ((nextPort - 4860 + index) % 20);
    if (owners.has(port) || excluded.includes(port)) continue;
    const s = createServer();
    const available = await new Promise((done) => { s.once('error', () => done(false)); s.listen(port, '127.0.0.1', () => s.close(() => done(true))); });
    if (available) { if (portStrategy === 'round-robin') nextPort = 4860 + ((port - 4860 + 1) % 20); return port; }
  }
  throw new Error('No disposable port4860-4879');
}
let sequence = 0;
async function config(label, overrides = {}) {
  const base = join(runRoot, `${++sequence}-${label}`); await mkdir(base, { recursive: true });
  const c = { Repo: repo, Node: node, DataDir: join(base, 'store'), Port: await freePort(),
    Environment: { GG_REQUIRE_API_KEY: 'false', GG_SHUTDOWN_GRACE_MS: '600', GG_TIMER_POLL_MS: '50', GG_JEV_API_KEY: '', GG_LOG_LEVEL: 'info' },
    StartupTimeoutSeconds: 15, WindowTimeoutSeconds: 5, ...overrides };
  c.file = join(base, 'GraphGoblin.exe.json'); await save(c); configurations.push(c); return c;
}
async function save(c) { const { file: _file, ...value } = c; await writeFile(c.file, JSON.stringify(value, null, 2)); }
async function launch(c, suffix = '') {
  const output = await execute(exe, ['--ensure-gateway', '--config', c.file]);
  await evidence(`launch-${sequence}-${suffix || Date.now()}.json`, output);
  if (output.eofFailure) {
    const h = await health(c.Port).catch(() => undefined);
    const owner = await readFile(join(c.DataDir, 'graphgoblin.lock'), 'utf8').then(JSON.parse, () => undefined);
    if (h?.pid > 0 && h.pid === owner?.pid) owners.set(c.Port, { c, pid: h.pid, identity: h.identity });
    assert.fail('Launcher exited but piped stdout/stderr did not reach EOF within three seconds; inherited handle leak');
  }
  return output;
}
async function boot(c) {
  const result = await launch(c); assert.equal(result.code, 0, JSON.stringify(result));
  const h = await health(c.Port); assert.equal(h.status, 200); assert.equal(h.phase, 'running'); assert.ok(h.pid > 0);
  assert.match(h.identity, /^[a-f0-9]{64}$/); assert.equal(JSON.parse(await readFile(join(c.DataDir, 'graphgoblin.lock'), 'utf8')).pid, h.pid);
  owners.set(c.Port, { c, pid: h.pid, identity: h.identity });
  const observing = observeExit(h.pid); void observing.catch(() => undefined);
  await until(() => exitObservers.has(h.pid));
  await evidence(`owner-${h.pid}.json`, { health: h, process: await processInfo(h.pid), config: c });
  const page = await fetch(`http://127.0.0.1:${c.Port}/app/`); assert.equal(page.status, 200); assert.match(await page.text(), /<!doctype html/i);
  return h;
}
async function stopped(c, pid, timeout = 30_000) {
  await until(() => !alive(pid), timeout); assert.equal(await exists(join(c.DataDir, 'graphgoblin.lock')), false);
  assert.equal(await exists(join(c.DataDir, 'graphgoblin.lock.reclaim')), false);
  const db = c.Environment.GG_DB_URL?.startsWith('file:') ? c.Environment.GG_DB_URL.slice(5) : join(c.DataDir, 'graphgoblin.db');
  assert.equal(await exists(`${db}.graphgoblin.lock`), false, 'Database ownership lock must be removed');
  assert.equal(await exists(`${db}.graphgoblin.lock.reclaim`), false);
  if (exitObservers.has(pid)) {
    const observed = await exitObservers.get(pid); await evidence(`exit-${pid}.json`, observed);
    assert.equal(observed.code, 0, JSON.stringify(observed)); assert.equal(observed.stdout.trim().split(/\r?\n/).at(-1), '0', JSON.stringify(observed));
  }
  owners.delete(c.Port);
  exitObservers.delete(pid);
}
async function stop(c, action = 'drain') {
  const owner = owners.get(c.Port); if (!owner) return;
  const h = await health(c.Port); assert.equal(h.pid, owner.pid); assert.equal(h.identity, owner.identity);
  // Holding a process handle before stopping independently records the detached gateway's exit code.
  if (!exitObservers.has(owner.pid)) {
    const observing = observeExit(owner.pid); void observing.catch(() => undefined);
    await until(() => exitObservers.has(owner.pid));
  }
  await call(c, 'POST', '/system/shutdown', { action }, 202); await stopped(c, owner.pid);
}
async function test(name, fn) {
  if (selected && !selected.test(name)) { results.push({ name, status: 'NOT RUN', reason: 'case filter' }); return; }
  const row = { name, startedAt: new Date().toISOString() };
  const configOffset = configurations.length;
  try { row.detail = await fn(); row.status = 'PASS'; }
  catch (e) { row.status = 'FAIL'; row.error = e.stack; }
  // Recover delayed starts after failed readiness and clean each case before the next one.
  if (row.status === 'FAIL') await sleep(2500);
  row.cleanup = [];
  for (const c of configurations.slice(configOffset)) {
    try {
      const lock = JSON.parse(await readFile(join(c.DataDir, 'graphgoblin.lock'), 'utf8'));
      const h = await health(c.Port); if (h.pid !== lock.pid) continue;
      owners.set(c.Port, { c, pid: h.pid, identity: h.identity });
      await stop(c, 'force'); row.cleanup.push({ port: c.Port, pid: h.pid, result: 'managed cleanup' });
    } catch (e) { if (e.code !== 'ENOENT') row.cleanup.push({ port: c.Port, result: 'retained', error: e.message }); }
  }
  row.endedAt = new Date().toISOString(); results.push(row); await evidence('results.json', { since, results });
  console.log(`${row.status} ${name}${row.error ? `: ${row.error.split('\n')[0]}` : ''}`);
}
async function hashTree(path, target) {
  if (!(await exists(path))) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name); if (entry.isDirectory()) await hashTree(full, target);
    else if (entry.isFile()) target.push({ path: relative(repo, full), sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
  }
}
const hashes = [];
for (const p of ['apps/api/dist', 'apps/web/dist', 'apps/windows-launcher']) await hashTree(join(repo, p), hashes);
for (const p of ['apps/api/src', 'scripts']) await hashTree(join(repo, p), hashes);
for (const p of await readdir(join(repo, 'packages'))) await hashTree(join(repo, 'packages', p, 'dist'), hashes);
const gitHead = await execute('git', ['-C', repo, 'rev-parse', 'HEAD']);
const gitStatus = await execute('git', ['-C', repo, 'status', '--short']);
const qaHashes = await Promise.all(['run-native.mjs', 'providerfree-workload.mjs', 'cleanup-owned.mjs'].map(async (path) => ({
  path, sha256: createHash('sha256').update(await readFile(join(ownRoot, path))).digest('hex'),
})));
await evidence('build-provenance.json', { at: new Date().toISOString(), node: process.version, nodePath: node, portStrategy, gitHead, gitStatus, hashes, qaHashes,
  actualLauncher: { path: exe, sha256: createHash('sha256').update(await readFile(exe)).digest('hex') } });

try {
  await test('L01-L03 cold warm concurrent native launch', async () => {
    const c = await config('cold warm Unicode Ω'); const h = await boot(c);
    assert.equal((await launch(c, 'warm')).code, 0); assert.equal((await health(c.Port)).pid, h.pid); await stop(c);
    const clicks = await Promise.all(Array.from({ length: 4 }, (_, i) => launch(c, `concurrent-${i}`)));
    assert.ok(clicks.every((v) => v.code === 0), JSON.stringify(clicks));
    const current = await boot(c); assert.notEqual(current.pid, h.pid); await stop(c);
    return { oldPid: h.pid, concurrentPid: current.pid, clicks };
  });
  await test('L04 wrong HTTP listener survives refusal', async () => {
    const c = await config('wrong-listener'); let requests = [];
    const server = createServer((req, res) => { requests.push(req.url); res.setHeader('content-type', 'application/json'); res.end('{"status":"ok"}'); });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(c.Port, '127.0.0.1', done); });
    try { const output = await launch(c); assert.equal(output.code, 1); assert.ok(server.listening);
      assert.equal(await exists(join(dirname(c.file), 'gateway.log')), false, 'Wrong-listener refusal must not start a detached child');
      assert.equal(await exists(join(c.DataDir, 'graphgoblin.lock')), false); return { requests, output }; }
    finally { await new Promise((done) => server.close(done)); }
  });
  await test('L04b eight silent TCP listener refusals without child startup', async () => {
    const attempts = [];
    for (let index = 0; index < 8; index++) {
      const c = await config(`silent-tcp-${index}`);
      const sockets = new Set(); let accepted = 0;
      const listener = createTcpServer((socket) => {
        accepted++; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      });
      await new Promise((done, reject) => { listener.once('error', reject); listener.listen(c.Port, '127.0.0.1', done); });
      try {
        const output = await launch(c, `silent-${index}`);
        attempts.push({ index, port: c.Port, output, accepted, listenerAlive: listener.listening,
          gatewayLogCreated: await exists(join(dirname(c.file), 'gateway.log')),
          apiLockCreated: await exists(join(c.DataDir, 'graphgoblin.lock')) });
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((done) => listener.close(done));
      }
    }
    await evidence('silent-tcp-attempts.json', attempts);
    assert.ok(attempts.every((a) => a.output.code === 1 && a.listenerAlive && a.accepted > 0 && !a.gatewayLogCreated && !a.apiLockCreated),
      'Silent occupied listener must refuse without child startup on all eight attempts');
    return attempts;
  });
  await test('L05 wrong genuine store and public config refused', async () => {
    const a = await config('correct-store'); const h = await boot(a);
    try {
      const b = await config('wrong-store', { Port: a.Port }); const wrongStore = await launch(b); assert.equal(wrongStore.code, 1);
      const changed = await config('wrong-config', { Port: a.Port, DataDir: a.DataDir,
        Environment: { ...a.Environment, GG_MAX_CONCURRENT_RUNS: '2' } });
      const wrongConfig = await launch(changed); assert.equal(wrongConfig.code, 1);
      assert.equal((await health(a.Port)).pid, h.pid); return { h, wrongStore, wrongConfig };
    } finally { await stop(a); }
  });
  await test('L06 separate data dirs sharing physical DB refuse second owner', async () => {
    const a = await config('db-owner'); const h = await boot(a);
    try {
      const b = await config('db-contender', { Environment: { ...a.Environment, GG_DB_URL: `file:${join(a.DataDir, 'graphgoblin.db').replaceAll('\\', '/')}` } });
      const output = await launch(b); assert.equal(output.code, 1); assert.equal((await health(a.Port)).pid, h.pid);
      assert.equal(await exists(join(b.DataDir, 'graphgoblin.lock')), false); return output;
    } finally { await stop(a); }
  });
  await test('L06b hard-linked DB spellings cannot create two owners', async () => {
    const a = await config('hardlink-original'); await boot(a); await stop(a);
    const original = join(a.DataDir, 'graphgoblin.db');
    const alias = join(dirname(a.file), 'alias', 'same-store.db'); await mkdir(dirname(alias)); await link(original, alias);
    const b = await config('hardlink-contender', { Port: await freePort([a.Port]),
      Environment: { ...a.Environment, GG_DB_URL: `file:${alias.replaceAll('\\', '/')}` } });
    assert.notEqual(a.Port, b.Port);
    const files = await Promise.all([original, alias].map(async (path) => {
      const s = await stat(path); return { path, dev: s.dev, ino: s.ino, nlink: s.nlink, size: s.size };
    }));
    assert.equal(files[0].ino, files[1].ino); assert.equal(files[0].dev, files[1].dev); assert.equal(files[0].nlink, 2);
    const first = await launch(a, 'hardlink-first');
    if (first.code === 0) {
      const h = await health(a.Port); owners.set(a.Port, { c: a, pid: h.pid, identity: h.identity });
    }
    const second = await launch(b, 'hardlink-second');
    if (second.code === 0) {
      const h = await health(b.Port); owners.set(b.Port, { c: b, pid: h.pid, identity: h.identity });
    }
    const observations = await evidence('hardlink-ownership.json', { files, first, second,
      owners: await Promise.all([a, b].map(async (c) => ({ config: c,
        health: await health(c.Port).catch((e) => ({ unreachable: e.message })) }))) });
    try { assert.ok(first.code !== 0 || second.code !== 0, 'Both hard-linked spellings became independent gateway owners'); return observations; }
    finally { await stop(b); await stop(a); }
  });
  await test('L07 stale owner reclaimed malformed owner retained', async () => {
    const dead = await execute(node, ['-e', 'process.exit(0)']); assert.equal(alive(dead.pid), false);
    const c = await config('stale'); await mkdir(c.DataDir, { recursive: true });
    await writeFile(join(c.DataDir, 'graphgoblin.lock'), JSON.stringify({ pid: dead.pid, startedAt: dead.startedAt, token: 'independent-stale' }));
    const h = await boot(c); assert.notEqual(h.pid, dead.pid); await stop(c);
    const d = await config('malformed'); await mkdir(d.DataDir, { recursive: true });
    const malformed = '{this is not an owner'; await writeFile(join(d.DataDir, 'graphgoblin.lock'), malformed);
    const output = await launch(d); assert.equal(output.code, 1); assert.equal(await readFile(join(d.DataDir, 'graphgoblin.lock'), 'utf8'), malformed);
    return { h, dead, output };
  });
  await test('L08 configuration runtime and child startup failures', async () => {
    const cases = [];
    const invalid = await config('invalid-env', { Environment: { GG_DEFAULTS: '{' } }); cases.push(await launch(invalid));
    const missing = await config('missing-node', { Node: join(runRoot, 'missing-node.exe') }); cases.push(await launch(missing));
    const db = join(runRoot, 'db-is-directory'); await mkdir(db);
    const childFail = await config('child-failure', { Environment: { GG_DB_URL: `file:${db.replaceAll('\\', '/')}`, GG_JEV_API_KEY: '' } }); cases.push(await launch(childFail));
    assert.ok(cases.every((v) => v.code === 1), JSON.stringify(cases));
    assert.ok(cases.every((v) => !v.stderr.includes('Process was not started by this object')), JSON.stringify(cases));
    assert.equal(await exists(join(childFail.DataDir, 'graphgoblin.lock')), false); return cases;
  });
  const workload = async (c, action, directory) => {
    const result = await execute(node, [join(ownRoot, 'providerfree-workload.mjs'), action, `http://127.0.0.1:${c.Port}`, directory]);
    assert.equal(result.code, 0, JSON.stringify(result)); return JSON.parse(result.stdout);
  };
  await test('W01 actual disposable browser close keeps parent child native tree alive', async () => {
    const c = await config('browser-close'); const h = await boot(c); const directory = join(dirname(c.file), 'workload');
    const manifest = await workload(c, 'prepare', directory);
    const require = createRequire(join(repo, 'apps/web/package.json')); const { chromium } = require('@playwright/test');
    let browser;
    try {
      const browserPath = join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
      browser = await chromium.launch({ headless: false, executablePath: browserPath }); const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage(); await page.goto(`http://127.0.0.1:${c.Port}/app/runs/${manifest.parentId}`);
      await page.getByRole('heading').first().waitFor();
      let screenshotError;
      try { await page.screenshot({ path: join(directory, 'actual-browser-before-close.png') }); }
      catch (e) { screenshotError = e.message; }
      const browserEvidence = { browserPath, browserVersion: browser.version(), url: page.url(), title: await page.title(),
        body: (await page.locator('body').innerText()).slice(0, 4000), openedAt: new Date().toISOString(), screenshotError,
        connectedBeforeClose: browser.isConnected() };
      await context.close(); await browser.close(); browserEvidence.connectedAfterClose = browser.isConnected();
      assert.equal(browserEvidence.connectedBeforeClose, true); assert.equal(browserEvidence.connectedAfterClose, false);
      browser = undefined; await sleep(1500);
      const snapshot = await workload(c, 'snapshot', directory); assert.equal((await health(c.Port)).pid, h.pid);
      assert.equal(snapshot.parent.waiting?.childRunId, manifest.childId); assert.equal(snapshot.child.currentNodeId, 'hold');
      assert.ok(Object.values(snapshot.tree).every((v) => v.alive));
      await evidence('browser-close.json', { browserEvidence, closedAt: new Date().toISOString(), snapshot,
        processes: await Promise.all([h.pid, manifest.tree.root, manifest.tree.descendant].map(processInfo)) });
      await workload(c, 'release', directory); await until(async () => (await call(c, 'GET', `/runs/${manifest.parentId}`)).status === 'succeeded');
      await stop(c); return { h, manifest, snapshot };
    } finally { await browser?.close(); await writeFile(manifest.release, 'cleanup'); }
  });
  await test('W02 native launcher drain wait completion relaunch persistence', async () => {
    const c = await config('drain-wait'); const h = await boot(c); const directory = join(dirname(c.file), 'workload'); const m = await workload(c, 'prepare', directory);
    try {
      await call(c, 'POST', '/system/shutdown', { action: 'drain' }, 202);
      await until(async () => (await call(c, 'GET', '/system/shutdown')).phase === 'awaiting-choice');
      const reopen = await launch(c, 'draining-reused'); assert.equal(reopen.code, 0);
      assert.equal((await health(c.Port)).pid, h.pid);
      assert.equal((await call(c, 'GET', '/system/shutdown')).phase, 'awaiting-choice');
      await call(c, 'POST', '/system/shutdown', { action: 'wait' }, 202); await sleep(1500);
      assert.equal((await call(c, 'GET', '/system/shutdown')).phase, 'draining');
      const during = await workload(c, 'snapshot', directory); assert.ok(Object.values(during.tree).every((v) => v.alive));
      await call(c, 'POST', `/loops/${m.parentLoop}/runs`, {}, 503);
      await workload(c, 'release', directory); await stopped(c, h.pid); const next = await boot(c);
      const parent = await call(c, 'GET', `/runs/${m.parentId}`); const child = await call(c, 'GET', `/runs/${m.childId}`);
      assert.equal(parent.status, 'succeeded'); assert.equal(child.status, 'succeeded');
      const events = await call(c, 'GET', `/runs/${m.parentId}/events`); assert.equal(events.items.filter((e) => e.type === 'child_run.started').length, 1);
      await stop(c); return { h, next, during, parent, child, events };
    } finally { await writeFile(m.release, 'cleanup'); }
  });
  await test('W03 native force descendant interruption relaunch evidence', async () => {
    const c = await config('force'); const h = await boot(c); const directory = join(dirname(c.file), 'workload'); const m = await workload(c, 'prepare', directory);
    try {
      await call(c, 'POST', '/system/shutdown', { action: 'force' }, 202); await stopped(c, h.pid);
      await until(() => !alive(m.tree.root) && !alive(m.tree.descendant)); const next = await boot(c);
      const parent = await call(c, 'GET', `/runs/${m.parentId}`); const child = await call(c, 'GET', `/runs/${m.childId}`);
      assert.equal(child.status, 'failed'); assert.equal(child.failure?.code, 'RUN_INTERRUPTED_BY_STOP');
      const events = await call(c, 'GET', `/runs/${m.childId}/events`); assert.ok(JSON.stringify(events).includes('RUN_INTERRUPTED_BY_STOP'));
      await sleep(500); assert.equal((await call(c, 'GET', `/runs/${m.childId}`)).status, 'failed');
      await stop(c); return { h, next, parent, child, events };
    } finally { await writeFile(m.release, 'cleanup'); }
  });
} finally {
  const cleanup = [];
  for (const { c, pid } of [...owners.values()]) {
    try { await stop(c, 'force'); cleanup.push({ port: c.Port, pid, status: 'managed-force-cleanup' }); }
    catch (e) { cleanup.push({ port: c.Port, pid, status: 'REQUIRES-INSPECTION', error: e.message }); }
  }
  await evidence('cleanup.json', cleanup);
  await evidence('results.json', { since, endedAt: new Date().toISOString(), repo, runRoot, results, cleanup,
    notRun: ['S01 installer/shortcut fields', 'S02 actual owner desktop/taskbar pin/relaunch'],
    evidenceBoundary: 'Native launcher --ensure-gateway, real built API, provider-free native script trees, disposable headed Chromium. No owner Chrome PWA or taskbar mutation.' });
}
console.log(`Evidence: ${runRoot}`); process.exitCode = results.some((r) => r.status === 'FAIL') ? 1 : 0;
