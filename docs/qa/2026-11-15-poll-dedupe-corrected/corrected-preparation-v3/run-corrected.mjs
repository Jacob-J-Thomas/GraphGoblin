import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCandidateBinding, sha } from './binding.mjs';
import { checkDiagnostics } from './diagnostics.mjs';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const [admissionPath, attempt] = process.argv.slice(2);
assert.match(attempt ?? '', /^corrected-attempt-[1-9][0-9]*$/, 'Use a new numbered external attempt.');
const spec = JSON.parse(await readFile(admissionPath,'utf8'));
assert.equal(spec.status,'CORRECTED_NATIVE_ADMITTED');
assert.equal(spec.attempt,attempt);
const fixtureBytes = await readFile(join(root, '..', 'wire-fixtures.json'));
const wire = JSON.parse(fixtureBytes);
const targets = wire.targetOrder;
const cases = wire.phases.corrected;
const units = (value) => value.split('').map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join(' ');
const identities = new Map(Object.entries(wire.sources).map(([tag, source]) => [source.value, tag]));
identities.set(wire.derivedSplit.value, 'SPLIT512');

function preflightWires() {
  assert.equal(wire.schema, 'graphgoblin-361-wire-fixtures/v1');
  for (const source of Object.values(wire.sources)) {
    assert.equal(units(source.value), source.units);
    assert.equal(source.value.isWellFormed(), source.wellFormed);
  }
  const split = wire.sources.SPLIT.value;
  assert.equal(split.length, 513);
  assert.equal(split.slice(0, 511), wire.sources.PREFIX.value);
  assert.equal(split.slice(0, 512), wire.derivedSplit.value);
  assert.equal(units(wire.derivedSplit.value), wire.derivedSplit.units);
  assert.equal(wire.derivedSplit.value.isWellFormed(), false);
  assert.equal(wire.sources.SP.value.length, 512);
  assert.equal(wire.sources.H.value.toWellFormed(), wire.sources.RH.value);
  for (const target of targets) {
    assert.equal(cases[target].length, target === 'split' ? 5 : 4);
    for (const input of cases[target]) {
      const utf8 = Buffer.from(input.body, 'utf8');
      assert.equal(utf8.toString('utf8'), input.body);
      const parsed = JSON.parse(utf8);
      assert.equal(parsed.fire, true);
      assert.equal(parsed.qaCase, input.label);
      const keys = target === 'items' ? parsed.items.map((item) => item.key) :
        Object.hasOwn(parsed, 'key') ? [parsed.key] : [];
      assert.deepEqual(keys, input.ids.map((tag) => wire.sources[tag].value));
      for (const key of keys) {
        if (key.isWellFormed()) assert(utf8.includes(Buffer.from(key, 'utf8')));
        else assert(input.body.includes(JSON.stringify(key)));
      }
    }
  }
}

preflightWires();
const binding = await readCandidateBinding(spec);
const out = join(root, attempt);
await mkdir(out);
assert.equal(await realpath(out), out);
const data = join(out, 'disposable-store');
await mkdir(data);
assert.equal(await realpath(data), data);
const db = join(data, 'poll.sqlite');
const evidence = async (name, record) =>
  writeFile(join(out, name), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
const startup = ['binding.mjs', 'gateway.mjs', 'run-corrected.mjs', 'diagnostics.mjs', '../wire-fixtures.json'];
const inputSha256 = Object.fromEntries(await Promise.all(startup.map(async (file) =>
  [file, sha(await readFile(join(root, file)))])));
await evidence('source-and-build.json', binding);
await evidence('admission.json', {attempt, currentMain: spec.main, candidate: spec.head,
  fixtureSha256: sha(fixtureBytes), inputSha256,
  node: process.version, cwd: data, sqlitePath: db, expectedDataBearingResponses: 21});
const { openReadOnlyDatabaseClient } = await import(pathToFileURL(
  join(binding.checkout, 'packages/infrastructure/dist/sqlite/index.js')).href);
const stamp = () => ({ wall: new Date().toISOString(), monoMs: performance.now() });
const isFixturePort = (port) => Number.isInteger(port) && port > 0 && ![4747, 4748].includes(port);
const assertUnder = (base, path) => {
  const names = relative(base, path).split(/[\\/]/u);
  assert(names[0] && names[0] !== '..' && !names[0].includes(':'), 'Unexpected external fixture path.');
};

async function sqliteIdentity() {
  const path = await realpath(db);
  assertUnder(await realpath(data), path);
  assert.equal(path, db);
  const { dev, ino, birthtimeMs } = await stat(path, {bigint:true});
  return {path, dev: String(dev), ino: String(ino), birthtimeMs: String(birthtimeMs)};
}

const records = { launched: [], observations: [], readbacks: [], errors: [] };
const loops = {};
const gatewayProcesses = [];
const probeRecords = [];
const routeState = new Map(targets.map((name) => ['/qa361/' + name,
  {name, armed:undefined, inFlight:0, maxInFlight:0}]));
const heldEvidence = [];
const source = createServer((request, response) => {
  const route = routeState.get(request.url);
  if (request.method !== 'GET' || !route) {
    probeRecords.push({ unexpected: true, method: request.method, route: request.url, received: stamp() });
    response.writeHead(404).end();
    return;
  }
  const input = route.armed;
  if (input) route.armed = undefined;
  const bytes = Buffer.from(input?.body ?? wire.inertBody, 'utf8');
  route.inFlight += 1;
  route.maxInFlight = Math.max(route.maxInFlight, route.inFlight);
  const record = { target: route.name, label: input?.label ?? null, received: stamp(),
    inFlightAtReceive:route.inFlight, wireBase64: bytes.toString('base64'), wireSha256: sha(bytes) };
  probeRecords.push(record);
  let timer;
  response.once('finish', () => { record.finished = stamp(); });
  response.once('close', () => {
    record.closed = stamp();
    route.inFlight -= 1;
    if (timer) clearTimeout(timer);
  });
  const respond = () => {
    record.released = stamp();
    response.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length});
    response.end(bytes);
  };
  if (input?.holdMs) timer = setTimeout(respond,input.holdMs);
  else respond();
});

async function until(predicate, deadline, description) {
  do {
    const result = predicate();
    if (result) return result;
    await sleep(50);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + description);
}

function childEnvironment() {
  const systemRoot = process.env.SystemRoot;
  assert(systemRoot, 'Windows system root is required.');
  return {
    SystemRoot: systemRoot,
    PATH: [dirname(process.execPath), join(systemRoot, 'System32'), systemRoot].join(';'),
    TEMP: data, TMP: data, HOME: data, USERPROFILE: data, APPDATA: data, LOCALAPPDATA: data,
    CODEX_HOME: join(data, 'empty-codex-home'),
    CLAUDE_CONFIG_DIR: join(data, 'empty-claude-home'),
    GG_DATA_DIR: data, GG_DB_URL: 'file:' + db.replaceAll('\\', '/'),
    GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false', GG_SWAGGER_UI: 'false',
    GG_OLLAMA_ENABLED: 'false', GG_WEB_DIST: '', GG_GOBLIN_DIST: '',
    GG_LOG_LEVEL: 'info', GG_TIMER_POLL_MS: '1000', GG_SHUTDOWN_GRACE_MS: '10000',
    GG_CODEX_BINARY: join(data, 'no-codex.exe'), GG_CLAUDE_BINARY: join(data, 'no-claude.exe'),
  };
}

async function launch(label) {
  const output = await open(join(out, label + '-gateway.log'), 'wx');
  let child;
  try {
    child = fork(join(root, 'gateway.mjs'), [binding.checkout], {
      cwd: data, env: childEnvironment(), execArgv: [], windowsHide: true,
      stdio: ['ignore', output.fd, output.fd, 'ipc'],
    });
  } finally {
    await output.close();
  }
  const processRecord = {label, pid:child.pid, launchedAt: stamp()};
  records.launched.push(processRecord);
  const gateway = {child, processRecord};
  gatewayProcesses.push(gateway);
  child.once('exit', (code, signal) => { processRecord.exit = {code, signal, at:stamp()}; });
  child.on('error', (error) => { processRecord.childError = {name:error.name, code:error.code, message:error.message}; });
  child.once('message', (message) => { gateway.started = message; });
  await until(() => gateway.started || processRecord.exit || processRecord.childError,
    Date.now() + 25000, label + ' built gateway startup');
  assert(gateway.started, label + ' stopped before readiness.');
  const {host, port, pid} = gateway.started;
  assert.equal(host, '127.0.0.1');
  assert.equal(pid, child.pid);
  assert(isFixturePort(port));
  gateway.origin = 'http://127.0.0.1:' + port;
  Object.assign(processRecord, gateway.started, {origin:gateway.origin, sqlite:await sqliteIdentity()});
  const healthy = await api(gateway, 'GET', '/healthz');
  assert.deepEqual(healthy.json, {status:'ok'});
  processRecord.instance = healthy.instance;
  const setup = await api(gateway, 'GET', '/loops');
  await evidence(label + '-initial-loop-list.json', setup);
  return gateway;
}

async function api(gateway, method, path, body, extraHeaders) {
  assert(gateway.origin && path.startsWith('/') && !path.startsWith('//'));
  const headers = {...(body !== undefined ? {'content-type':'application/json'} : {}), ...extraHeaders};
  const response = await fetch(gateway.origin + path, {
    method, headers, ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const pid = response.headers.get('x-graphgoblin-pid');
  const instance = response.headers.get('x-graphgoblin-instance');
  if (path === '/healthz') {
    assert.equal(pid, String(gateway.child.pid));
    assert(response.headers.get('x-graphgoblin-phase') === 'running' && instance);
  }
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return {method, path, status:response.status, instance, text, json, readAt:stamp()};
}

async function expectApi(gateway, method, path, status, body) {
  const response = await api(gateway, method, path, body);
  if (response.status !== status || response.json === undefined) {
    records.errors.push({where:'required API', response});
    throw new Error('Unexpected API response status for ' + method + ' ' + path);
  }
  return response.json;
}

async function drain(gateway) {
  const {child, processRecord} = gateway;
  if (processRecord.exit) {
    assert.equal(processRecord.exit.code, 0);
    return;
  }
  assert(gateway.origin, 'Startup did not provide a verified gateway origin.');
  const {json: state, status} = await api(gateway, 'GET', '/system/shutdown');
  assert.equal(status, 200);
  assert.equal(typeof state.controlToken, 'string');
  assert.equal(state.phase, 'running');
  assert.deepEqual(state.activeRunIds, []);
  const result = await api(gateway, 'POST', '/system/shutdown', {action:'drain'},
    {'x-graphgoblin-shutdown-token':state.controlToken});
  processRecord.drain = { requestedAt: stamp(), status:result.status, phase:result.json?.phase,
    activeRunIds:result.json?.activeRunIds };
  assert.equal(result.status, 202);
  await until(() => processRecord.exit, Date.now() + 15000, 'ordinary drain of PID ' + child.pid);
  assert.equal(processRecord.exit.code, 0);
  assert.equal(processRecord.exit.signal, null);
}

function definition(target, sourceOrigin) {
  const config = {
    type:'poll', enabled:true, intervalSeconds:5,
    probe:{kind:'http', url:sourceOrigin + '/qa361/' + target, timeoutSeconds:20},
    fireWhen:'probe.json.fire = true',
    ...(target === 'items' ? {items:{select:'probe.json.items', dedupeKey:'item.key', maxRunsPerPoll:10}} :
      target === 'unkeyed' ? {} : {dedupeKey:'probe.json.key'}),
  };
  return {
    schemaVersion:4, name:'QA 361 ' + target,
    nodes:[{id:'poll', kind:'trigger', label:'Poll', config}, {id:'done', kind:'exit', label:'Done', config:{}}],
    edges:[{id:'go', from:{node:'poll', port:'out'}, to:{node:'done'}}],
  };
}

async function pollTarget(gateway, loop) {
  const result = await expectApi(gateway, 'GET', '/loops/' + loop.loopId + '/triggers', 200);
  assert.equal(result.polls.length, 1);
  const [armed] = result.polls;
  for (const key of ['ownerId', 'loopId', 'versionId', 'triggerNodeId']) assert.equal(armed[key], loop[key]);
  assert.equal(armed.intervalSeconds, 5);
  assert(Number.isFinite(Date.parse(armed.nextPollAt)));
  return armed;
}

async function publish(gateway, sourceOrigin) {
  for (const target of targets) {
    const authored = definition(target, sourceOrigin);
    const created = await expectApi(gateway, 'POST', '/loops', 201, {definition:authored});
    const published = await expectApi(gateway, 'POST', '/loops/' + created.loop.id + '/publish', 200);
    const loop = {ownerId:created.loop.ownerId, loopId:created.loop.id, versionId:published.version.id, triggerNodeId:'poll'};
    assert(loop.ownerId && loop.loopId && loop.versionId);
    loops[target] = loop;
    const armed = await pollTarget(gateway, loop);
    await evidence('published-' + target + '.json', {authored, created, published, armed});
  }
}

async function readRows(target) {
  await sqliteIdentity();
  const loop = loops[target];
  const reader = openReadOnlyDatabaseClient(db);
  try {
    const found = await reader.execute({
      sql: "SELECT id, owner_id, loop_id, version_id, status, created_at, initial_thread, hex(CAST(initial_thread AS BLOB)) AS thread_hex, hex(CAST(json_extract(initial_thread, '$.invocation.trigger.dedupeKey') AS BLOB)) AS sqlite_key_hex FROM runs WHERE loop_id = ? ORDER BY created_at, id",
      args: [loop.loopId],
    });
    const events = await reader.execute({
      sql: "SELECT event.run_id, event.seq, event.ts, event.type, event.payload, hex(CAST(event.payload AS BLOB)) AS payload_hex FROM run_events AS event JOIN runs ON runs.id = event.run_id WHERE runs.loop_id = ? AND event.type = 'run.queued' ORDER BY event.run_id, event.seq",
      args: [loop.loopId],
    });
    const rows = found.rows.map((row) => {
      assert.equal(row.owner_id, loop.ownerId);
      assert.equal(row.loop_id, loop.loopId);
      assert.equal(row.version_id, loop.versionId);
      const queued = events.rows.filter((event) => event.run_id === row.id);
      assert.equal(queued.length, 1, 'Expected one queued event for ' + row.id);
      assert.equal(Number(queued[0].seq), 1);
      assert.equal(Buffer.from(row.thread_hex, 'hex').toString('utf8'), row.initial_thread);
      assert.equal(Buffer.from(queued[0].payload_hex, 'hex').toString('utf8'), queued[0].payload);
      const initial = JSON.parse(row.initial_thread);
      const queuedPayload = JSON.parse(queued[0].payload);
      assert.equal(queuedPayload.versionId, loop.versionId);
      assert.deepEqual(queuedPayload.initialThread, initial);
      const trigger = initial.invocation.trigger;
      assert.equal(trigger.kind, 'poll');
      assert.equal(trigger.nodeId, loop.triggerNodeId);
      const hasKey = Object.hasOwn(trigger, 'dedupeKey');
      if (hasKey) assert.equal(typeof trigger.dedupeKey, 'string');
      const keyTag = hasKey ? (identities.get(trigger.dedupeKey) ?? 'unexpected') : 'omitted';
      const caseLabel = target === 'items' ? trigger.payload.label : trigger.payload.json.qaCase;
      return {id:row.id, status:row.status, createdAt:row.created_at, ownerId:row.owner_id,
        loopId:row.loop_id, versionId:row.version_id, caseLabel, keyTag, hasKey,
        key:trigger.dedupeKey, keyUnits:hasKey ? units(trigger.dedupeKey) : null,
        keyWellFormed:hasKey ? trigger.dedupeKey.isWellFormed() : null,
        sqliteExtractedKeyHex:row.sqlite_key_hex, initialThreadText:row.initial_thread,
        initialThreadHex:row.thread_hex, queued:{seq:Number(queued[0].seq),
          ts:queued[0].ts, payloadText:queued[0].payload, payloadHex:queued[0].payload_hex}};
    });
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.equal(events.rows.length, rows.length);
    return rows;
  } finally {
    reader.close();
  }
}

function persisted(rows) {
  return rows.map(({status:_status, ...row}) => row);
}

async function listAndSample(gateway, target, after, newRows) {
  const list = [];
  const ids = [];
  const loop = loops[target];
  let cursor = null;
  for (let page = 0; page < 8; page += 1) {
    const params = new URLSearchParams({loopId:loop.loopId, limit:'5'});
    if (cursor) params.set('cursor', cursor);
    const response = await api(gateway, 'GET', '/runs?' + params);
    list.push(response);
    if (response.status !== 200 || !response.json) break;
    ids.push(...response.json.items.map((item) => item.id));
    cursor = response.json.nextCursor;
    if (cursor === null) break;
  }
  const samples = {};
  for (const row of newRows.length > 0 ? newRows : after.slice(-1)) {
    samples[row.id] = await Promise.all(['', '/thread', '/events?after=0&limit=20'].map((suffix) =>
      api(gateway, 'GET', '/runs/' + row.id + suffix)));
  }
  const listMatchesDurable = cursor === null && list.every(({status}) => status === 200) &&
    JSON.stringify(ids.sort()) === JSON.stringify(after.map((row) => row.id).sort());
  return {listMatchesDurable, list, samples};
}

function count(rows) {
  const counts = {};
  for (const row of rows) counts[row.keyTag] = (counts[row.keyTag] ?? 0) + 1;
  return counts;
}

async function observeOpenHold(gateway, target, input, before, armed) {
  const deadline = Date.parse(armed.nextPollAt) + 25000;
  const held = await until(() => probeRecords.find((row) => row.label === input.label),
    deadline,input.label + ' held request');
  const route = routeState.get('/qa361/' + target);
  assert.equal(route.inFlight,1);
  assert(!held.released);
  const advanced = await pollTarget(gateway,loops[target]);
  assert(Date.parse(advanced.nextPollAt) > Date.parse(armed.nextPollAt));
  await until(() => Date.now() >= Date.parse(advanced.nextPollAt) + 100, deadline,
    input.label + ' next due boundary while held');
  assert.equal(route.inFlight,1);
  assert(!held.released);
  const during = await readRows(target);
  const duringAt = stamp();
  assert(!held.released,'The item response released before the no-early-row readback.');
  assert.deepEqual(persisted(during),persisted(before),'A queued row appeared before release.');
  const duringReceipt = {label:input.label, armed, advanced, duringAt, heldRequestAt:held.received,
    inFlightWhilePastDue:route.inFlight, unaffectedIds:during.map(({id}) => id)};
  await evidence(input.label + '-during-hold.json',duringReceipt);
  return duringReceipt;
}

async function runWave(gateway, n, waveTargets) {
  const inputs = new Map();
  for (const target of waveTargets) {
    const input = cases[target][n - 1];
    const route = routeState.get('/qa361/' + target);
    const before = await readRows(target);
    const armed = await pollTarget(gateway, loops[target]);
    assert.equal(route.armed, undefined);
    inputs.set(target, {input, before, armed});
    route.armed = input;
  }
  const observations = [];
  const holds = new Map();
  for (const [target, {input, before, armed}] of inputs) {
    if (input.holdMs) {
      const receipt = await observeOpenHold(gateway,target,input,before,armed);
      holds.set(target,receipt);
    }
  }
  for (const [target, {input, before, armed}] of inputs) {
    const deadline = Date.parse(armed.nextPollAt) + 25000;
    const delivered = await until(() => probeRecords.find((row) => row.label === input.label && row.finished),
      deadline, input.label + ' response');
    assert(Date.parse(delivered.received.wall) <= deadline);
    assert(Date.parse(delivered.finished.wall) <= deadline);
    const barrier = await until(() => probeRecords.find((row) => row.target === target &&
      row.label === null && row.finished && row.received.monoMs >= delivered.finished.monoMs),
      deadline, input.label + ' next scheduled inert response');
    assert(Date.parse(barrier.finished.wall) <= deadline);
    const after = await readRows(target);
    const hold = holds.get(target);
    if (hold) {
      const route = routeState.get('/qa361/' + target);
      const requestsDuring = probeRecords.filter((row) => row.target === target &&
        row.received.monoMs > delivered.received.monoMs && row.received.monoMs < delivered.released.monoMs);
      assert.equal(requestsDuring.length,0,'A second item probe began before release.');
      assert.equal(route.maxInFlight,1,'Multiple item HTTP responses were in flight.');
      const heldMs = delivered.released.monoMs - delivered.received.monoMs;
      const releaseAfterDueMs = Date.parse(delivered.released.wall) - Date.parse(hold.advanced.nextPollAt);
      assert(heldMs >= input.holdMs - 10 && heldMs < 19500);
      assert(releaseAfterDueMs >= 1000,'Released before the next due time plus one normal tick.');
      const complete = {...hold, heldMs, releaseAfterDueMs, maxInFlight:route.maxInFlight,
        laterScheduledPoll:barrier, release:delivered.released, requestsDuring};
      heldEvidence.push(complete);
      await evidence(input.label + '-hold.json',complete);
    }
    const beforeIds = new Set(before.map((row) => row.id));
    const newRows = after.filter((row) => !beforeIds.has(row.id));
    assert.deepEqual(persisted(after.filter((row) => beforeIds.has(row.id))), persisted(before));
    const observedKeys = newRows.map((row) => row.keyTag).sort();
    const expectedKeys = [...input.expectedNew].sort();
    const matchesCorrectedObservation = observedKeys.length === expectedKeys.length &&
      observedKeys.every((tag, i) => tag === expectedKeys[i]) &&
      newRows.every((row) => row.caseLabel === input.label);
    const observation = {target, label:input.label, armed, delivered, barrier, expectedKeys, observedKeys,
      matchesCorrectedObservation, beforeCounts:count(before), afterCounts:count(after), before, after};
    records.observations.push(observation);
    observations.push({observation, newRows});
    await evidence(input.label + '-durable.json', observation);
  }
  // Keep the first runtime evidence even if the public projection itself has a failure.
  for (const {observation, newRows} of observations) {
    const apiViews = await listAndSample(gateway, observation.target, observation.after, newRows);
    records.readbacks.push({label:observation.label, listMatchesDurable:apiViews.listMatchesDurable,
      sampleStatuses:Object.values(apiViews.samples).map((sample) => sample.map(({status}) => status))});
    await evidence(observation.label + '-rest.json', apiViews);
  }
  process.stdout.write(JSON.stringify({wave:n, cases:observations.map(({observation}) => ({
    target:observation.target, counts:observation.afterCounts, expected:observation.matchesCorrectedObservation,
  }))}) + '\n');
}

const late = {};
async function checkRestart(gateway, last, identity) {
  assert.deepEqual(await sqliteIdentity(), identity);
  for (const target of targets) {
    const armed = await pollTarget(gateway, loops[target]);
    const rows = await readRows(target);
    assert.deepEqual(persisted(rows), persisted(last[target]));
    const dueSinceLaunchMs = Date.parse(armed.nextPollAt) -
      Date.parse(gateway.processRecord.createdAt);
    assert(dueSinceLaunchMs >= 4900 && dueSinceLaunchMs <= 30000);
    late[target] = {armed, dueSinceLaunchMs, retainedIds:rows.map((row) => row.id)};
  }
  await evidence('restart-rearm.json', late);
}

async function finalReadback() {
  const lateRows = {};
  for (const target of targets) {
    const recent = records.observations.findLast((row) => row.target === target);
    lateRows[target] = await readRows(target);
    assert.deepEqual(persisted(lateRows[target]), persisted(recent.after));
  }
  const client = openReadOnlyDatabaseClient(db);
  let counts;
  try {
    const result = await client.execute('SELECT loop_id, COUNT(*) AS total FROM runs GROUP BY loop_id ORDER BY loop_id');
    counts = result.rows.map((row) => ({loopId:row.loop_id, count:Number(row.total),
      fixture:targets.some((target) => loops[target].loopId === row.loop_id)}));
  } finally {
    client.close();
  }
  await evidence('post-drain-readback.json', {counts, rows:lateRows});
}

let sourcePort;
let firstGateway;
let restarted;
let failure;
let diagnosticSummary;
let cleanupFailed = false;
try {
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  const address = source.address();
  assert.equal(address.address, '127.0.0.1');
  assert(isFixturePort(address.port));
  sourcePort = address.port;
  const sourceOrigin = 'http://127.0.0.1:' + sourcePort;
  firstGateway = await launch('initial');
  await publish(firstGateway, sourceOrigin);
  for (const n of [1,2,3]) await runWave(firstGateway, n, targets);
  const last = Object.fromEntries(targets.map((target) =>
    [target, records.observations.findLast((row) => row.target === target).after]));
  await drain(firstGateway);
  const file = await sqliteIdentity();
  assert.deepEqual(file, firstGateway.processRecord.sqlite);
  restarted = await launch('restart');
  assert.notEqual(restarted.processRecord.createdAt, firstGateway.processRecord.createdAt);
  assert.equal(restarted.processRecord.instance, firstGateway.processRecord.instance);
  await checkRestart(restarted, last, file);
  await runWave(restarted, 4, targets);
  for (const target of targets) {
    const first = probeRecords.find((row) => row.target === target &&
      row.received.monoMs >= restarted.processRecord.launchedAt.monoMs);
    assert(first, 'Missing first post-restart request for ' + target);
    late[target].firstRequest = first;
    late[target].observedMsFromReady = Date.parse(first.received.wall) - Date.parse(restarted.processRecord.readyAt);
    late[target].observedMsFromDue = Date.parse(first.received.wall) - Date.parse(late[target].armed.nextPollAt);
    assert(late[target].observedMsFromDue >= -50 && late[target].observedMsFromDue <= 25000,
      'Unwitnessed first due request for ' + target);
  }
  await evidence('restart-first-due.json', late);
  await runWave(restarted, 5, ['split']);
  await drain(restarted);
  await finalReadback();
  assert.equal(records.observations.length, 21);
  assert.equal(probeRecords.filter((row) => row.label).length, 21);
  assert.equal(probeRecords.filter((row) => row.unexpected).length, 0);
  assert(records.observations.every((row) => row.matchesCorrectedObservation),
    'One or more predeclared corrected observations differed; qualify by path.');
  assert(records.readbacks.every((row) => row.listMatchesDurable &&
    row.sampleStatuses.every((statuses) => statuses.every((status) => status === 200))),
    'One or more REST readbacks differed from durable state.');
  assert.equal(heldEvidence.length,1);
  diagnosticSummary = await checkDiagnostics(out,loops,cases,records.observations,binding.diagnostics);
  await evidence('diagnostics.json',diagnosticSummary);
} catch (error) {
  failure = {name:error.name, message:error.message, stack:error.stack, at:stamp()};
} finally {
  for (const gateway of gatewayProcesses.filter((owned) => !owned.processRecord.exit)) {
    try { await drain(gateway); } catch (error) {
      cleanupFailed = true;
      records.errors.push({where:'owned gateway cleanup', pid:gateway.child.pid,
        error:{name:error.name, message:error.message}});
      if (gateway.child.exitCode === null && gateway.child.signalCode === null) {
        gateway.processRecord.fallbackOwnedChildStop = gateway.child.kill();
        try {
          await until(() => gateway.processRecord.exit, Date.now() + 5000, 'termination of owned child');
        } catch (terminationError) {
          records.errors.push({where:'owned gateway termination', error:terminationError.message});
          gateway.child.unref();
        }
      }
    }
  }
  if (source.listening) {
    await new Promise((done) => {
      source.close(done);
      source.closeAllConnections();
    });
  }
  try {
    const after = await readCandidateBinding(spec);
    assert.deepEqual(after, binding);
    await evidence('source-and-build-after.json', after);
  } catch (error) {
    cleanupFailed = true;
    records.errors.push({where:'closing identity', error:{name:error.name, message:error.message}});
  }
  await evidence('probe-requests.json', probeRecords);
  await evidence('result.json', {
    verdict: failure || cleanupFailed ? 'unconfirmed or incomplete' : 'exact corrected behavior observed',
    failure: failure ?? null, cleanupFailed, sourcePort, sourceListening:source.listening,
    gatewayProcesses:records.launched, loops,
    observations:records.observations.map(({before:_before, after:_after, ...observation}) => observation),
    readbacks:records.readbacks, errors:records.errors, heldEvidence,
    checkedWarnings:diagnosticSummary?.total ?? null,
    dataBearingRequests:probeRecords.filter((row) => row.label).length,
    inertRequests:probeRecords.filter((row) => row.label === null).length,
    processPid:process.pid, processCreatedAt:new Date(performance.timeOrigin).toISOString(),
  });
}
if (failure || cleanupFailed) {
  process.stderr.write((failure?.message ?? 'Closing cleanup or identity failed.') + '\n');
  process.exitCode = 1;
}
