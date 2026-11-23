// QA459I independent #459 correction QA driver. Not product code.
// Drives the actual compiled public Gateway.Ensure ownership path (through Qa459iHarness.exe, which
// references the unmodified compiled launcher assembly) against disposable fixture repositories,
// stores, private log folders and an owned loopback port. Fixture helper/gateway scripts are
// ordinary harmless local Node scripts. A driver-owned marker in the fixture gateway main script
// witnesses that the ordinary gateway-start path ran; it is not evidence of a ready gateway.
//
// node qa459i-driver.mjs --checkout <dir> --scratch <dir> --out <dir> --build-record <json>
//   --label baseline|candidate [--cases Q01,Q02] [--expect-head <sha>] [--expect-tree <sha>]
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CASES, EXPECTED, GATEWAY_EXIT, IDENTITY_HEX, OWNER_RECORD, STARTUP_SECONDS, STORE_SENTINEL } from './qa459i-cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORTS = [25840, 25859]; // independent reservation; never the author's 25810-25829 or owner ports
const HARNESS_WATCHDOG_MS = 90_000;
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${name}`);
  }
  return process.argv[index + 1];
};
const checkout = option('--checkout');
const scratch = option('--scratch');
const out = option('--out');
const buildRecordPath = option('--build-record');
const label = option('--label');
const selected = option('--cases', '').split(',').filter(Boolean);
const expectHead = option('--expect-head', EXPECTED.head);
const expectTree = option('--expect-tree', EXPECTED.tree);
if (!['baseline', 'candidate'].includes(label)) throw new Error('label must be baseline or candidate');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileSha = (path) => sha256(readFileSync(path));
const now = () => new Date().toISOString();
const stamp = now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const runId = `${label}-${stamp}-${randomBytes(3).toString('hex')}`;
const privateRun = join(out, 'private', 'runs', runId);
const publicRun = join(out, 'public', 'runs', runId);
const scratchRun = join(scratch, 'runs', runId);
for (const path of [privateRun, publicRun, scratchRun]) {
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  mkdirSync(path, { recursive: true });
}
const run = { schema: 'qa459i-run/1', runId, label, startUtc: now(), node: process.version, execPath: process.execPath, ports: PORTS, setupFaults: [], cases: [] };
const saveRun = () => writeFileSync(join(privateRun, 'run.json'), JSON.stringify(run, null, 2) + '\n');

// ---------- scrubbing for public projections ----------
const roots = [
  [scratch, '<scratch>'],
  [checkout, '<checkout>'],
  [out, '<out>'],
  [homedir(), '<home>'],
];
function variants(path) {
  const back = path.replace(/\//g, '\\');
  const forward = path.replace(/\\/g, '/');
  return [back.replace(/\\/g, '\\\\'), back, forward];
}
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function scrub(value) {
  if (typeof value === 'string') {
    let text = value;
    for (const [path, token] of roots) for (const form of variants(path)) text = text.replace(new RegExp(escapeRegExp(form), 'gi'), token);
    return text.replace(/98jak/gi, '<user>');
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}

// ---------- helpers ----------
function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => resolve({ available: false, code: error.code }));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve({ available: true })));
  });
}
async function choosePort(start) {
  for (let port = start; port <= PORTS[1]; port++) {
    const probe = await portAvailable(port);
    if (probe.available) return port;
    run.setupFaults.push({ at: now(), kind: 'port-unavailable', port, code: probe.code, note: 'not inspected; another allowed port chosen' });
  }
  throw new Error('no available port in the independent reservation');
}
function snapshot(directory) {
  if (!existsSync(directory)) return null;
  const entries = [];
  const walk = (path) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const info = statSync(full);
      const rel = relative(directory, full);
      if (info.isDirectory()) {
        entries.push({ path: rel, type: 'dir' });
        walk(full);
      } else entries.push({ path: rel, type: 'file', bytes: info.size, sha256: fileSha(full) });
    }
  };
  walk(directory);
  return entries;
}
const readLines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
function runProcess(file, args, options) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    let watchdog = false;
    const timer = setTimeout(() => {
      watchdog = true;
      child.kill(); // exact retained libuv handle; driver watchdog, never product cleanup
    }, HARNESS_WATCHDOG_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, spawnError: error.code ?? String(error), startedUtc: new Date(started).toISOString(), ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), watchdog });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, code, signal, startedUtc: new Date(started).toISOString(), endedUtc: now(), ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), watchdog });
    });
  });
}
const sameLock = (observed, expected) => typeof observed === 'string' && observed.toLowerCase() === expected.toLowerCase();

// ---------- setup verification ----------
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
run.checkout = {
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').split('\n').filter(Boolean).length,
  expectedHead: expectHead,
  expectedTree: expectTree,
};
const sources = {
  'apps/windows-launcher/Launcher.cs': null,
  'apps/api/src/instance-identity.ts': null,
  'apps/api/src/data-dir-lock.ts': null,
  'apps/api/dist/instance-identity.js': null,
  'apps/api/dist/data-dir-lock.js': null,
};
for (const path of Object.keys(sources)) sources[path] = fileSha(join(checkout, path));
run.sources = sources;
const build = JSON.parse(readFileSync(buildRecordPath, 'utf8'));
const launcherExe = join(scratch, 'bin', 'GraphGoblin.exe');
const harnessExe = join(scratch, 'bin', 'Qa459iHarness.exe');
run.assemblies = {
  launcher: { sha256: fileSha(launcherExe), recorded: build.outputs.launcherAssembly.sha256 },
  harness: { sha256: fileSha(harnessExe), recorded: build.outputs.harnessAssembly.sha256 },
  launcherSourceAtBuild: build.inputs.launcherSource.sha256,
};
run.driver = Object.fromEntries(
  ['qa459i-driver.mjs', 'qa459i-cases.mjs', 'qa459i-build.mjs', 'harness/Qa459iHarness.cs'].map((path) => [path, fileSha(join(here, path))]),
);
const fail = (kind, detail) => {
  run.setupFaults.push({ at: now(), kind, detail });
  run.endUtc = now();
  run.status = 'SETUP-FAULT';
  saveRun();
  console.error(`setup fault: ${kind}`);
  process.exit(3);
};
if (run.checkout.head !== expectHead || run.checkout.tree !== expectTree || run.checkout.trackedChanges !== 0) fail('checkout-mismatch', run.checkout);
if (run.assemblies.launcher.sha256 !== run.assemblies.launcher.recorded || run.assemblies.harness.sha256 !== run.assemblies.harness.recorded) fail('assembly-mismatch', run.assemblies);
if (run.assemblies.launcherSourceAtBuild !== sources['apps/windows-launcher/Launcher.cs']) fail('launcher-source-changed-since-build', run.assemblies);

// Disposable fixture repository: exact copies of the frozen fixture sources.
const fixtureRepo = join(scratchRun, 'fixture-repo');
cpSync(join(here, 'fixtures', 'repo'), fixtureRepo, { recursive: true });
run.fixtureRepo = Object.fromEntries(snapshot(fixtureRepo).filter((entry) => entry.type === 'file').map((entry) => [entry.path.replace(/\\/g, '/'), entry.sha256]));
for (const [path, hash] of Object.entries(run.fixtureRepo)) if (fileSha(join(here, 'fixtures', 'repo', path)) !== hash) fail('fixture-copy-mismatch', path);
const realProducer = join(checkout, 'apps', 'api', 'dist', 'instance-identity.js');
saveRun();

let port = await choosePort(PORTS[0]);

// Preflight: public Configuration.Validate(true) and LogRoot.Admit only; no Gateway.Ensure.
{
  const directory = join(scratchRun, 'preflight');
  const store = join(directory, 'store-α');
  mkdirSync(store, { recursive: true });
  const result = join(directory, 'harness-result.json');
  const process_ = await runProcess(harnessExe, ['--preflight', fixtureRepo, process.execPath, store, String(port), String(STARTUP_SECONDS), join(directory, 'launcher-log'), join(directory, 'launcher-log', 'GraphGoblin.exe.json'), result], { env: { ...process.env } });
  const parsed = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8')) : null;
  run.preflight = { exit: process_.code, watchdog: process_.watchdog, ms: process_.ms, result: parsed };
  if (process_.code !== 0 || parsed?.setup !== 'ok') fail('preflight', run.preflight);
}

// Unrelated same-executable sentinel with a bounded natural lifetime; exact handle retained.
const sentinel = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(46),1200000)'], { stdio: 'ignore', windowsHide: true });
const sentinelExit = new Promise((resolve) => sentinel.on('exit', (code, signal) => resolve({ code, signal, at: now() })));
run.sentinel = { pid: sentinel.pid, startedUtc: now() };
saveRun();

const cases = selected.length ? CASES.filter((item) => selected.includes(item.id)) : CASES;
for (const definition of cases) {
  const caseDir = join(scratchRun, definition.id);
  const store = join(caseDir, 'store-α');
  const logDir = join(caseDir, 'launcher-log');
  const privateCase = join(privateRun, definition.id);
  mkdirSync(store, { recursive: true });
  mkdirSync(join(privateCase, 'responses'), { recursive: true });
  const lockPath = join(store, 'graphgoblin.lock');
  writeFileSync(join(store, 'qa459i-unrelated-sentinel.bin'), STORE_SENTINEL(definition.id));
  if (definition.store.ownerRecord) writeFileSync(lockPath, OWNER_RECORD);
  const canonicalLock = definition.store.ownerRecord ? realpathSync.native(lockPath) : join(realpathSync.native(store), 'graphgoblin.lock');
  const ctx = { lockPath, caseDir };
  const identity = definition.identity ? definition.identity(ctx) : Buffer.from(`${IDENTITY_HEX}\n`, 'utf8');
  const ownership = definition.ownership.map((spec) => (spec.source === 'bytes' ? { source: 'bytes', bytes: spec.bytes(ctx) } : { source: spec.source }));
  const stderrCanary = `QA459I_STDERR_CANARY_${definition.id}`;
  writeFileSync(
    join(caseDir, 'scenario.json'),
    JSON.stringify({
      caseId: definition.id,
      stderrCanary,
      realProducer,
      identity: { source: 'bytes', base64: identity.toString('base64') },
      ownership: ownership.map((spec) => (spec.source === 'bytes' ? { source: 'bytes', base64: spec.bytes.toString('base64') } : spec)),
    }),
  );
  writeFileSync(join(privateCase, 'responses', 'identity.bin'), identity);
  ownership.forEach((spec, index) => spec.bytes && writeFileSync(join(privateCase, 'responses', `ownership-${index + 1}.bin`), spec.bytes));
  const before = snapshot(store);
  port = await choosePort(port);
  const resultPath = join(caseDir, 'harness-result.json');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GG_/i.test(key)));
  env.QA459I_CASE_DIR = caseDir;
  const harness = await runProcess(harnessExe, ['--ensure', fixtureRepo, process.execPath, store, String(port), String(STARTUP_SECONDS), logDir, join(logDir, 'GraphGoblin.exe.json'), resultPath], { env });
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
  const events = readLines(join(caseDir, 'events.ndjson'));
  const markers = readLines(join(caseDir, 'gateway-markers.ndjson'));
  const after = snapshot(store);
  const logAfter = snapshot(logDir);
  const portAfter = await portAvailable(port);
  const sentinelAlive = sentinel.exitCode === null && sentinel.signalCode === null;

  // Raw private originals.
  writeFileSync(join(privateCase, 'harness.stdout.bin'), harness.stdout);
  writeFileSync(join(privateCase, 'harness.stderr.bin'), harness.stderr);
  for (const name of ['scenario.json', 'harness-result.json', 'events.ndjson', 'gateway-markers.ndjson'])
    if (existsSync(join(caseDir, name))) cpSync(join(caseDir, name), join(privateCase, name));
  const producerOutputs = [];
  for (const name of existsSync(caseDir) ? readdirSync(caseDir) : [])
    if (/^real-producer-\d+\.(stdout|stderr)\.bin$/.test(name)) {
      cpSync(join(caseDir, name), join(privateCase, name));
      if (name.endsWith('.stdout.bin')) {
        const bytes = readFileSync(join(caseDir, name));
        producerOutputs.push({ file: name, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') });
      }
    }

  const starts = events.filter((item) => item.event === 'helper-start');
  const exits = events.filter((item) => item.event === 'helper-exit');
  const calls = (kind) => starts.filter((item) => item.kind === kind).length;
  const helperRuns = starts.map((start) => {
    const exit = exits.find((item) => item.kind === start.kind && item.index === start.index && item.pid === start.pid);
    return { kind: start.kind, index: start.index, pid: start.pid, startAt: start.at, exitAt: exit?.at ?? null, exitCode: exit ? exit.code : null, ms: exit ? exit.at - start.at : null };
  });
  const surfaces = [result?.message, result?.presented, result?.logRecord].filter((text) => typeof text === 'string').join('\n');
  const canaries = [...new Set([stderrCanary, ...ownership.flatMap((spec) => (spec.bytes ? spec.bytes.toString('utf8').match(/QA459I_[A-Z]+_CANARY_Q\d\d/g) ?? [] : []))])];
  const observed = {
    harnessPid: harness.pid,
    harnessExit: harness.code,
    harnessWatchdog: harness.watchdog,
    harnessMs: harness.ms,
    setup: result?.setup ?? null,
    outcome: result?.outcome ?? null,
    code: result?.code ?? null,
    childExit: result?.childExit ?? null,
    lock: result?.lock ?? null,
    logFolder: result?.logFolder ?? null,
    message: result?.message ?? null,
    presented: result?.presented ?? null,
    logRecord: result?.logRecord ?? null,
    exceptionType: result?.exceptionType ?? null,
    ensureElapsedMs: result?.ensureElapsedMs ?? null,
    authorizedFreshGateway: markers.length > 0,
    gatewayMarkers: markers.map((marker) => ({ pid: marker.pid, ppidIsHarness: marker.ppid === result?.harnessPid, port: marker.port, logDirProvided: marker.logDirProvided, at: marker.at })),
    identityCalls: calls('identity'),
    ownershipCalls: calls('ownership'),
    helperRuns,
    helperRootsExitedNaturallyZero: helperRuns.length > 0 && helperRuns.every((item) => item.exitCode === 0),
    realProducer: producerOutputs.map(({ text, ...rest }) => rest),
    realProducerEvents: events.filter((item) => item.event === 'real-producer-exit').map(({ at, index, producerPid, code, signal, bytes }) => ({ at, index, producerPid, code, signal, bytes })),
    canariesChecked: canaries,
    canariesFound: canaries.filter((token) => surfaces.includes(token)),
    storeBefore: before,
    storeAfter: after,
    storePreserved: JSON.stringify(before) === JSON.stringify(after),
    ownerRecordPreserved: definition.store.ownerRecord ? after.some((entry) => entry.path === 'graphgoblin.lock' && entry.sha256 === sha256(OWNER_RECORD)) : !after.some((entry) => entry.path === 'graphgoblin.lock'),
    logDirAfter: logAfter,
    portFreeAfter: portAfter.available,
    port,
    sentinelAlive,
  };

  function judge(expectation) {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
    check('authorizes fresh gateway start', observed.authorizedFreshGateway === expectation.authorizes, { expected: expectation.authorizes, observed: observed.authorizedFreshGateway });
    check('closed code', observed.code === expectation.code, { expected: expectation.code, observed: observed.code });
    if (expectation.childExit !== undefined) check('launcher-observed gateway exit', observed.childExit === expectation.childExit, { expected: expectation.childExit, observed: observed.childExit });
    check('identity calls', observed.identityCalls === 1, { expected: 1, observed: observed.identityCalls });
    const [min, max] = expectation.ownershipCalls;
    check('ownership calls', observed.ownershipCalls >= min && observed.ownershipCalls <= max, { expected: expectation.ownershipCalls, observed: observed.ownershipCalls });
    if (expectation.lock === 'lockPath') check('lock location', sameLock(observed.lock, canonicalLock) || sameLock(observed.lock, lockPath));
    for (const text of expectation.messageIncludes ?? []) check(`message includes: ${text.slice(0, 60)}`, typeof observed.message === 'string' && observed.message.includes(text));
    return checks;
  }
  const controls = [
    { name: 'harness completed without watchdog', pass: harness.code === 0 && !harness.watchdog && observed.setup === 'ok' },
    { name: 'closed LauncherFailure (no unexpected exception)', pass: observed.outcome === 'launcher-failure' },
    { name: 'no private canary in message, presentation or log record', pass: observed.canariesFound.length === 0, detail: observed.canariesFound },
    { name: 'store bytes and names preserved', pass: observed.storePreserved },
    { name: 'driver-owned owner record state preserved', pass: observed.ownerRecordPreserved },
    { name: 'no gateway.log or launcher.log written in log folder', pass: Array.isArray(logAfter) && logAfter.length === 0, detail: logAfter },
    { name: 'helper roots exited naturally with 0', pass: observed.helperRootsExitedNaturallyZero },
    { name: 'gateway markers parented by harness', pass: observed.gatewayMarkers.every((marker) => marker.ppidIsHarness) },
    { name: 'gateway-start marker agrees with launcher-observed exit 54', pass: observed.authorizedFreshGateway === (observed.code === 'unknown-exit' && observed.childExit === GATEWAY_EXIT) },
    { name: 'owned port free after case', pass: observed.portFreeAfter },
    { name: 'unrelated sentinel alive', pass: observed.sentinelAlive },
  ];
  const prediction = judge(definition.baseline);
  const contract = judge(definition.corrected);
  const setupFault = !controls[0].pass;
  const record = {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    purpose: definition.purpose,
    responses: {
      identity: { bytes: identity.length, sha256: sha256(identity), text: identity.toString('utf8') },
      ownership: ownership.map((spec, index) =>
        spec.bytes ? { call: index + 1, source: 'bytes', bytes: spec.bytes.length, sha256: sha256(spec.bytes), text: spec.bytes.toString('utf8') } : { call: index + 1, source: spec.source },
      ),
      repeatsLast: true,
      realProducerOutputs: producerOutputs,
    },
    baselinePrediction: definition.baseline,
    correctedExpectation: definition.corrected,
    observed,
    controls,
    predictionChecks: prediction,
    correctedContractChecks: contract,
    status: setupFault ? 'SETUP-FAULT' : prediction.every((item) => item.pass) && controls.every((item) => item.pass) ? 'MATCHED-PREDICTION' : 'DIFFERED-FROM-PREDICTION',
    correctedContract: setupFault ? 'NOT-EVALUATED' : contract.every((item) => item.pass) ? 'CONFORMS' : 'VIOLATES',
  };
  writeFileSync(join(privateCase, 'case.json'), JSON.stringify(record, null, 2) + '\n');
  mkdirSync(join(publicRun, 'cases'), { recursive: true });
  writeFileSync(join(publicRun, 'cases', `${definition.id}.json`), JSON.stringify(scrub(record), null, 2) + '\n');
  run.cases.push({ id: definition.id, name: definition.name, status: record.status, correctedContract: record.correctedContract, authorized: observed.authorizedFreshGateway, code: observed.code, ownershipCalls: observed.ownershipCalls, ms: harness.ms });
  saveRun();
  console.log(`${definition.id} ${record.status} ${record.correctedContract} authorized=${observed.authorizedFreshGateway} code=${observed.code} ownershipCalls=${observed.ownershipCalls} ms=${harness.ms}`);
  if (setupFault) {
    run.setupFaults.push({ at: now(), kind: 'case-setup-fault', caseId: definition.id });
    break; // a setup fault stops the run; no unchanged retry
  }
}

// Driver teardown of the sentinel by its exact retained handle (not product cleanup).
const aliveAtTeardown = sentinel.exitCode === null && sentinel.signalCode === null;
sentinel.kill();
run.sentinel.aliveAtTeardown = aliveAtTeardown;
run.sentinel.teardown = { kind: 'driver-teardown', ...(await sentinelExit) };
run.endUtc = now();
run.status = run.cases.some((item) => item.status === 'SETUP-FAULT') ? 'SETUP-FAULT' : 'COMPLETED';
run.summary = {
  cases: run.cases.length,
  matchedPrediction: run.cases.filter((item) => item.status === 'MATCHED-PREDICTION').length,
  differedFromPrediction: run.cases.filter((item) => item.status === 'DIFFERED-FROM-PREDICTION').length,
  setupFault: run.cases.filter((item) => item.status === 'SETUP-FAULT').length,
  conformsToCorrectedContract: run.cases.filter((item) => item.correctedContract === 'CONFORMS').length,
  violatesCorrectedContract: run.cases.filter((item) => item.correctedContract === 'VIOLATES').length,
  authorizedFreshGateway: run.cases.filter((item) => item.authorized).length,
};
saveRun();
writeFileSync(join(publicRun, 'run.json'), JSON.stringify(scrub(run), null, 2) + '\n');
console.log(JSON.stringify(run.summary));
