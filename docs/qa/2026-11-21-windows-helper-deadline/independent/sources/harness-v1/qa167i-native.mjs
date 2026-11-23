// QA167I native public-control driver. Not product code.
// Drives the compiled production launcher through its ordinary public entry
// (GraphGoblin.exe --config <file> --ensure-gateway: quiet, no dialog, no PWA window) against disposable
// fixture repositories, stores, private log folders and bind-checked loopback ports 25880-25899, plus
// one public-API-only helper-entry harness. Fixture helper/gateway scripts are harmless local Node
// scripts; a fixture gateway marker means the ordinary start path ran, never a ready gateway. The
// driver owns: the unrelated sentinel (exact retained handle), the launcher processes it spawns, and the
// real disposable gateway's deliberate drain. It never signals a helper or clears a listener.
// node qa167i-native.mjs --checkout <dir> --bin <dir> --build-record <json> --scratch <dir> --out <dir> [--cases N1,N2]
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { arg, checkoutState, fileSha, now, sha256, scrubber } from './qa167i-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORTS = [25880, 25899];
const checkout = arg('--checkout');
const bin = arg('--bin');
const build = JSON.parse(readFileSync(arg('--build-record'), 'utf8'));
const scratch = arg('--scratch');
const out = arg('--out');
const selected = arg('--cases', '').split(',').filter(Boolean);
const frozen = JSON.parse(readFileSync(join(here, 'qa167i-cases.json'), 'utf8'));
const runId = `native-${now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const privateRun = join(out, 'private', runId);
const publicRun = join(out, 'public', runId);
const work = join(scratch, runId);
for (const path of [privateRun, publicRun, work]) {
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  mkdirSync(path, { recursive: true });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = { schema: 'qa167i-native-run/1', runId, startUtc: now(), node: process.version, execPath: process.execPath, ports: PORTS, setupFaults: [], cases: [] };
const save = () => writeFileSync(join(privateRun, 'run.json'), JSON.stringify(run, null, 2) + '\n');
const scrub = scrubber([[scratch, '<scratch>'], [checkout, '<checkout>'], [out, '<out>']]);
const fail = (kind, detail) => {
  run.setupFaults.push({ at: now(), kind, detail });
  run.status = 'SETUP-FAULT';
  run.endUtc = now();
  save();
  console.error(`setup fault: ${kind}`);
  process.exit(3);
};

// ---------- setup verification ----------
run.checkout = checkoutState(checkout);
const launcherExe = join(bin, 'GraphGoblin.exe');
const publicEntryExe = join(bin, 'Qa167iPublicEntry.exe');
run.assemblies = {
  launcher: { sha256: fileSha(launcherExe), recorded: build.outputs.launcher.sha256 },
  publicEntry: { sha256: fileSha(publicEntryExe), recorded: build.outputs.publicEntry.sha256 },
  launcherSource: { sha256: fileSha(join(checkout, 'apps/windows-launcher/Launcher.cs')), recorded: build.inputs.launcherSource.sha256 },
};
if (!run.checkout.matches) fail('checkout-mismatch', run.checkout);
for (const [name, item] of Object.entries(run.assemblies)) if (item.sha256 !== item.recorded) fail(`${name}-mismatch`, item);
const fixtureRepo = join(work, 'fixture-repo');
cpSync(join(here, 'fixtures', 'repo'), fixtureRepo, { recursive: true });
run.fixtureRepo = Object.fromEntries(snapshotFiles(fixtureRepo).map((rel) => [rel, fileSha(join(fixtureRepo, rel))]));
for (const [rel, hash] of Object.entries(run.fixtureRepo)) if (fileSha(join(here, 'fixtures', 'repo', rel)) !== hash) fail('fixture-copy-mismatch', rel);
function snapshotFiles(directory) {
  const found = [];
  const walk = (path) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(relative(directory, full).replace(/\\/g, '/'));
    }
  };
  walk(directory);
  return found;
}
const OWNER_RECORD = Buffer.from('{"qa167i":"driver-owned fixture owner record; never a real owner","pid":"not-a-pid"}\n', 'utf8');
const IDENTITY_HEX = sha256('qa167i-fixture-identity');
const system32 = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
const sid = /"(S-1-[0-9-]+)"/.exec(execFileSync(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }))?.[1];
if (!sid) fail('current-user-sid-unknown');
function privateDirectory(path) {
  mkdirSync(path, { recursive: true });
  execFileSync(system32('icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { windowsHide: true });
  return path;
}
function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => resolve({ available: false, code: error.code }));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve({ available: true })));
  });
}
let nextPort = PORTS[0];
async function choosePort() {
  while (nextPort <= PORTS[1]) {
    const port = nextPort++;
    const probe = await portAvailable(port);
    if (probe.available) return port;
    run.setupFaults.push({ at: now(), kind: 'port-unavailable', port, code: probe.code, note: 'not inspected; next allowed port chosen' });
  }
  fail('no-port', PORTS);
}
function fileState(path) {
  if (!existsSync(path)) return null;
  const info = statSync(path, { bigint: true });
  return { dev: String(info.dev), ino: String(info.ino), bytes: Number(info.size), sha256: info.isFile() ? fileSha(path) : null };
}
function snapshot(directory) {
  if (!existsSync(directory)) return null;
  const entries = [];
  const walk = (path) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const info = statSync(full);
      entries.push(info.isDirectory() ? { path: relative(directory, full), type: 'dir' } : { path: relative(directory, full), type: 'file', ...fileState(full) });
      if (info.isDirectory()) walk(full);
    }
  };
  walk(directory);
  return entries;
}
const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
function launch(file, args, env, watchdogMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    let watchdog = false;
    const timer = setTimeout(() => {
      watchdog = true;
      child.kill(); // driver watchdog on the exact retained handle; never product cleanup
    }, watchdogMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, code, signal, watchdog, startedAt: started, endedAt: Date.now(), ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GG_/i.test(key)));
async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return { status: response.status, pid: response.headers.get('x-graphgoblin-pid'), instance: response.headers.get('x-graphgoblin-instance'), phase: response.headers.get('x-graphgoblin-phase') };
  } catch (error) {
    return { status: null, error: error.cause?.code ?? error.name };
  }
}

// Unrelated same-executable sentinel with a bounded natural lifetime; exact handle retained.
const sentinel = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(46),1200000)'], { stdio: 'ignore', windowsHide: true });
const sentinelExit = new Promise((resolve) => sentinel.on('exit', (code, signal) => resolve({ code, signal, at: now() })));
const sentinelAlive = () => sentinel.exitCode === null && sentinel.signalCode === null;
run.sentinel = { pid: sentinel.pid, startedUtc: now() };
save();

function judge(record, checks) {
  record.assertions = checks.map(([name, pass, expected, observed]) => ({ name, pass: Boolean(pass), expected, observed }));
  record.status = record.assertions.every((item) => item.pass) ? 'PASS' : 'FAIL';
}
const within = (value, [min, max]) => typeof value === 'number' && value >= min && value <= max;
const sameLock = (observed, lockPath) =>
  typeof observed === 'string' && [lockPath, existsSync(lockPath) ? realpathSync.native(lockPath) : lockPath].some((item) => item.toLowerCase() === observed.toLowerCase());

async function fixtureCase(definition) {
  const caseDir = join(work, definition.id);
  const configDir = privateDirectory(join(caseDir, 'config'));
  const store = join(caseDir, 'store');
  mkdirSync(store, { recursive: true });
  const lockPath = join(store, 'graphgoblin.lock');
  if (definition.ownerRecord) writeFileSync(lockPath, OWNER_RECORD);
  writeFileSync(join(caseDir, 'scenario.json'), JSON.stringify({ identityHex: IDENTITY_HEX, lockPath, ...definition.scenario }));
  const port = await choosePort();
  const config = { Repo: fixtureRepo, Node: process.execPath, DataDir: store, Port: port, Environment: {}, StartupTimeoutSeconds: definition.startupSeconds, WindowTimeoutSeconds: 2 };
  const configPath = join(configDir, 'GraphGoblin.json');
  writeFileSync(configPath, JSON.stringify(config));
  const storeBefore = snapshot(store);
  const lockBefore = fileState(lockPath);
  const env = { ...baseEnv(), QA167I_CASE_DIR: caseDir };
  const launched = await launch(launcherExe, ['--config', configPath, '--ensure-gateway'], env, 60_000);
  await sleep(1000);
  const heartbeatFiles = readdirSync(caseDir).filter((name) => name.startsWith('heartbeat-'));
  const beatsA = Object.fromEntries(heartbeatFiles.map((name) => [name, lines(join(caseDir, name))]));
  await sleep(700);
  const beatsB = Object.fromEntries(heartbeatFiles.map((name) => [name, lines(join(caseDir, name))]));
  const events = lines(join(caseDir, 'events.ndjson'));
  const markers = lines(join(caseDir, 'gateway-markers.ndjson'));
  const records = lines(join(configDir, 'launcher.log'));
  const last = records.at(-1) ?? null;
  const portAfter = await portAvailable(port);
  const storeAfter = snapshot(store);
  const lockAfter = fileState(lockPath);
  const stderr = launched.stderr.toString('utf8');
  const starts = events.filter((item) => item.event === 'helper-start');
  const exits = events.filter((item) => item.event === 'helper-exit');
  const helperRuns = starts.map((start) => {
    const exit = exits.find((item) => item.kind === start.kind && item.index === start.index && item.pid === start.pid);
    const beats = beatsB[`heartbeat-${start.kind}-${start.index}.ndjson`] ?? null;
    return {
      kind: start.kind,
      index: start.index,
      pid: start.pid,
      ppidIsLauncher: start.ppid === launched.pid,
      startAt: start.at,
      exitCode: exit ? exit.code : null,
      naturalExit: Boolean(exit),
      heartbeats: beats ? beats.length : null,
      heartbeatLifetimeMs: beats && beats.length ? beats.at(-1).at - beats[0].at : null,
      heartbeatStopped: beats ? beats.length === (beatsA[`heartbeat-${start.kind}-${start.index}.ndjson`] ?? []).length : null,
      lastHeartbeatBeforeLauncherExit: beats && beats.length ? beats.at(-1).at <= launched.endedAt : null,
    };
  });
  const observed = {
    launcherPid: launched.pid,
    launcherExit: launched.code,
    launcherWatchdog: launched.watchdog,
    launcherMs: launched.ms,
    stdoutBytes: launched.stdout.length,
    stderr,
    record: last,
    recordCount: records.length,
    identityCalls: starts.filter((item) => item.kind === 'identity').length,
    ownershipCalls: starts.filter((item) => item.kind === 'ownership').length,
    helperRuns,
    gatewayMarkers: markers.map((marker) => ({ pid: marker.pid, ppidIsLauncher: marker.ppid === launched.pid, port: marker.port, logDirProvided: marker.logDirProvided })),
    storeBefore,
    storeAfter,
    lockBefore,
    lockAfter,
    port,
    portFreeAfter: portAfter.available,
    sentinelAlive: sentinelAlive(),
  };
  const expect = definition.expect;
  const stalled = helperRuns.filter((item) => item.heartbeats !== null);
  const natural = helperRuns.filter((item) => item.heartbeats === null);
  const checks = [
    ['launcher exited without driver watchdog', !launched.watchdog, false, launched.watchdog],
    ['launcher exit code', launched.code === expect.launcherExit, expect.launcherExit, launched.code],
    ['stdout empty', launched.stdout.length === 0, 0, launched.stdout.length],
    ['closed launcher.log code', last?.code === expect.code, expect.code, last?.code ?? null],
    ['launcher.log stage gateway', last?.stage === 'gateway', 'gateway', last?.stage ?? null],
    ['identity helper calls', observed.identityCalls === expect.identityCalls, expect.identityCalls, observed.identityCalls],
    ['ownership helper calls', within(observed.ownershipCalls, expect.ownershipCalls), expect.ownershipCalls, observed.ownershipCalls],
    ['fixture gateway-start markers', markers.length === expect.gatewayMarkers, expect.gatewayMarkers, markers.length],
    ['every helper and marker was created by this launcher', helperRuns.every((item) => item.ppidIsLauncher) && observed.gatewayMarkers.every((item) => item.ppidIsLauncher), true, { helpers: helperRuns.map((item) => item.ppidIsLauncher), markers: observed.gatewayMarkers.map((item) => item.ppidIsLauncher) }],
    ['non-stalled helper roots exited naturally with 0', natural.every((item) => item.naturalExit && item.exitCode === 0), true, natural.map((item) => item.exitCode)],
    ['launcher elapsed within expected bounds', within(launched.ms, expect.elapsedMs), expect.elapsedMs, launched.ms],
    ['store names and bytes preserved', JSON.stringify(storeBefore) === JSON.stringify(storeAfter), true, JSON.stringify(storeBefore) === JSON.stringify(storeAfter)],
    ['owner record bytes and file identity preserved', JSON.stringify(lockBefore) === JSON.stringify(lockAfter), lockBefore, lockAfter],
    ['owned port not listening afterwards', portAfter.available, true, portAfter.available],
    ['unrelated sentinel alive', observed.sentinelAlive, true, observed.sentinelAlive],
  ];
  if (expect.childExit !== undefined) checks.push(['launcher-observed fixture gateway exit', last?.childExit === expect.childExit, expect.childExit, last?.childExit ?? null]);
  if (expect.recordLock) checks.push(['record lock is the held lock path', sameLock(last?.lock, lockPath), 'lockPath', last?.lock ?? null]);
  for (const text of expect.stderrIncludes ?? []) checks.push([`stderr includes: ${text}`, stderr.includes(text), true, stderr.includes(text)]);
  for (const text of expect.stderrExcludes ?? []) checks.push([`stderr excludes: ${text}`, !stderr.includes(text), false, stderr.includes(text)]);
  if (expect.stalled) {
    const item = helperRuns.find((entry) => entry.kind === expect.stalled.kind && entry.index === expect.stalled.index);
    checks.push(['stalled helper observed', Boolean(item && item.heartbeats > 0), true, item?.heartbeats ?? null]);
    checks.push(['stalled helper had no natural exit (terminated by the launcher job)', item && !item.naturalExit, false, item?.naturalExit ?? null]);
    checks.push(['stalled helper heartbeat stopped after launcher exit', item?.heartbeatStopped === true && item?.lastHeartbeatBeforeLauncherExit === true, true, { stopped: item?.heartbeatStopped, beforeExit: item?.lastHeartbeatBeforeLauncherExit }]);
    checks.push([`stalled helper lifetime < ${expect.stalled.maxLifetimeMs} ms`, typeof item?.heartbeatLifetimeMs === 'number' && item.heartbeatLifetimeMs < expect.stalled.maxLifetimeMs, `< ${expect.stalled.maxLifetimeMs}`, item?.heartbeatLifetimeMs ?? null]);
  }
  const record = { id: definition.id, name: definition.name, entry: 'GraphGoblin.exe --config <file> --ensure-gateway', observed };
  judge(record, checks);
  const privateCase = join(privateRun, definition.id);
  mkdirSync(privateCase, { recursive: true });
  writeFileSync(join(privateCase, 'stdout.bin'), launched.stdout);
  writeFileSync(join(privateCase, 'stderr.bin'), launched.stderr);
  for (const name of ['scenario.json', 'events.ndjson', 'gateway-markers.ndjson', ...heartbeatFiles]) if (existsSync(join(caseDir, name))) cpSync(join(caseDir, name), join(privateCase, name));
  for (const name of ['GraphGoblin.json', 'launcher.log']) if (existsSync(join(configDir, name))) cpSync(join(configDir, name), join(privateCase, name));
  return record;
}

async function realGatewayCase(definition) {
  const caseDir = join(work, definition.id);
  const configDir = privateDirectory(join(caseDir, 'config'));
  const store = join(caseDir, 'store');
  mkdirSync(store, { recursive: true });
  const port = await choosePort();
  const config = { Repo: checkout, Node: process.execPath, DataDir: store, Port: port, Environment: { GG_LOG_LEVEL: 'info', GG_OLLAMA_ENABLED: 'false' }, StartupTimeoutSeconds: 60, WindowTimeoutSeconds: 2 };
  const configPath = join(configDir, 'GraphGoblin.json');
  writeFileSync(configPath, JSON.stringify(config));
  const sentinelBefore = sentinelAlive();
  const cold = await launch(launcherExe, ['--config', configPath, '--ensure-gateway'], baseEnv(), 90_000);
  const afterCold = await health(port);
  const warm = await launch(launcherExe, ['--config', configPath, '--ensure-gateway'], baseEnv(), 90_000);
  const afterWarm = await health(port);
  const sentinelDuring = sentinelAlive();
  // Driver teardown: the ordinary deliberate drain of this disposable gateway; never a PID kill.
  const teardown = { kind: 'driver-teardown-drain', requestedAt: now() };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/system/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'drain' }), signal: AbortSignal.timeout(3000) });
    teardown.status = response.status;
  } catch (error) {
    teardown.error = error.cause?.code ?? error.name;
  }
  for (let i = 0; i < 300; i++) {
    const probe = await health(port);
    if (probe.status === null) {
      teardown.drained = true;
      break;
    }
    await sleep(100);
  }
  teardown.drained ??= false;
  await sleep(500);
  const portAfter = await portAvailable(port);
  teardown.portFreeAfter = portAfter.available;
  teardown.completedAt = now();
  const records = lines(join(configDir, 'launcher.log'));
  const observed = {
    port,
    cold: { pid: cold.pid, exit: cold.code, watchdog: cold.watchdog, ms: cold.ms, stdoutBytes: cold.stdout.length, stderrBytes: cold.stderr.length },
    afterCold,
    warm: { pid: warm.pid, exit: warm.code, watchdog: warm.watchdog, ms: warm.ms, stdoutBytes: warm.stdout.length, stderrBytes: warm.stderr.length },
    afterWarm,
    launcherRecords: records.length,
    gatewayLogPresent: existsSync(join(configDir, 'gateway.log')),
    sentinelBefore,
    sentinelDuring,
    sentinelAfter: sentinelAlive(),
    teardown,
  };
  const gatewayPid = Number(afterCold.pid);
  const checks = [
    ['cold click exits 0 with empty stdout/stderr', cold.code === 0 && !cold.watchdog && cold.stdout.length === 0 && cold.stderr.length === 0, '0, empty', [cold.code, cold.stdout.length, cold.stderr.length]],
    ['detached gateway healthy after the launcher exited', afterCold.status === 200, 200, afterCold.status],
    ['gateway reports a 64-hex instance identity', /^[a-f0-9]{64}$/.test(afterCold.instance ?? ''), '64 hex', afterCold.instance],
    ['gateway is a distinct process from the cold launcher', Number.isInteger(gatewayPid) && gatewayPid > 0 && gatewayPid !== cold.pid, '!= launcher pid', { gateway: afterCold.pid, launcher: cold.pid }],
    ['warm click exits 0 with empty stdout/stderr', warm.code === 0 && !warm.watchdog && warm.stdout.length === 0 && warm.stderr.length === 0, '0, empty', [warm.code, warm.stdout.length, warm.stderr.length]],
    ['warm click reused the same gateway (same pid and identity)', afterWarm.status === 200 && afterWarm.pid === afterCold.pid && afterWarm.instance === afterCold.instance, afterCold.pid, afterWarm.pid],
    ['no launcher.log refusal records', records.length === 0, 0, records.length],
    ['unrelated sentinel alive before, during and after', sentinelBefore && sentinelDuring && observed.sentinelAfter, true, [sentinelBefore, sentinelDuring, observed.sentinelAfter]],
    ['driver drain teardown completed and port freed', teardown.drained === true && teardown.portFreeAfter === true, true, [teardown.drained, teardown.portFreeAfter]],
  ];
  const record = { id: definition.id, name: definition.name, entry: 'GraphGoblin.exe --config <file> --ensure-gateway (real built gateway)', observed };
  judge(record, checks);
  const privateCase = join(privateRun, definition.id);
  mkdirSync(privateCase, { recursive: true });
  for (const [label, item] of [['cold', cold], ['warm', warm]]) {
    writeFileSync(join(privateCase, `${label}.stdout.bin`), item.stdout);
    writeFileSync(join(privateCase, `${label}.stderr.bin`), item.stderr);
  }
  for (const name of ['GraphGoblin.json', 'launcher.log', 'gateway.log']) if (existsSync(join(configDir, name))) cpSync(join(configDir, name), join(privateCase, name));
  return record;
}

async function publicEntryCase(definition) {
  const caseDir = join(work, definition.id);
  mkdirSync(caseDir, { recursive: true });
  const resultPath = join(caseDir, 'result.json');
  const launched = await launch(publicEntryExe, [process.execPath, join(caseDir, 'helper-work'), resultPath], baseEnv(), 60_000);
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
  const expired = result?.expired ?? {};
  const onTime = result?.onTime ?? {};
  const checks = [
    ['public harness completed', launched.code === 0 && !launched.watchdog && result !== null, 0, launched.code],
    ['public Read with Start(0) refuses helper-timeout', expired.code === 'helper-timeout', 'helper-timeout', expired.code ?? null],
    ['expired entry: owned marker never written (no native child ran)', expired.markerExists === false, false, expired.markerExists ?? null],
    ['expired entry: validator never called', expired.validations === 0, 0, expired.validations ?? null],
    ['expired entry returned without a cleanup allowance (< 1000 ms)', typeof expired.ms === 'number' && expired.ms < 1000, '< 1000', expired.ms ?? null],
    ['control Start(15000) returns ok', onTime.code === 'returned' && onTime.value === 'ok', 'ok', onTime.value ?? onTime.code ?? null],
    ['control marker written by the on-time helper', onTime.markerExists === true, true, onTime.markerExists ?? null],
    ['unrelated sentinel alive', sentinelAlive(), true, sentinelAlive()],
  ];
  const record = { id: definition.id, name: definition.name, entry: 'Qa167iPublicEntry.exe (public HelperProcess.Read + WorkDeadline.Start)', observed: { pid: launched.pid, exit: launched.code, ms: launched.ms, result } };
  judge(record, checks);
  const privateCase = join(privateRun, definition.id);
  mkdirSync(privateCase, { recursive: true });
  writeFileSync(join(privateCase, 'stdout.bin'), launched.stdout);
  writeFileSync(join(privateCase, 'stderr.bin'), launched.stderr);
  if (result) cpSync(resultPath, join(privateCase, 'result.json'));
  return record;
}

const definitions = selected.length ? frozen.nativeCases.filter((item) => selected.includes(item.id)) : frozen.nativeCases;
for (const definition of definitions) {
  let record;
  if (definition.kind === 'fixture') record = await fixtureCase(definition);
  else if (definition.kind === 'real-gateway') record = await realGatewayCase(definition);
  else record = await publicEntryCase(definition);
  run.cases.push(record);
  save();
  console.log(`${record.id} ${record.status} ${record.assertions.filter((item) => item.pass).length}/${record.assertions.length}`);
}

// Driver teardown of the sentinel by its exact retained handle (not product cleanup).
run.sentinel.aliveAtTeardown = sentinelAlive();
sentinel.kill();
run.sentinel.teardown = { kind: 'driver-teardown', ...(await sentinelExit) };
run.endUtc = now();
run.status = 'COMPLETED';
run.summary = {
  cases: run.cases.length,
  passed: run.cases.filter((item) => item.status === 'PASS').length,
  failed: run.cases.filter((item) => item.status === 'FAIL').length,
  assertions: run.cases.reduce((sum, item) => sum + item.assertions.length, 0),
  assertionsPassed: run.cases.reduce((sum, item) => sum + item.assertions.filter((entry) => entry.pass).length, 0),
};
save();
writeFileSync(join(publicRun, 'run.json'), JSON.stringify(scrub(run), null, 2) + '\n');
console.log(JSON.stringify({ runId, summary: run.summary, setupFaults: run.setupFaults.length }));
