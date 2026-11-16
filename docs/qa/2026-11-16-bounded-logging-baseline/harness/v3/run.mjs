import assert from 'node:assert/strict';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { admit, describe, save, sha, suite, under, verify, within } from './binding.mjs';
import { fixtureLayout, gatewayCap, pinoRecords, sample, tail } from './inventory.mjs';
import { authCanary, healthy, invalidAuthorization, queryCanary, releaseWork, request, startWork,
  traffic, workState } from './workload.mjs';
import { confirmLauncherChildrenAbsent, confirmOwnedCleanup, withReadSharingDenial } from './windows.mjs';

const [admission, digest, ...extra] = process.argv.slice(2);
assert.deepEqual(extra, []);
const job = await admit(admission, digest);
const { binding, cfg, node, nativeLib } = job;
const { bounded, createNative, observe, refused, selectPort } = nativeLib;
const candidate = cfg.mode === 'candidate';
const limits = cfg.pressure;
for (const [key, minimum, maximum] of [
  ['requests', 4000, 125000], ['batch', 64, 1024], ['workers', 1, 24], ['milliseconds', 15000, 210000],
]) assert(Number.isInteger(limits[key]) && limits[key] >= minimum && limits[key] <= maximum, key);
assert.equal(cfg.definitionFormat, 4, 'Recheck the authored fixture on a changed definition format');
assert.match(cfg.gatewayEntry, /^apps\/api\/dist\/[A-Za-z0-9_-]+\.js$/u);
assert(Array.isArray(cfg.gatewayArguments) && cfg.gatewayArguments.length <= 12);
if (!candidate) {
  assert.deepEqual(cfg.gatewayArguments, []);
  assert.equal(cfg.gatewayEntry, 'apps/api/dist/main.js');
  assert.deepEqual(cfg.launcherConfig, {});
  assert.deepEqual(cfg.gatewayEnvironment, {});
}
if (candidate) {
  assert(['tail', 'replace'].includes(cfg.legacyPolicy));
  const required = ['wrongStore', 'occupiedPort'];
  assert(typeof cfg.faults.sharedDestination === 'boolean');
  if (cfg.faults.sharedDestination) required.push('sharedDestination');
  if (cfg.faults.nativeFallback !== null) {
    assert.equal(cfg.faults.nativeFallback.kind, 'read-share-denies-write-delete');
    assert(['persists', 'drops'].includes(cfg.faults.nativeFallback.expected));
    required.push('fallbackOutcome');
    if (cfg.faults.nativeFallback.expected === 'persists') required.push('fallbackLog');
  }
  for (const key of required) {
    const names = cfg.diagnostics[key];
    assert(Array.isArray(names) && names.length > 0 && names.length <= 10);
    assert(names.every((text) => typeof text === 'string' && text.length > 0 && text.length <= 180));
  }
}
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
const retainedCanaries = [primaryConfigCanary, authCanary, queryCanary];
let native;
let opening;

async function directory(path) {
  assert(path === disposable || within(disposable, path));
  await mkdir(path, { recursive: true });
  assert.equal(await realpath(path), path);
  return path;
}

async function checkedSample(label, { enforce = candidate } = {}) {
  const observed = await sample(roles, enforce, label, entries);
  await put('inventory-' + (observations.length + 1).toString().padStart(4, '0') + '.json', observed);
  observations.push(observed);
  if (!observed.unstable) assert(observed.safe, observed.violations.concat(observed.unexpected).join('; '));
  return observed;
}

function productInput(value, tokens) {
  if (typeof value === 'string') {
    const expanded = value.replace(/%([A-Z]+)%/gu, (_, key) => {
      assert(Object.hasOwn(tokens, key), 'Unknown fixture token: ' + key);
      return tokens[key];
    });
    assert(!/[\0\r\n"]/u.test(expanded) && expanded.length <= 1000);
    return expanded;
  }
  assert(typeof value === 'boolean' || Number.isSafeInteger(value));
  return value;
}

function extras(input, tokens, reserved = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input));
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    assert(/^[A-Za-z][A-Za-z0-9_]*$/u.test(key) &&
      !/key|secret|token|credential|password|provider|codex|claude|ollama|proxy|defaults|db_url/iu.test(key));
    assert(!Object.keys(reserved).some((name) => name.toLowerCase() === key.toLowerCase()), key);
    return [key, productInput(value, tokens)];
  }));
}

function configFor(data, port, shell = false) {
  const tokens = { INSTALL: install, TEMP: temp, DATA: data, DISPOSABLE: disposable };
  const safeConfig = {
    Repo: binding.checkout, Node: node, DataDir: data, Port: port,
    LauncherAppUserModelId: 'GraphGoblin.QA438.Isolated', StartupTimeoutSeconds: 25, WindowTimeoutSeconds: 2,
  };
  const environment = { GG_LOG_LEVEL: 'info', GG_REQUIRE_API_KEY: 'false',
    GG_OLLAMA_ENABLED: 'false', GG_SWAGGER_UI: 'false' };
  const added = extras(shell ? {} : cfg.gatewayEnvironment, tokens, {
    ...environment, GG_HOST: true, GG_PORT: true, GG_DATA_DIR: true, GG_WEB_DIST: true, GG_GOBLIN_DIST: true,
  });
  assert(Object.entries(added).every(([key, value]) => key.startsWith('GG_') && typeof value === 'string'));
  return {
    ...safeConfig, ...extras(shell ? {} : cfg.launcherConfig, tokens, { ...safeConfig, Environment: true }),
    Environment: { ...environment, ...added },
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

async function writeConfig(label, config) {
  const path = under(install, label + '.' + primaryConfigCanary + '.json');
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
    stderrBytes: observed.stderrBytes });
  assert.equal(observed.exit.code, expected, observed.stderr);
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
  assert.equal(await realpath(argv[1]), join(binding.checkout, current.direct ? 'apps/api/dist/main.js' : cfg.gatewayEntry));
  const tokens = { INSTALL: install, TEMP: temp, DATA: config.DataDir, DISPOSABLE: disposable };
  assert.deepEqual(argv.slice(2), current.direct ? [] : cfg.gatewayArguments.map((argument) =>
    productInput(argument, tokens)));
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
  const response = await request(port, '/system/shutdown');
  assert.equal(response.status, 200);
  const { controlToken } = await response.json();
  assert(typeof controlToken === 'string' && controlToken.length > 0);
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
  const config = configFor(stores[3], port, true);
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
  const readiness = await tail(gatewayActive);
  assert(readiness.includes('GraphGoblin API listening'), 'No startup record reached the real file');
  await writeFile(join(evidence, 'initial-gateway.tail'), readiness, { flag: 'wx' });
  await traffic(current.config.Port, current.proof.health, 1, 1, 0);
  const firstAccess = await tail(gatewayActive);
  assert(pinoRecords(firstAccess).some((value) => value.msg === 'request completed'));
  await writeFile(join(evidence, 'first-access.tail'), firstAccess, { flag: 'wx' });
  if (candidate) await verifySanitized(firstAccess, current.config.DataDir);
  await authorizationControl(current);
  const held = await startWork({ port: current.config.Port, directory: workdir, node,
    definitionFormat: cfg.definitionFormat, observe }, (state) => { current.work = state; });
  held.scriptIdentity = await native.cim(held.scriptPid);
  assert.equal(held.scriptIdentity.parentPid, current.proof.health.pid);
  assert.equal(await realpath(held.scriptIdentity.executable), node);
  await put('work-held.json', held);
  let rotations = 0;
  let previous = first;
  let sent = 0;
  const deadline = performance.now() + limits.milliseconds;
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
    if (oldCurrent.id && newCurrent.id && history.id &&
      (oldCurrent.id !== newCurrent.id || oldCurrent.bytes > newCurrent.bytes)) rotations++;
    previous = sample;
    if (candidate ? rotations >= 3 : sample.gateway > 2 * gatewayCap) break;
  }
  const pressure = { sent, rotations, last: previous, baselineWouldFailCandidateBytes: previous.violations.length > 0 };
  await put('pressure-summary.json', pressure);
  if (candidate) assert(rotations >= 3, 'Workload did not observe three rotations');
  else assert(previous.gateway > 2 * gatewayCap && pressure.baselineWouldFailCandidateBytes,
    'Insufficient old-writer pressure or ineffective negative oracle');
  assert.equal((await workState(current.config.Port, held)).status, 'running');
  assert.deepEqual(await native.cim(held.scriptPid), held.scriptIdentity);
  assert.deepEqual(await gatewayProof(current), current.proof);
  const latest = await tail(gatewayActive);
  await writeFile(join(evidence, 'latest-gateway.tail'), latest, { flag: 'wx' });
  assert(pinoRecords(latest).some((value) => value.msg === 'request completed'), 'Recent request record missing');
  if (candidate) await verifySanitized(latest, current.config.DataDir);
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
    interpretation: 'A negative header match is limited to captured bytes. The inspected baseline Fastify request serializer omits Authorization.',
  };
  await put('invalid-authorization-observation.json', observed);
  assert.deepEqual(before, current.proof.health);
  assert.equal(denied.status, 401);
  assert.match(denied.contentType ?? '', /^application\/problem\+json\b/u);
  assert.equal(JSON.parse(denied.body).code, 'UNAUTHORIZED');
  assert.deepEqual(after, current.proof.health);
  if (candidate) await verifySanitized(bytes, current.config.DataDir);
}

async function verifySanitized(bytes, store) {
  for (const text of [...retainedCanaries, store, store.replaceAll('\\', '\\\\')]) {
    assert(!bytes.includes(text), 'Canary escaped to a recorded diagnostic destination');
  }
}

function requireText(output, expected, label) {
  assert(expected.every((part) => output.includes(part)), 'Missing bound diagnostic for ' + label);
}

async function nativeControls(current, file) {
  const warm = await launch('warm', file, 0);
  assert.notEqual(warm.pid, current.proof.health.pid);
  assert.deepEqual(await gatewayProof(current), current.proof);
  const wrong = await writeConfig('wrong-store', configFor(stores[1], current.config.Port));
  const refused = await launch('wrong-store', wrong, 1);
  assert.deepEqual(await gatewayProof(current), current.proof);
  assert.deepEqual(await readdir(stores[1]), []);
  const diagnostic = await tail(launcherActive, 256 * 1024);
  assert(diagnostic.length > 0, 'No launcher-owned diagnostic for actual refusal');
  await writeFile(join(evidence, 'launcher-diagnostic.tail'), diagnostic, { flag: 'wx' });
  if (candidate) {
    requireText(refused.stderr, cfg.diagnostics.wrongStore, 'wrong store');
    await verifySanitized(Buffer.concat([diagnostic, Buffer.from(refused.stderr)]), current.config.DataDir);
  }
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
    if (candidate) {
      requireText(response.stderr, cfg.diagnostics.occupiedPort, 'occupied port');
      await verifySanitized(Buffer.from(response.stderr), stores[2]);
    }
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
  if (candidate && cfg.faults.sharedDestination) {
    const otherPort = await choosePort();
    const other = await writeConfig('shared-root', configFor(stores[1], otherPort));
    const contention = await launch('shared-root', other, 1);
    requireText(contention.stderr, cfg.diagnostics.sharedDestination, 'shared gateway log destination');
    await verifySanitized(Buffer.from(contention.stderr), stores[1]);
    assert(await nativeLib.refused(otherPort));
    assert.deepEqual(await gatewayProof(current), current.proof);
    assert.deepEqual(await readdir(stores[1]), []);
    await checkedSample('shared-destination-refused');
  }
}

async function nativeFallback(port) {
  const fault = cfg.faults.nativeFallback;
  if (fault === null) return;
  assert.equal(fault.kind, 'read-share-denies-write-delete');
  assert(['persists', 'drops'].includes(fault.expected));
  const fallback = roles.find((slot) => slot.key === 'fallback' && slot.role === 'active');
  const marker = under(workdir, 'primary-denial-ready');
  const release = under(workdir, 'primary-denial-release');
  const malformed = await writeConfig('fallback-invalid-config', []);
  const before = await checkedSample('before-primary-denial');
  const oldPrimary = await tail(launcherActive);
  const oldFallback = await tail(fallback.file);
  assert(oldPrimary.length > 0 && !before.unstable);
  const outcome = await withReadSharingDenial(native, evidence, launcherActive, marker, release, observe,
    async () => {
      const refusal = await launch('primary-diagnostic-unwritable', malformed, 1);
      const onFault = await checkedSample('primary-denied');
      assert(!onFault.unstable);
      assert.deepEqual(await tail(launcherActive), oldPrimary);
      assert(await refused(port), 'Invalid configuration unexpectedly started a gateway');
      requireText(refusal.stderr, cfg.diagnostics.fallbackOutcome, 'launcher fallback');
      const replacement = await tail(fallback.file);
      if (fault.expected === 'persists') {
        assert.notDeepEqual(replacement, oldFallback);
        requireText(replacement.toString('utf8'), cfg.diagnostics.fallbackLog, 'managed TEMP diagnostic');
      } else assert.deepEqual(replacement, oldFallback);
      await verifySanitized(Buffer.concat([replacement, Buffer.from(refusal.stderr)]), stores[0]);
      return { expected: fault.expected, before, onFault };
    });
  const restored = await launch('primary-diagnostic-restored', malformed, 1);
  requireText(restored.stderr, cfg.diagnostics.fallbackOutcome, 'restored launcher diagnostic');
  assert.notDeepEqual(await tail(launcherActive), oldPrimary);
  await put('native-fallback.json', { ...outcome, after: await checkedSample('primary-restored') });
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
  const during = await checkedSample('legacy-after-readiness');
  assert(!during.unstable);
  const logs = Buffer.concat(await Promise.all(roles.filter((slot) => slot.key === 'gateway')
    .map((slot) => tail(slot.file))));
  assert(logs.includes('GraphGoblin API listening'));
  assert.equal(logs.includes(marker), cfg.legacyPolicy === 'tail');
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
  const port = await choosePort();
  const config = configFor(stores[0], port);
  const file = await writeConfig('primary', config);
  const primary = await boot(config, file, 'cold');
  await sustained(primary);
  await nativeControls(primary, file);
  await stop(primary);
  if (candidate) {
    await nativeFallback(port);
    await legacy(config, file);
  }
  const restarted = await boot(config, file, 'clean-restart');
  await checkedSample('clean-restart');
  await stop(restarted);
  await shellControl();
  const final = await checkedSample('final-managed-files');
  assert(!final.unstable);
  if (candidate) {
    for (const [index, slot] of final.rows.entries()) {
      if (!slot.id) continue;
      const bytes = await readFile(slot.file);
      assert.equal(bytes.length, slot.bytes);
      await writeFile(join(evidence, 'managed-' + index + '.raw'), bytes, { flag: 'wx' });
      for (const store of stores) await verifySanitized(bytes, store);
    }
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
      await rm(disposable, { recursive: true });
      await assert.rejects(lstat(disposable), { code: 'ENOENT' });
      cleanup.disposableRemoved = true;
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
