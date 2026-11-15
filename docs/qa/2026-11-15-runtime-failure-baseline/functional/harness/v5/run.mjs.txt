import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldTurn, setTimeout as delay } from 'node:timers/promises';
import { abs, batch, capture, contained, harnessFiles, hash, json, root, save } from './binding.mjs';
import { cases, definition, unexpectedRepairFault } from './fixtures.mjs';
import { boundImport, browserProcesses, checkClosedPort, confirmSqliteRelease, inspectRun, rest, stamp,
  startGateway, startMcp, stopGateway, within } from './native.mjs';

assert(process.execArgv.includes('--expose-gc') && typeof globalThis.gc === 'function',
  'Run the admitted supervisor under project Node with --expose-gc');
const [admissionFile, admissionHash] = process.argv.slice(2);
assert.match(admissionHash ?? '', /^[a-f0-9]{64}$/u, 'Expected root-verified admission SHA-256 as argument 2');
const admittedPath = await realpath(abs(admissionFile));
assert(contained(batch, admittedPath));
assert.equal(await hash(admittedPath), admissionHash);
const admission = await json(admittedPath);
assert.equal(admission.schema, 'gg381-functional-admission/v1');
assert.equal(admission.state, 'root-admitted');
assert(['baseline', 'corrected'].includes(admission.phase));
assert.match(admission.attempt, new RegExp('^' + admission.phase + '-attempt-[1-9][0-9]*$', 'u'));
assert.equal(typeof admission.baselineResume, 'boolean');
assert.equal(typeof admission.repairTargetCases, 'boolean');
const baseline = admission.phase === 'baseline';
if (!baseline) assert.equal(admission.baselineResume, false);

const inputHashes = Object.fromEntries(await Promise.all(harnessFiles.map(async (file) => [file, await hash(join(root, file))])));
assert.deepEqual(admission.harness, inputHashes, 'Review and bind the complete harness before starting it');
const boundPath = await realpath(abs(admission.binding));
assert(contained(batch, boundPath));
assert.equal(await hash(boundPath), admission.bindingSha256);
const binding = await json(boundPath);
assert.equal(binding.schema, 'gg381-build-binding/v1');
assert.equal(binding.main, admission.main);
assert.equal(binding.head, admission.head);
if (baseline) assert.equal(binding.head, binding.main, 'Baseline must bind actual main');
const bounds = admission.bounds;
for (const [key, low, high] of [
  ['request', 500, 15000], ['startup', 1000, 45000], ['cleanup', 1000, 30000], ['case', 10000, 90000],
]) assert(Number.isInteger(bounds[key]) && bounds[key] >= low && bounds[key] <= high, 'Invalid bound: ' + key);
assert(bounds.case >= bounds.request + bounds.startup);
const contract = admission.contract;
if (baseline) assert.equal(contract, null);
else {
  for (const kind of ['expression', 'patch', 'template', 'repair-template', 'repair-patch']) {
    assert.match(contract.codes[kind], /^MUTATION_[A-Z0-9_]+$/u);
  }
  const validFieldPath = (path) => Array.isArray(path) && path.length > 0 &&
    path.every((part) => /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(part) && !['constructor', 'prototype'].includes(part));
  assert(validFieldPath(contract.indexPath));
  assert([0, 1].includes(contract.indexBase));
  assert(validFieldPath(contract.typePath));
  assert(typeof contract.types?.set === 'string' && typeof contract.types?.coerce === 'string');
  assert.notEqual(contract.types.set, contract.types.coerce);
  assert(typeof contract.visibleOperation === 'string' && contract.visibleOperation.length > 2);
  new RegExp(contract.visibleOperation, 'iu');
  assert(typeof contract.unexpectedRepairMessage === 'string' && contract.unexpectedRepairMessage.trim() &&
    contract.unexpectedRepairMessage.length <= 10000 && !contract.unexpectedRepairMessage.startsWith('REVIEWED_'),
    'Bind the reviewed public message of the controlled unexpected repair failure');
}

const selected = cases.filter((test) => admission.repairTargetCases || !['a2-repaired-target', 'a2-raw-target'].includes(test.id));
const out = join(root, admission.attempt);
await mkdir(out);
assert.equal(await realpath(out), out);
const evidence = (name, record) => save(join(out, name), record);
await evidence('admission-readback.json', { admission, admittedPath, admissionHash, boundPath, inputHashes,
  startedAt: stamp(), pid: process.pid, parentGcExposed: true,
  startedProcessAt: new Date(performance.timeOrigin).toISOString() });
const data = join(out, 'disposable');
const areas = { native: join(data, 'native'), composed: join(data, 'composed'), profile: join(data, 'edge-profile') };
const processes = [];
const browserState = {};
const observed = [];
const cleanup = { errors: [], browserBefore: [], browserAfter: [], residue: [] };
const sqliteReaders = { opened: 0, closed: 0 };
let verified = false;
let dataCreated = false;
let firstFailure;
let current = { tier: null, caseId: null, step: 'pre-execution binding' };

function fail(error) {
  return { ...current, name: error.name, message: error.message, stack: error.stack, at: stamp() };
}
function append(name, record) {
  appendFileSync(join(out, name), JSON.stringify(record) + '\n');
}
const field = (object, path) => path.reduce((at, key) => at && Object.hasOwn(at, key) ? at[key] : undefined, object);
const getEvents = (events, type, nodeId) => events.filter((event) => event.type === type &&
  (nodeId === undefined || event.nodeId === nodeId));
const isTerminal = (status) => ['failed', 'succeeded', 'cancelled', 'exhausted'].includes(status);
const subjectNode = (test) => test.ops ? 'mut' : 'done';

async function readRows(openReadOnlyDatabaseClient, gateway, runId, loopId, ms) {
  const client = openReadOnlyDatabaseClient(gateway.record.db);
  sqliteReaders.opened += 1;
  const query = async (sql, value) => {
    const result = await within(client.execute({ sql, args: [value] }), ms(), 'read-only SQLite observation');
    return result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column, row[column]])));
  };
  try {
    const rows = await query('SELECT id, status, current_node_id, version_id, failure, result, last_event_seq, finalized_at FROM runs WHERE id = ?', runId);
    const events = await query('SELECT seq, ts, type, node_id, payload FROM run_events WHERE run_id = ? ORDER BY seq', runId);
    const runs = await query('SELECT id FROM runs WHERE loop_id = ? ORDER BY id', loopId);
    return { rows, events, runs };
  } finally {
    client.close();
    sqliteReaders.closed += 1;
  }
}

function cleanDiagnostic(failure) {
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert(!/^(stack|stacktrace)$/iu.test(key), 'Public error stack field: ' + key);
        visit(child);
      }
    } else if (typeof value === 'string') {
      const text = value.replaceAll('\\', '/').toLowerCase();
      for (const path of [binding.checkout, binding.nodePath, data]) {
        assert(!text.includes(path.replaceAll('\\', '/').toLowerCase()), 'Public implementation path');
      }
      assert(!/[\r\n]\s+at\s+(?:\S+\s+\()?[\w/.:\\-]+:\d+:\d+/u.test(value), 'Public error stack frame');
    }
  };
  visit(failure);
}

function assertNoRepairCanaries(text, surface) {
  for (const marker of unexpectedRepairFault.markers) {
    assert(!text.includes(marker), surface + ' contains private repair marker ' + marker);
  }
}

async function inspectPrivateRepairLog(gateway, runId) {
  const text = await readFile(join(out, 'composed-gateway.log'), 'utf8');
  const matches = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.startsWith('{')) continue;
    const entry = JSON.parse(line);
    if (entry.pid === gateway.child.pid && entry.runId === runId && entry.nodeId === 'mut') {
      matches.push({ line: index + 1, entry });
    }
  }
  return { pid: gateway.child.pid, runId, nodeId: 'mut', matches };
}

function assertFailure(test, run) {
  const failure = run.failure;
  const oracle = test.expect;
  assert(failure, 'Expected run failure');
  assert.equal(failure.nodeId, subjectNode(test));
  const hasAuthoredIndex = Number.isInteger(oracle.index);
  const code = hasAuthoredIndex ? (baseline ? 'INTERNAL_ERROR' : contract.codes[oracle.kind]) :
    baseline && oracle.exitDepth ? 'INTERNAL_ERROR' : oracle.code;
  const resumable = hasAuthoredIndex ? baseline : (baseline && oracle.exitDepth) || oracle.resumable;
  assert.equal(failure.code, code);
  assert.equal(failure.resumable, resumable);
  assert.equal(run.recovery.resume.allowed, resumable);
  if (!resumable) assert.equal(run.recovery.resume.code, 'FAILURE_NOT_RESUMABLE');
  if (hasAuthoredIndex) {
    if (baseline) {
      assert.equal(typeof failure.details?.stack, 'string');
      assert(failure.message.includes(oracle.cause), 'Baseline diagnostic differs: ' + failure.message);
    } else {
      assert.equal(field(failure, contract.indexPath), oracle.index + contract.indexBase);
      assert.equal(field(failure, contract.typePath), contract.types[oracle.op]);
      assert(JSON.stringify(failure).includes(oracle.cause), 'Missing useful authored cause: ' + oracle.cause);
    }
  } else if (!baseline) {
    assert.equal(field(failure, contract.indexPath), undefined);
    assert.equal(field(failure, contract.typePath), undefined);
  }
  if (oracle.exitDepth) {
    assert(failure.message.includes(oracle.cause), 'Missing Exit evaluator diagnostic');
    if (baseline) assert.equal(typeof failure.details?.stack, 'string');
  }
  if (test.unexpectedRepair) {
    if (baseline) {
      assert(failure.message.includes(unexpectedRepairFault.messagePath));
      assert(failure.details?.stack?.includes(unexpectedRepairFault.stackPath));
    } else {
      assert.equal(failure.message, contract.unexpectedRepairMessage);
      assertNoRepairCanaries(JSON.stringify(failure), 'Public repair failure');
    }
  } else if (!baseline) cleanDiagnostic(failure);
}

function compareDurable(run, events, raw) {
  assert.equal(raw.rows.length, 1);
  const [row] = raw.rows;
  assert.equal(row.id, run.id);
  assert.equal(row.status, run.status);
  assert.equal(row.version_id, run.versionId);
  assert.equal(row.current_node_id, run.currentNodeId ?? null);
  assert.equal(row.last_event_seq, run.lastEventSeq);
  assert.equal(row.finalized_at, run.finalizedAt);
  assert.deepEqual(row.failure === null ? undefined : JSON.parse(row.failure), run.failure);
  assert.deepEqual(row.result === null ? undefined : JSON.parse(row.result), run.result);
  assert.deepEqual(raw.events.map((event) => ({
    ...JSON.parse(event.payload), runId: run.id, seq: event.seq, ts: event.ts, type: event.type,
    ...(event.node_id !== null ? { nodeId: event.node_id } : {}),
  })), events);
  assert.deepEqual(raw.runs, [{ id: run.id }]);
}

function assertVocabulary(document, expected) {
  const tables = [];
  function visit(value) {
    if (Array.isArray(value)) {
      if (value.includes('INTERNAL_ERROR') && value.includes('OUTPUT_SCHEMA_MISMATCH')) tables.push(value);
      else value.forEach(visit);
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(document);
  assert(tables.length > 0, 'No run failure enum located in OpenAPI');
  for (const table of tables) {
    if (baseline) assert(!table.some((value) => /^MUTATION_/u.test(value)));
    else for (const code of expected) assert(table.includes(code), 'OpenAPI omits ' + code);
  }
}

async function runCase(test, gateway, mcp, schemas, openReadOnlyDatabaseClient) {
  const caseOut = join(out, test.id);
  await mkdir(caseOut);
  current.caseId = test.id;
  const until = Date.now() + bounds.case;
  function ms() {
    const remaining = until - Date.now();
    assert(remaining > 0, 'Case wall deadline exceeded');
    return Math.min(bounds.request, remaining);
  }
  const saveCase = (name, record) => save(join(caseOut, name + '.json'), record);
  const http = async (label, method, path, expected, body) => {
    current.step = label;
    const response = await rest(gateway.origin, method, path, ms(), body);
    append(test.id + '-requests.ndjson', { label, ...response });
    assert.equal(response.status, expected, label + ' HTTP status');
    assert(response.body !== undefined, label + ' requires valid JSON');
    return response.body;
  };
  const call = async (name, args) => {
    current.step = 'MCP ' + name;
    const response = await mcp.call(name, args, ms());
    append(test.id + '-mcp.ndjson', { name, args, response });
    return response;
  };
  async function collectPages(requestPage) {
    const collected = [];
    let after = 0;
    for (let index = 0; index < 24; index += 1) {
      const page = await requestPage(after);
      assert(Array.isArray(page.items) && page.items.length <= 2);
      for (const event of page.items) {
        assert(event.seq > after && event.seq > (collected.at(-1)?.seq ?? 0));
        schemas.RunEventSchema.parse(event);
        collected.push(event);
      }
      if (!page.hasMore) return collected;
      assert.equal(page.nextAfter, collected.at(-1)?.seq);
      assert(page.nextAfter > after, 'Nonadvancing event cursor');
      after = page.nextAfter;
    }
    assert.fail('Event paging exceeded fixture bound');
  }
  const runGet = (runId) => http('Run snapshot', 'GET', '/runs/' + runId, 200);
  async function waitFinal(runId, laterThan = 0) {
    for (;;) {
      const snapshot = await runGet(runId);
      if (isTerminal(snapshot.status) && snapshot.finalizedAt && snapshot.lastEventSeq > laterThan) return snapshot;
      await delay(Math.min(ms(), 65));
    }
  }
  const getRestEvents = (path) => collectPages((after) => http('REST event page', 'GET', path + '/events?limit=2&after=' + after, 200));
  const getMcpEvents = (runId) => collectPages(async (after) => {
    const result = await call('read_run_events', { runId, after, limit: 2 });
    assert(!result.isError);
    return result.structuredContent;
  });

  await saveCase('fixture', { test, definition: definition(test) });
  if (test.tier === 'composed') {
    current.step = 'configure structured port';
    const configured = await gateway.control('configure', test.mode, ms());
    assert.equal(configured.mode, test.mode);
    assert.equal(configured.overridden, test.mode !== 'missing-port');
    assert.equal(configured.absent, test.mode === 'missing-port');
    await saveCase('structured-configured', configured);
  }
  const body = { definition: definition(test) };
  const draft = await http('Create draft', 'POST', '/loops', 201, body);
  const loop = '/loops/' + draft.loop.id;
  const validation = await http('Validate authored fixture', 'POST', loop + '/validate', 200, body);
  assert.equal(validation.publishable, true, 'Authored fixture was refused before runtime');
  const { version } = await http('Publish authored fixture', 'POST', loop + '/publish', 200);
  assert.equal(version.status, 'published');
  const { run: started } = await http('Start published version', 'POST', loop + '/runs', 202,
    { triggerNodeId: 'start', versionId: version.id, input: {} });
  assert.equal(started.loopId, draft.loop.id);
  assert.equal(started.versionId, version.id);
  assert.equal(started.pinned.source, 'published');
  const path = '/runs/' + started.id;
  const run = await waitFinal(started.id);
  const events = await getRestEvents(path);
  current.step = 'SQLite at finalization';
  const raw = await readRows(openReadOnlyDatabaseClient, gateway, run.id, draft.loop.id, ms);
  await saveCase('before-recovery', { run, events, raw });
  assert.equal(run.status, test.expect.status);
  schemas.RunSnapshotSchema.parse(run);
  compareDurable(run, events, raw);
  assert.equal(getEvents(events, 'node.finished', 'start').length, 1);
  const nodeId = subjectNode(test);
  const entered = getEvents(events, 'node.started', nodeId);
  assert.equal(entered.length, 1);
  assert.equal(entered[0].attempt, 1);
  const finalEvents = events.filter((event) => ['run.failed', 'run.finished', 'run.cancelled'].includes(event.type));
  assert.equal(finalEvents.length, 1);
  const thread = await http('Current context thread', 'GET', path + '/thread', 200);
  if (test.expect.status === 'failed') {
    current.step = 'Failure classification';
    schemas.RunFailureSchema.parse(run.failure);
    assertFailure(test, run);
    assert.equal(finalEvents[0].type, 'run.failed');
    assert.deepEqual(finalEvents[0].failure, run.failure);
    assert.equal(getEvents(events, 'node.finished', nodeId).length, 0);
    if (test.ops) assert.equal(getEvents(events, 'node.started', 'done').length, 0);
    else assert.equal(getEvents(events, 'exit.evaluated', 'done').length, 0);
    assert.equal(run.result, undefined);
    const historical = await http('Context before subject node', 'GET', path + '/thread?at=' + (entered[0].seq - 1), 200);
    assert.deepEqual(historical.vars, {});
    assert.deepEqual(thread.vars, historical.vars);
  } else {
    current.step = 'Successful patch and result';
    assert.equal(run.failure, undefined);
    if (test.ops) {
      const commits = getEvents(events, 'node.finished', 'mut');
      assert.equal(commits.length, 1);
      assert.equal(commits[0].route, 'out');
      assert.deepEqual(commits[0].patch, test.expect.patch);
    }
    assert.equal(getEvents(events, 'node.started', 'done').length, 1);
    assert.equal(getEvents(events, 'node.finished', 'done').length, 1);
    assert.equal(finalEvents[0].type, 'run.finished');
    assert.deepEqual(thread.vars, test.ops ? test.expect.result : {});
    assert.deepEqual(run.result, test.expect.result);
    assert.deepEqual(finalEvents[0].result, test.expect.result);
  }

  if (test.tier === 'composed') {
    current.step = 'Structured-port observation';
    const { calls } = await gateway.control('calls', null, ms());
    await saveCase('structured-call-readback', calls);
    assert.equal(calls.length, test.calls);
    for (const call of calls) {
      assert.equal(call.mode, test.mode);
      assert.equal(call.aborted, false);
      assert.equal(call.request.model, 'gpt-6-luna');
      assert.equal(call.request.effort, 'low');
      assert.match(call.request.prompt, /Validation errors/iu);
      assert.deepEqual(call.request.schema, test.ops.find((op) => op.op === 'coerce').jsonSchema);
    }
  }
  if (test.resume || test.unexpectedRepair) {
    const full = await call('get_run', { runId: run.id });
    assert(!full.isError);
    assert.deepEqual(full.structuredContent, run);
    assert.deepEqual(await getMcpEvents(run.id), events);
    const result = await call('list_runs', { loopId: run.loopId, status: ['failed'] });
    assert(!result.isError);
    assert.deepEqual(result.structuredContent.items.map((item) => item.id), [run.id]);
    assert.deepEqual(result.structuredContent.items[0].failure, { code: run.failure.code, message: run.failure.message });
  }

  if (test.unexpectedRepair) {
    const restList = await http('REST unexpected failure list', 'GET', '/runs?status=failed&loopId=' + run.loopId, 200);
    assert.deepEqual(restList.items.map((item) => item.id), [run.id]);
    assert.deepEqual(restList.items[0].failure, run.failure);
    current.step = 'Correlated private diagnostic log';
    const diagnostics = await inspectPrivateRepairLog(gateway, run.id);
    await saveCase('unexpected-repair-private', diagnostics);
    const logged = JSON.stringify(diagnostics.matches);
    for (const path of [unexpectedRepairFault.messagePath, unexpectedRepairFault.stackPath]) {
      assert(logged.includes(path), 'Correlated private repair diagnostic missing ' + path);
    }
    assert.equal(getEvents(events, 'run.resumed').length, 0);
    if (!baseline) {
      current.step = 'Unexpected repair public projection privacy';
      assertNoRepairCanaries(JSON.stringify(raw), 'Durable SQLite run and events');
      for (const file of [test.id + '-requests.ndjson', test.id + '-mcp.ndjson', 'composed-mcp-stdout.ndjson']) {
        assertNoRepairCanaries(await readFile(join(out, file), 'utf8'), file);
      }
    }
  }

  if (test.inspector) {
    current.step = 'Served inspector';
    const remaining = until - Date.now();
    assert(remaining > 0);
    const cause = test.unexpectedRepair
      ? baseline ? unexpectedRepairFault.messagePath : contract.unexpectedRepairMessage
      : test.expect.cause;
    await inspectRun({ binding, gateway, run, code: run.failure.code, cause, nodeId,
      visibleOperation: baseline || test.unexpectedRepair || !test.ops ? null : contract.visibleOperation,
      forbiddenText: !baseline && test.unexpectedRepair ? unexpectedRepairFault.markers : [],
      profile: areas.profile, out: caseOut, requestBudget: ms,
      bounds: { ...bounds, request: ms(), startup: Math.min(bounds.startup, remaining) }, browserState });
    ms();
  }
  if (test.unexpectedRepair) {
    const currentRun = await runGet(run.id);
    assert.equal(currentRun.recovery.resume.allowed, true);
    assert.deepEqual(currentRun, run, 'Public observations altered the unexpected failure');
  }

  if (test.resume && (!baseline || admission.baselineResume)) {
    const fresh = test.resume === 'rest' ? await runGet(run.id) : (await call('get_run', { runId: run.id })).structuredContent;
    assert.deepEqual(fresh, run, 'Recovery must use the same stable finalized observation');
    const { observedSeq } = fresh.recovery;
    assert.equal(observedSeq, fresh.lastEventSeq);
    if (test.resume === 'rest') {
      const response = await http('REST Resume', 'POST', path + '/resume', baseline ? 200 : 409, { observedSeq });
      if (baseline) assert.equal(response.id, run.id);
      else assert.equal(response.code, 'FAILURE_NOT_RESUMABLE');
    } else {
      const response = await call('resume_run', { runId: run.id, observedSeq });
      if (baseline) {
        assert(!response.isError);
        assert.equal(response.structuredContent.id, run.id);
      } else {
        assert.equal(response.isError, true);
        assert.equal(response.structuredContent, undefined);
        assert(response.content.some((item) => item.type === 'text' && item.text.includes('FAILURE_NOT_RESUMABLE (HTTP 409)')));
      }
    }
    const after = baseline ? await waitFinal(run.id, run.lastEventSeq) : await runGet(run.id);
    const afterEvents = await getRestEvents(path);
    const afterRows = await readRows(openReadOnlyDatabaseClient, gateway, run.id, run.loopId, ms);
    await saveCase('after-recovery', { after, afterEvents, afterRows });
    current.step = 'Recovery durable readback';
    compareDurable(after, afterEvents, afterRows);
    if (baseline) {
      assert.equal(after.id, run.id);
      assert.equal(after.status, 'failed');
      assertFailure(test, after);
      assert.deepEqual(afterEvents.slice(0, events.length), events);
      assert.equal(getEvents(afterEvents, 'run.resumed').length, 1);
      assert.deepEqual(getEvents(afterEvents, 'node.started', nodeId).map((event) => event.attempt), [1, 2]);
      assert.equal(getEvents(afterEvents, 'run.failed').length, 2);
    } else {
      assert.deepEqual(after, run);
      assert.deepEqual(afterEvents, events);
      assert.deepEqual(afterRows, raw);
      const listing = await http('REST run list after refusal', 'GET', '/runs?loopId=' + run.loopId, 200);
      assert.deepEqual(listing.items.map((item) => item.id), [run.id]);
    }
  }
  return { caseId: test.id, tier: test.tier, runId: run.id, loopId: run.loopId, versionId: run.versionId,
    terminalSeq: finalEvents[0].seq, nodeId, nodeStartedSeq: entered[0].seq, status: run.status,
    failure: run.failure?.code ?? null, recordedAt: stamp(), witness: 'observed' };
}

try {
  assert.deepEqual(await capture(binding.input), binding, 'Source/build binding drift before native work');
  verified = true;
  await mkdir(data);
  dataCreated = true;
  assert.equal(await realpath(data), data);
  await mkdir(areas.native);
  await mkdir(areas.composed);
  const schemas = await boundImport(binding, 'contracts');
  const { openReadOnlyDatabaseClient } = await boundImport(binding, 'sqlite');
  current = { tier: 'native', caseId: null, step: 'Native gateway readiness' };
  const native = await startGateway('native', binding, areas.native, out, bounds, processes);
  const health = await rest(native.origin, 'GET', '/healthz', bounds.request);
  await evidence('native-health.json', health);
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.pid, String(native.child.pid));
  assert(health.instance);
  native.record.instance = health.instance;
  current.step = 'OpenAPI failure vocabulary';
  const openApi = await rest(native.origin, 'GET', '/openapi.json', bounds.request);
  await evidence('served-openapi.json', openApi);
  assert.equal(openApi.status, 200);
  const expectedCodes = baseline ? [] : [...new Set(Object.values(contract.codes))];
  assertVocabulary(openApi.body, expectedCodes);
  assertVocabulary(await json(join(binding.checkout, 'packages/api-client/openapi.json')), expectedCodes);
  const generated = await readFile(join(binding.checkout, 'packages/api-client/src/generated/schema.ts'), 'utf8');
  for (const code of expectedCodes) assert(generated.includes(JSON.stringify(code)), 'Generated client omits ' + code);
  current.step = 'Compiled stdio MCP handshake';
  const mcp = await startMcp(binding, native, areas.native, out, bounds, processes);
  for (const test of selected.filter((test) => test.tier === 'native')) {
    observed.push(await runCase(test, native, mcp, schemas, openReadOnlyDatabaseClient));
  }
  current = { tier: 'composed', caseId: null, step: 'Composed gateway readiness' };
  const composed = await startGateway('composed', binding, areas.composed, out, bounds, processes);
  const composedHealth = await rest(composed.origin, 'GET', '/healthz', bounds.request);
  await evidence('composed-health.json', composedHealth);
  assert.equal(composedHealth.status, 200);
  assert.equal(composedHealth.pid, String(composed.child.pid));
  assert(composedHealth.instance);
  composed.record.instance = composedHealth.instance;
  assert.notEqual(native.record.instance, composed.record.instance);
  current.step = 'Compiled stdio MCP handshake for composed gateway';
  const composedMcp = await startMcp(binding, composed, areas.composed, out, bounds, processes);
  for (const test of selected.filter((test) => test.tier === 'composed')) {
    observed.push(await runCase(test, composed, composedMcp, schemas, openReadOnlyDatabaseClient));
  }
  assert.equal(observed.length, selected.length);
} catch (error) {
  firstFailure = fail(error);
  await evidence('first-failure.json', firstFailure);
} finally {
  const recordCleanupError = (where, error) => cleanup.errors.push({ where, message: error.message, at: stamp() });
  if (browserState.attempted) {
    cleanup.browserEnvironmentKeys = browserState.environmentKeys;
    cleanup.browserTemp = browserState.temp;
    try {
      cleanup.browserBefore = browserState.owned ?? await browserProcesses(binding, areas.profile, bounds.request);
    } catch (error) {
      recordCleanupError('Browser pre-close process readback', error);
    }
    try {
      if (browserState.context) {
        await within(browserState.context.close(), bounds.cleanup, 'owned browser close');
      }
    } catch (error) {
      recordCleanupError('Browser close', error);
    }
    try {
      const until = Date.now() + bounds.cleanup;
      do {
        cleanup.browserAfter = await browserProcesses(binding, areas.profile, bounds.request, cleanup.browserBefore);
        if (!cleanup.browserAfter.length) break;
        await delay(100);
      } while (Date.now() < until);
      assert.deepEqual(cleanup.browserAfter, []);
    } catch (error) {
      recordCleanupError('Browser post-close process readback', error);
    }
  }
  for (const item of [...processes].reverse()) {
    try {
      if (item.close) await item.close();
      else await stopGateway(item, bounds);
    } catch (error) {
      recordCleanupError('Managed stop ' + item.record.label, error);
      if (item.child.exitCode === null && item.child.signalCode === null) {
        item.record.forcedOwnedChildStop = item.child.kill('SIGKILL');
      }
      try { await within(item.exited, bounds.cleanup, 'owned process exit'); }
      catch (stopError) { recordCleanupError('Owned process exit ' + item.record.label, stopError); }
    }
    if (item.record.ready) {
      try { await checkClosedPort(item.record.ready.port, Math.min(bounds.request, 1500)); }
      catch (portError) { recordCleanupError('Closed listener ' + item.record.label, portError); }
    }
  }
  if (dataCreated) {
    cleanup.sqliteReaders = sqliteReaders;
    try {
      assert(contained(out, data) && await realpath(data) === data, 'Disposable directory identity');
      assert(processes.every((item) => item.record.exit), 'Dispose only after every owned subprocess closes');
      assert(cleanup.errors.length === 0, 'An owned resource did not shut down cleanly');
      assert.equal(sqliteReaders.closed, sqliteReaders.opened, 'A parent SQLite client was not closed');
      cleanup.parentGcPasses = [];
      for (let pass = 1; pass <= 2; pass += 1) {
        await yieldTurn();
        globalThis.gc();
        cleanup.parentGcPasses.push({ pass, at: stamp() });
      }
      await yieldTurn();
      const knownDatabases = processes.map((item) => item.record.db).filter(Boolean);
      cleanup.sqliteHandles = await confirmSqliteRelease(binding, [areas.native, areas.composed], knownDatabases, bounds.cleanup);
      assert(
        cleanup.sqliteHandles.allPresentSqliteFilesHeldAtOnce === true ||
          (knownDatabases.length === 0 && cleanup.sqliteHandles.status === 'no SQLite files present'),
        'Could not acquire simultaneous exclusive SQLite handles',
      );
      assert.equal(await realpath(data), data, 'Disposable directory moved during cleanup');
      cleanup.residue = await readdir(data, { recursive: true });
      await rm(data, { recursive: true, maxRetries: 0 });
      await assert.rejects(lstat(data), { code: 'ENOENT' });
      cleanup.removed = true;
    } catch (error) {
      recordCleanupError('Disposable store/profile cleanup', error);
    }
  }
  if (verified) {
    try {
      assert.deepEqual(await capture(binding.input), binding, 'Source/build binding drift after native work');
      const afterHashes = Object.fromEntries(await Promise.all(harnessFiles.map(async (file) => [file, await hash(join(root, file))])));
      assert.deepEqual(afterHashes, inputHashes, 'Harness drifted during native work');
      cleanup.bindingRechecked = true;
    } catch (error) {
      recordCleanupError('Closing binding', error);
    }
  }
  cleanup.processes = processes.map((item) => item.record);
  await evidence('cleanup.json', cleanup);
  await evidence('result.json', { phase: admission.phase, head: admission.head, main: admission.main,
    scope: 'A1, A2 and A5 public functional matrix', selected: selected.map((test) => test.id), observed,
    firstFailure: firstFailure ?? null, cleanupPassed: cleanup.errors.length === 0 && verified,
    verdict: firstFailure || cleanup.errors.length ? 'incomplete' : baseline ? 'baseline behavior reproduced' : 'scoped functional checks passed' });
}
if (firstFailure || cleanup.errors.length) {
  process.stderr.write((firstFailure?.message ?? cleanup.errors[0].message) + '\n');
  process.exitCode = 1;
}
