import assert from 'node:assert/strict';
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { admit, describe, save, sha, suite, under, verify, within } from './binding.mjs';
import { privateRootReadback, observeStdio, privateFailure } from './controls.mjs';

const [admission, digest, ...extra] = process.argv.slice(2);
assert.deepEqual(extra, []);
const job = await admit(admission, digest);
const { binding, cfg, node, nativeLib } = job;
const { bounded, createNative, observe, refused, selectPort } = nativeLib;
const { fixtureLayout, gatewayCap, pinoRecords, sample, tail } = job.inventory;
const { authCanary, healthy, invalidAuthorization, queryCanary, releaseWork, request, startWork,
  traffic, workState } = job.workload;
const { confirmLauncherChildrenAbsent, confirmOwnedCleanup } = job.windows;
const limits = cfg.pressure;
assert.deepEqual(limits, { requests: 100000, batch: 256, workers: 12, milliseconds: 180000 });
assert.equal(cfg.definitionFormat, 4, 'Recheck the authored fixture on a changed definition format');
assert.equal(cfg.gatewayEntry, 'apps/api/dist/main.js');
assert.deepEqual(cfg.gatewayArguments, []);
assert.deepEqual(cfg.launcherConfig, {});
assert.deepEqual(cfg.gatewayEnvironment, {});
assert.equal(cfg.legacyPolicy, 'replace');
assert.deepEqual(cfg.logs, {
  gateway: { directory: 'install', active: 'gateway.log', previous: 'gateway.log.1', temporary: [] },
  launcher: { directory: 'install', active: 'launcher.log', previous: 'launcher.log.1', temporary: [] },
  fallback: { directory: 'temp', active: 'launcher.log', previous: 'launcher.log.1', temporary: [] },
});
const foreignListener = 'belongs to an unrelated or differently configured service (or an older GraphGoblin build)';
const attempts = join(suite, 'attempts');
await mkdir(attempts, { recursive: true });
assert.equal(await realpath(attempts), attempts);
const attempt = under(attempts, cfg.attempt);
await mkdir(attempt);
const evidence = join(attempt, 'evidence');
await mkdir(evidence);
const put = (name, value) => save(under(evidence, name), value);
const disposable = join(attempt, 'disposable');
const install = join(disposable, 'install');
const temp = join(disposable, 'temp');
const profile = join(disposable, 'profile');
const workdir = join(disposable, 'work');
const stores = ['store-a', 'store-b', 'store-port', 'store-shell'].map((name) => under(disposable, name));
const roles = fixtureLayout(disposable, cfg);
const gatewayActive = roles.find((slot) => slot.key === 'gateway' && slot.role === 'active').file;
const launcherActive = roles.find((slot) => slot.key === 'launcher' && slot.role === 'active').file;
const unrelated = join(dirname(gatewayActive), 'qa438-unrelated.keep');
const canary = 'Independent QA unrelated file\n';
const entries = new Set([unrelated]);
const ownedPorts = new Set();
const processRecords = [];
const launcherLabels = new Set();
const gateways = new Set();
const processResults = [];
const observations = [];
const result = { mode: cfg.mode, startedAt: new Date().toISOString(), observations, processResults };
const cleanup = { gateways: [], ports: [], errors: [] };
const primaryConfigCanary = 'qa438-private-config-42d8050e';
const accessCanaries = [primaryConfigCanary, authCanary, queryCanary];
let native;
let opening;

async function directory(path) {
  assert(path === disposable || within(disposable, path));
  await mkdir(path, { recursive: true });
  assert.equal(await realpath(path), path);
  return path;
}

async function checkedSample(label) {
  const observed = await sample(roles, true, label, entries);
  await put('inventory-' + (observations.length + 1).toString().padStart(4, '0') + '.json', observed);
  observations.push(observed);
  if (!observed.unstable) {
    assert(observed.safe, observed.violations.concat(observed.unexpected).join('; '));
    assert(observed.rows.filter((row) => row.key === 'fallback').every((row) => row.id === undefined),
      'Managed TEMP must stay absent');
  }
  return observed;
}

function configFor(data, port) {
  return {
    Repo: binding.checkout, Node: node, DataDir: data, Port: port,
    LauncherAppUserModelId: 'GraphGoblin.QA438.Isolated', StartupTimeoutSeconds: 25, WindowTimeoutSeconds: 2,
    Environment: {
      GG_LOG_LEVEL: 'info', GG_REQUIRE_API_KEY: 'false', GG_OLLAMA_ENABLED: 'false', GG_SWAGGER_UI: 'false',
    },
  };
}

async function choosePort() {
  for (let count = 0; count < 4; count++) {
    const port = await selectPort();
    if (!ownedPorts.has(port)) {
      assert(await refused(port));
      ownedPorts.add(port);
      return port;
    }
  }
  throw new Error('Could not obtain a distinct fixture loopback port');
}

async function writeConfig(label, config, root = install) {
  const path = under(root, label + '.' + primaryConfigCanary + '.json');
  entries.add(path);
  await save(path, config);
  return path;
}

async function launch(label, path, expected, current = null) {
  launcherLabels.add(label);
  const call = native.run(label, binding.launcher.path, ['--config', path, '--ensure-gateway'],
    binding.checkout, { childEnv: native.envForProduct, timeout: 60_000 });
  if (current) current.nativeLabel = label;
  const observed = await call;
  processResults.push({ label, pid: observed.pid, code: observed.exit.code, stdoutBytes: observed.stdoutBytes,
    stderrBytes: observed.stderrBytes, exitAt: observed.exitAt, closeAt: observed.closeAt,
    stdoutEnd: observed.stdoutEnd, stderrEnd: observed.stderrEnd });
  assert.equal(observed.exit.code, expected, observed.stderr);
  assert.equal(observed.stdoutEnd?.bytes, observed.stdoutBytes, 'Launcher stdout EOF missing');
  assert.equal(observed.stderrEnd?.bytes, observed.stderrBytes, 'Launcher stderr EOF missing');
  if (expected === 0) assert.deepEqual([observed.stdoutBytes, observed.stderrBytes], [0, 0]);
  return observed;
}

async function fingerprint(config, label) {
  const output = await native.run('canonical identity ' + label, node,
    [join(binding.checkout, 'apps/api/dist/instance-identity.js')], binding.checkout, {
      childEnv: { ...native.envForProduct, ...config.Environment, GG_HOST: '127.0.0.1',
        GG_PORT: String(config.Port), GG_DATA_DIR: config.DataDir, GG_WEB_DIST: join(binding.checkout, 'apps/web/dist') },
      timeout: 18_000, reapReadOnly: true,
    });
  assert.equal(output.exit.code, 0);
  assert.match(output.stdout.trim(), /^[a-f0-9]{64}$/u);
  return output.stdout.trim();
}

const lockNames = ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'];
async function gatewayProof(current) {
  const { config, expected } = current;
  const health = await healthy(config.Port);
  assert.equal(health.identity, expected);
  assert.equal(health.phase, 'running');
  const proc = await native.cim(health.pid);
  const owner = processRecords.find(({ label }) => label === current.nativeLabel);
  assert(owner?.pid && Number.isSafeInteger(owner.pid));
  assert.equal(proc.parentPid, current.direct ? process.pid : owner.pid);
  if (current.direct) assert.equal(proc.pid, owner.pid);
  assert.equal(await realpath(proc.executable), node);
  const argv = [...proc.commandLine.matchAll(/"([^"]*)"|([^"\s]+)/gu)].map((match) => match[1] ?? match[2]);
  assert.equal(await realpath(argv[0]), node);
  assert.equal(await realpath(argv[1]), join(binding.checkout, cfg.gatewayEntry));
  assert.deepEqual(argv.slice(2), []);
  const leases = [];
  for (const name of lockNames) {
    const file = join(config.DataDir, name);
    assert.equal(await realpath(file), file);
    const raw = await readFile(file);
    const lease = JSON.parse(raw);
    assert.equal(lease.pid, health.pid);
    assert.equal(lease.windowsCreationTime, proc.creationFileTime);
    leases.push({ path: file, sha256: sha(raw) });
  }
  const sqlite = under(config.DataDir, 'graphgoblin.db');
  assert.equal(await realpath(sqlite), sqlite);
  const database = await open(sqlite, 'r');
  try {
    const header = Buffer.alloc(16);
    assert.equal((await database.read(header, 0, header.length, 0)).bytesRead, header.length);
    assert.equal(header.toString('ascii'), 'SQLite format 3\0');
  } finally { await database.close(); }
  return { health, proc, leases };
}

async function boot(config, file, label) {
  const expected = await fingerprint(config, label);
  const current = { label, config, expected };
  gateways.add(current);
  await launch(label, file, 0, current);
  current.proof = await gatewayProof(current);
  await put(label + '-gateway.json', current.proof);
  return current;
}

async function stop(current) {
  if (current.stopped) return current.stopped;
  const proof = current.proof ?? await gatewayProof(current);
  assert.deepEqual(await gatewayProof(current), proof);
  const { config: { Port: port, DataDir: store } } = current;
  if (current.work) {
    await releaseWork(current.work);
    const done = await observe('owned work completed', async () => {
      const run = await workState(port, current.work);
      if (run.status === 'succeeded') return run;
      assert(['running', 'queued', 'waiting'].includes(run.status), run.status);
      return false;
    }, 15_000);
    current.work.terminal = done.status;
  }
  assert.deepEqual(await gatewayProof(current), proof);
  const response = await request(port, '/system/shutdown');
  assert.equal(response.status, 200);
  const { controlToken } = await response.json();
  assert(typeof controlToken === 'string' && controlToken.length > 0);
  assert.deepEqual(await gatewayProof(current), proof);
  const drain = await request(port, '/system/shutdown', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
    body: '{"action":"drain"}',
  });
  assert.equal(drain.status, 202);
  await drain.arrayBuffer();
  await observe('gateway listener closed', () => refused(port), 25_000);
  const after = await observe('exact gateway PID birth absent', async () => {
    const row = await native.cim(proof.health.pid);
    return row.creationFileTime !== proof.proc.creationFileTime ? row : false;
  }, 12_000);
  for (const name of lockNames) {
    await assert.rejects(lstat(join(store, name)), { code: 'ENOENT' });
    await assert.rejects(lstat(join(store, name + '.reclaim')), { code: 'ENOENT' });
  }
  if (current.work?.scriptIdentity) {
    const script = await native.cim(current.work.scriptIdentity.pid);
    assert.notEqual(script.creationFileTime, current.work.scriptIdentity.creationFileTime);
    current.work.scriptIdentityAfter = script;
  }
  current.stopped = { label: current.label, port, pid: proof.health.pid, original: proof.proc.creationFileTime,
    after, drainStatus: drain.status, work: current.work ?? null };
  await put(current.label + '-exit-readback.json', current.stopped);
  return current.stopped;
}

async function shellControl() {
  const label = 'ordinary-shell';
  const port = await choosePort();
  const config = configFor(stores[3], port);
  const expected = await fingerprint(config, label);
  const current = { label, config, expected, direct: true, nativeLabel: label };
  const before = await checkedSample('before-shell');
  assert(!before.unstable);
  gateways.add(current);
  const shell = native.run(label, node, [join(binding.checkout, 'apps/api/dist/main.js')], binding.checkout, {
    childEnv: { ...native.envForProduct, ...config.Environment, GG_HOST: '127.0.0.1',
      GG_PORT: String(port), GG_DATA_DIR: config.DataDir, GG_WEB_DIST: join(binding.checkout, 'apps/web/dist') },
    timeout: 65_000,
  }).then((call) => ({ call }), (error) => ({ error }));
  current.proof = await observe('ordinary shell gateway ready', async () =>
    await refused(port) ? false : await gatewayProof(current), 25_000);
  await put('ordinary-shell-gateway.json', current.proof);
  await stop(current);
  const ended = await shell;
  if (ended.error) throw ended.error;
  assert.equal(ended.call.exit.code, 0, ended.call.stderr);
  assert(ended.call.stdout.includes('GraphGoblin API listening'));
  const after = await checkedSample('after-shell');
  assert.deepEqual(after.rows, before.rows, 'Shell start wrote to launcher-owned logs');
}

async function sustained(current) {
  const first = await checkedSample('before-pressure');
  assert(!first.unstable);
  const readiness = await observe('completed startup log', async () => {
    const bytes = await tail(gatewayActive);
    return pinoRecords(bytes).some((entry) => entry.msg === 'GraphGoblin API listening') ? bytes : false;
  }, 5000);
  await writeFile(join(evidence, 'initial-gateway.tail'), readiness, { flag: 'wx' });
  await traffic(current.config.Port, current.proof.health, 1, 1, 0);
  const firstAccess = await observe('completed projected access log', async () => {
    const bytes = await tail(gatewayActive);
    return pinoRecords(bytes).some((entry) => entry.msg === 'request completed' &&
      entry.res?.route === '/healthz') ? bytes : false;
  }, 5000);
  await writeFile(join(evidence, 'first-access.tail'), firstAccess, { flag: 'wx' });
  verifyAccess(firstAccess, current.config.DataDir);
  await authorizationControl(current);
  const held = await startWork({ port: current.config.Port, directory: workdir, node,
    definitionFormat: cfg.definitionFormat, observe }, (state) => { current.work = state; });
  held.scriptIdentity = await native.cim(held.scriptPid);
  assert.equal(held.scriptIdentity.parentPid, current.proof.health.pid);
  assert.equal(await realpath(held.scriptIdentity.executable), node);
  await put('work-held.json', held);
  const rotations = [];
  const pressureStart = await checkedSample('pressure-origin');
  assert(!pressureStart.unstable);
  let previous = pressureStart;
  let calibration = null;
  let sent = 0;
  const startMs = performance.now();
  const deadline = startMs + limits.milliseconds;
  while (sent < limits.requests && performance.now() < deadline) {
    const count = Math.min(limits.batch, limits.requests - sent);
    await traffic(current.config.Port, current.proof.health, count, limits.workers, sent);
    sent += count;
    const sample = await checkedSample('pressure-' + sent);
    if (sample.unstable) continue;
    const slot = (value, role) => value.rows.find((item) => item.key === 'gateway' && item.role === role);
    const oldCurrent = slot(previous, 'active');
    const newCurrent = slot(sample, 'active');
    const history = slot(sample, 'previous');
    if (!calibration && sent >= 2048 && newCurrent.id === slot(pressureStart, 'active').id) {
      const bytes = newCurrent.bytes - slot(pressureStart, 'active').bytes;
      const estimatedRequests = bytes > 0 ? Math.ceil(sent * (3 * gatewayCap / bytes)) : null;
      calibration = { sent, observedBytes: bytes, estimatedRequests, elapsedMs: performance.now() - startMs };
    }
    if (oldCurrent.id && newCurrent.id && oldCurrent.id !== newCurrent.id &&
        history.id === oldCurrent.id) {
      rotations.push({ previous: previous.label, next: sample.label, closedId: oldCurrent.id,
        newActiveId: newCurrent.id, retainedBytes: history.bytes });
    }
    previous = sample;
    if (rotations.length >= 3) break;
  }
  const elapsedMs = performance.now() - startMs;
  const pressure = { sent, elapsedMs, rotations, calibration,
    calibrationLimitation: 'Early file growth can include earlier pending bytes and omit bytes still pending or dropped.',
    last: previous };
  await put('pressure-summary.json', pressure);
  assert(sent <= limits.requests, 'Workload exceeded the fixed request budget');
  assert(elapsedMs <= limits.milliseconds, 'Workload exceeded the fixed elapsed budget');
  assert(rotations.length >= 3, 'Workload did not observe three active-to-previous identity moves');
  assert.equal((await workState(current.config.Port, held)).status, 'running');
  assert.deepEqual(await native.cim(held.scriptPid), held.scriptIdentity);
  assert.deepEqual(await gatewayProof(current), current.proof);
  const latest = await tail(gatewayActive);
  await writeFile(join(evidence, 'latest-gateway.tail'), latest, { flag: 'wx' });
  assert(pinoRecords(latest).some((value) => value.msg === 'request completed'), 'Recent request record missing');
  verifyAccess(latest, current.config.DataDir);
  await releaseWork(held);
  await observe('held run succeeds after rotation', async () =>
    (await workState(current.config.Port, held)).status === 'succeeded', 15_000);
  await put('work-after-pressure.json', await workState(current.config.Port, held));
}

async function authorizationControl(current) {
  const port = current.config.Port;
  const before = await healthy(port);
  const denied = await invalidAuthorization(port);
  await put('invalid-authorization-response.json', denied);
  const after = await healthy(port);
  const bytes = await tail(gatewayActive);
  await writeFile(join(evidence, 'invalid-authorization-gateway.tail'), bytes, { flag: 'wx' });
  const observed = {
    before: { status: 200, ...before }, invalidAuthorizationStatus: denied.status,
    after: { status: 200, ...after },
    authorizationCanaryPresentInCapturedTail: bytes.includes(authCanary),
    completed401RecordInCapturedTail: pinoRecords(bytes).some((value) =>
      value.msg === 'request completed' && value.res?.statusCode === 401),
    interpretation: 'A negative header match is limited to captured access records. The reached-serializer supplement covers its exact input.',
  };
  await put('invalid-authorization-observation.json', observed);
  assert.deepEqual(before, current.proof.health);
  assert.equal(denied.status, 401);
  assert.match(denied.contentType ?? '', /^application\/problem\+json\b/u);
  assert.equal(JSON.parse(denied.body).code, 'UNAUTHORIZED');
  assert.deepEqual(after, current.proof.health);
  verifyAccess(bytes, current.config.DataDir);
}

function verifyAccess(bytes, store) {
  const records = pinoRecords(bytes).filter((row) =>
    row.msg === 'incoming request' || row.msg === 'request completed');
  assert(records.length > 0, 'No reached access record was retained');
  for (const row of records) {
    const isRequest = row.msg === 'incoming request';
    const projection = isRequest ? row.req : row.res;
    assert(projection && typeof projection === 'object');
    assert(Object.keys(projection).every((field) =>
      (isRequest ? ['method', 'route'] : ['method', 'route', 'statusCode']).includes(field)));
    const raw = JSON.stringify(row);
    for (const value of [...accessCanaries, store, store.replaceAll('\\', '\\\\')]) {
      assert(!raw.includes(value), 'Canary escaped to a reached access record');
    }
  }
}

function verifyLauncher(output, diagnostic, config) {
  assert(output.stderr.includes(foreignListener));
  assert(output.stderr.includes('Configuration: ' + config));
  const record = pinoRecords(diagnostic).at(-1);
  assert.deepEqual([record.stage, record.code, record.config], ['gateway', 'foreign-listener', config]);
  assert.equal(record.childExit, undefined);
  for (const value of [record.config, record.logFolder, record.lock].filter(Boolean)) {
    assert(value.length <= 260 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
  }
  for (const value of [authCanary, queryCanary]) {
    assert(!output.stderr.includes(value) && !JSON.stringify(record).includes(value));
  }
}

async function nativeControls(current, file) {
  const warm = await launch('warm', file, 0);
  assert.notEqual(warm.pid, current.proof.health.pid);
  assert.deepEqual(await gatewayProof(current), current.proof);
  const other = await directory(join(disposable, 'other-config'));
  const otherConfig = await writeConfig('warm-other-root', current.config, other);
  await launch('warm-other-root', otherConfig, 0);
  assert.deepEqual(await gatewayProof(current), current.proof);
  assert.deepEqual(await readdir(other), [otherConfig.slice(other.length + 1)]);
  const wrong = await writeConfig('wrong-store', configFor(stores[1], current.config.Port));
  const refused = await launch('wrong-store', wrong, 1);
  assert.deepEqual(await gatewayProof(current), current.proof);
  assert.deepEqual(await readdir(stores[1]), []);
  const diagnostic = await tail(launcherActive, 256 * 1024);
  assert(diagnostic.length > 0, 'No launcher-owned diagnostic for actual refusal');
  await writeFile(join(evidence, 'launcher-diagnostic.tail'), diagnostic, { flag: 'wx' });
  verifyLauncher(refused, diagnostic, wrong);
  const server = createServer((_, reply) => {
    reply.writeHead(200, { 'content-type': 'application/json' });
    reply.end('{"status":"ok"}');
  });
  const port = await choosePort();
  try {
    await bounded('owned unrelated server', new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', done);
    }), 4000);
    const foreign = await writeConfig('occupied-port', configFor(stores[2], port));
    const response = await launch('occupied-port', foreign, 1);
    assert.equal((await request(port, '/healthz')).status, 200);
    assert.deepEqual(await readdir(stores[2]), []);
    verifyLauncher(response, await tail(launcherActive, 256 * 1024), foreign);
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await bounded('owned unrelated server closed', new Promise((done, fail) =>
        server.close((error) => error ? fail(error) : done())), 4000);
    }
  }
  assert(await nativeLib.refused(port));
  await checkedSample('post-refusals');
  assert.equal(await readFile(unrelated, 'utf8'), canary);
}

async function legacy(config, file) {
  const before = await checkedSample('before-legacy-seeding');
  assert(!before.unstable);
  const marker = 'qa438-recent-legacy-record';
  const padding = Buffer.from((JSON.stringify({ msg: 'older diagnostic', padding: 'p'.repeat(256) }) + '\n')
    .repeat(18000) + JSON.stringify({ msg: marker }) + '\n');
  assert(padding.length > gatewayCap);
  await writeFile(gatewayActive, padding);
  await put('legacy-seed.json', { bytes: padding.length, sha256: sha(padding), marker });
  const restarted = await boot(config, file, 'legacy-restart');
  const gatewaySlots = roles.filter((slot) => slot.key === 'gateway');
  const logs = await observe('completed legacy restart startup log for the serving PID', async () => {
    const slotBytes = await Promise.all(gatewaySlots.map((slot) => tail(slot.file)));
    const found = slotBytes.some((bytes) => pinoRecords(bytes).some((entry) =>
      entry.pid === restarted.proof.health.pid && entry.msg === 'GraphGoblin API listening'));
    return found ? Buffer.concat(slotBytes) : false;
  }, 5000);
  const during = await checkedSample('legacy-after-readiness');
  assert(!during.unstable);
  await writeFile(join(evidence, 'legacy-restart-gateway.tail'), logs, { flag: 'wx' });
  assert(!logs.includes(marker), 'Oversized stopped history was retained');
  await stop(restarted);
}

try {
  await writeFile(join(evidence, 'admission.json'), job.raw, { flag: 'wx' });
  opening = await verify(job);
  await put('opening-binding.json', opening);
  for (const path of [install, temp, profile, workdir, ...stores, ...roles.map((r) => dirname(r.file))]) {
    await directory(path);
  }
  await writeFile(unrelated, canary, { flag: 'wx' });
  native = createNative(evidence, processRecords);
  native.envForProduct = { ...native.env, PATH: dirname(node) + ';' + native.env.PATH,
    TEMP: temp, TMP: temp, USERPROFILE: profile, APPDATA: await directory(join(profile, 'Roaming')),
    LOCALAPPDATA: await directory(join(profile, 'Local')) };
  await put('install-privacy.json', await privateRootReadback(native, install));
  const port = await choosePort();
  const config = configFor(stores[0], port);
  const file = await writeConfig('primary', config);
  const primary = await boot(config, file, 'cold');
  await put('gateway-stdio.json', await observeStdio(native, evidence, cfg.stdio.path, node, primary.proof));
  assert.deepEqual(await gatewayProof(primary), primary.proof);
  await sustained(primary);
  await privateFailure({ port, pid: primary.proof.health.pid, request, observe, put, tail, pinoRecords,
    files: roles.filter((slot) => slot.key === 'gateway').map((slot) => slot.file) });
  await nativeControls(primary, file);
  await stop(primary);
  await legacy(config, file);
  const restarted = await boot(config, file, 'clean-restart');
  await checkedSample('clean-restart');
  await stop(restarted);
  await shellControl();
  const final = await checkedSample('final-managed-files');
  assert(!final.unstable);
  for (const [index, slot] of final.rows.entries()) {
    if (!slot.id) continue;
    const bytes = await readFile(slot.file);
    assert.equal(bytes.length, slot.bytes);
    assert.equal(bytes.at(-1), 10);
    pinoRecords(bytes);
    const recordCap = slot.stream === 'gateway' ? 65536 : 4096;
    let offset = 0;
    while (offset < bytes.length) {
      const next = bytes.indexOf(10, offset);
      assert(next >= 0 && next + 1 - offset <= recordCap);
      offset = next + 1;
    }
    await writeFile(join(evidence, 'managed-' + index + '.raw'), bytes, { flag: 'wx' });
  }
  assert.equal(await readFile(unrelated, 'utf8'), canary);
} catch (error) {
  result.firstFailure = describe(error);
  await put('first-failure.json', result.firstFailure);
  const tails = [];
  if (native) {
    for (const [index, slot] of roles.entries()) {
      try {
        const bytes = await tail(slot.file, 128 * 1024);
        if (bytes.length === 0) continue;
        const filename = 'first-failure-managed-' + index + '.tail';
        await writeFile(join(evidence, filename), bytes, { flag: 'wx' });
        tails.push({ slot: slot.file, filename, bytes: bytes.length, sha256: sha(bytes) });
      } catch (failure) { tails.push({ slot: slot.file, failure: describe(failure) }); }
    }
    await put('first-failure-file-readback.json', tails);
  }
} finally {
  for (const current of gateways) {
    try { cleanup.gateways.push(await stop(current)); } catch (error) {
      cleanup.errors.push({ current: current.label, ...describe(error) });
    }
  }
  for (const port of ownedPorts) {
    try {
      const free = await refused(port);
      cleanup.ports.push({ port, free });
      assert(free, 'Retained listener at ' + port);
    } catch (error) { cleanup.errors.push(describe(error)); }
  }
  for (const record of processRecords) {
    if (!record.exit || !record.close || record.exit.code !== record.close.code) {
      cleanup.errors.push({ label: record.label, pid: record.pid, issue: 'Child exit ambiguous' });
    }
  }
  if (opening && cleanup.errors.length === 0) {
    try {
      const launchers = processRecords.filter(({ label, pid }) => launcherLabels.has(label) && pid).map(({ pid }) => pid);
      cleanup.childCensus = await confirmLauncherChildrenAbsent(native, evidence, launchers);
      assert.deepEqual(cleanup.childCensus.rows, []);
      cleanup.exclusive = await confirmOwnedCleanup(native, disposable, stores, evidence);
      assert.equal(dirname(disposable), attempt);
      cleanup.disposableRetained = true;
    } catch (error) { cleanup.errors.push(describe(error)); }
  }
  await put('cleanup.json', cleanup);
  try {
    const closing = await verify(job);
    assert.deepEqual(closing, opening);
    await put('closing-binding.json', closing);
  } catch (error) { result.bindingError = describe(error); }
  result.completedAt = new Date().toISOString();
  result.status = result.firstFailure || result.bindingError || cleanup.errors.length ? 'incomplete' : 'observed';
  await put('result.json', result);
  process.exitCode = result.status === 'observed' ? 0 : 1;
}
