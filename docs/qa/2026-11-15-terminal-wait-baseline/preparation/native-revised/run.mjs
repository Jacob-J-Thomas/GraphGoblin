import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanOwnedStore, collectSQLiteHandles } from './owned-store.mjs';
import { api, assertHealth, bounded, mcpSession, observe, refusedLocalPort,
  spawnOwned, stopGateway, windowsEnv } from './resources.mjs';

const suiteRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const [phase, checkoutInput, evidenceName, baselineName, ...extra] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(phase));
assert.match(evidenceName ?? '', /^evidence-(baseline|candidate)-[a-z0-9-]{3,48}$/);
assert.ok(evidenceName.startsWith('evidence-' + phase + '-'));
assert.equal(extra.length, 0);
if (phase === 'candidate') assert.match(baselineName ?? '', /^evidence-baseline-[a-z0-9-]{3,48}$/);
else assert.equal(baselineName, undefined);
assert.equal(process.platform, 'win32');
assert.deepEqual(process.execArgv, ['--expose-gc']);
assert.equal(process.version, 'v22.23.4');
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.equal(typeof globalThis.gc, 'function');
const profile = resolve(suiteRoot, '..', '..', '..');
const projectNode = await realpath(join(profile, '.claude', 'codex-runs', 'GraphGoblin',
  'runtime', 'node-v22.23.4-win-x64', 'node.exe'));
assert.equal(await realpath(process.execPath), projectNode);
const checkout = await realpath(resolve(checkoutInput));
const worktreeRoot = await realpath(join(profile, '.codex', 'worktrees'));
assert.match(relative(worktreeRoot, checkout), /^gg-[^\\/]+[\\/]GraphGoblin$/i);

const evidenceDir = join(suiteRoot, evidenceName);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  phase, checkout, runner: { pid: process.pid, executable: projectNode, node: process.version },
  runtimeBindings: {}, processes: [], rest: [], W1: {}, W2: {}, W3: {}, W4: {}, cleanup: {},
};
const writers = new Set();
const mcpConnections = new Set();
const observers = new Set();
let cleanupChild;
let runtime;
let failure;
const markerName = 'script-executions.ndjson';
const markerCode = 'if(process.cwd().toLowerCase()!==process.env.GG_DATA_DIR?.toLowerCase())throw new Error("qa410-store-mismatch");require("node:fs").appendFileSync("script-executions.ndjson",JSON.stringify({pid:process.pid,ppid:process.ppid,cwd:process.cwd(),exe:process.execPath,code:7})+"\\n");process.stderr.write("qa410-local-exit7");process.exitCode=7;';
const terminalTypes = new Set(['run.failed', 'run.finished', 'run.cancelled']);

function serialize(_key, value) {
  if (value instanceof Error) return { ...value, name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'bigint') return value.toString();
  return value;
}

async function save(name, value) {
  await writeFile(join(evidenceDir, name), JSON.stringify(value, serialize, 2) + '\n', { flag: 'wx' });
}

async function bind(name, relativePath) {
  const file = await realpath(join(checkout, relativePath));
  assert.equal(relative(checkout, file).replaceAll('\\', '/'), relativePath);
  report.runtimeBindings[name] = { file, sha256: sha(await readFile(file)) };
}

async function prepareBindings() {
  for (const [name, path] of Object.entries({
    gateway: 'apps/api/dist/main.js',
    apiIndex: 'apps/api/dist/index.js',
    container: 'apps/api/dist/container.js',
    mcp: 'apps/mcp/dist/main.js',
  })) await bind(name, path);
  for (const [name, pkg, entry] of [['sqlite', 'infrastructure', './sqlite'], ['contracts', 'contracts', '.']]) {
    const metadata = JSON.parse(await readFile(join(checkout, 'packages', pkg, 'package.json'), 'utf8'));
    assert.equal(metadata.name, '@graphgoblin/' + pkg);
    const target = metadata.exports[entry].import;
    assert.match(target, /^\.\/dist\/(?:[a-z-]+\/)*index\.js$/);
    await bind(name, 'packages/' + pkg + '/' + target.slice(2));
  }
}

async function createStore(name) {
  const store = join(evidenceDir, name);
  await mkdir(store);
  assert.equal(await realpath(store), store);
  return store;
}

async function boot(store, role, mode = 'ordinary') {
  const env = windowsEnv({
    GG_DATA_DIR: store, GG_DB_URL: pathToFileURL(join(store, 'graphgoblin.db')).href,
    GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
    GG_OLLAMA_ENABLED: 'false', GG_SWAGGER_UI: 'false', GG_WEB_DIST: '', GG_GOBLIN_DIST: '',
    GG_MASTER_KEY: Buffer.alloc(32, 44).toString('base64'), GG_LOG_LEVEL: 'info',
  });
  const handle = spawnOwned(role, [join(suiteRoot, 'gateway.mjs'), mode, checkout, store], {
    cwd: checkout, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env,
  }, report.processes);
  writers.add(handle);
  const ready = await handle.waitMessage('ready', () => true, 50_000);
  assert.equal(ready.pid, handle.child.pid);
  assert.equal(ready.mode, mode);
  assert.equal(ready.store, store);
  assert.match(ready.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
  Object.assign(handle.identity, {
    origin: ready.origin, store, windowsCreationTime: ready.windowsCreationTime, mode,
  });
  handle.request = api(ready.origin, report.rest);
  const health = await handle.request('/healthz', { record: true });
  assertHealth(handle, health);
  handle.identity.instance = health.headers.instance;
  return handle;
}

async function mcp(handle) {
  const connection = await mcpSession(checkout, report.runtimeBindings.mcp.file, handle.identity.origin, report.processes);
  mcpConnections.add(connection);
  return connection;
}

async function closeMcp(connection) {
  await connection.close();
  mcpConnections.delete(connection);
}

async function stop(handle) {
  await stopGateway(handle);
  handle.identity.listenerClosed = true;
  writers.delete(handle);
}

function readOnly(store) {
  const file = join(store, 'graphgoblin.db');
  const client = runtime.sqlite.openReadOnlyDatabaseClient(file);
  const handle = {
    async raw(id) {
      const row = await client.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [id] });
      const events = await client.execute({
        sql: 'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq', args: [id],
      });
      assert.equal(row.rows.length, 1);
      return { row: { ...row.rows[0] }, events: events.rows.map((event) => ({ ...event })) };
    },
    close() {
      client.close();
      observers.delete(handle);
    },
  };
  observers.add(handle);
  return handle;
}

function decoded(raw) {
  return raw.events.map(({ type, seq, node_id: nodeId, payload }) => ({
    ...JSON.parse(payload), type, seq, ...(nodeId ? { nodeId } : {}),
  }));
}

function terminal(raw, type) {
  const matches = decoded(raw).filter((event) => terminalTypes.has(event.type));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, type);
  return matches[0];
}

function runPath(id, suffix = '') {
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  return '/runs/' + id + suffix;
}

async function json(handle, path, status, options = {}) {
  const response = await handle.request(path, { record: true, ...options });
  assert.equal(response.status, status, path + ': ' + response.raw);
  return response.data;
}

function chain(name, nodes) {
  const full = [{ id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } }, ...nodes];
  return runtime.contracts.LoopDefinitionSchema.parse({
    schemaVersion: runtime.contracts.CURRENT_DEFINITION_FORMAT, name, nodes: full,
    edges: full.slice(1).map((node, i) => ({
      id: 'edge-' + (i + 1), from: { node: full[i].id, port: 'out' }, to: { node: node.id },
    })),
  });
}

const wait = { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'QA 410 release' } };
const exit = (outcome = 'success') =>
  ({ id: 'done', kind: 'exit', label: 'Done', config: { outcome, returns: 'none' } });

async function publish(handle, definition) {
  const created = await json(handle, '/loops', 201, { body: { definition } });
  await json(handle, '/loops/' + created.loop.id + '/publish', 200, { method: 'POST' });
  return created.loop.id;
}

async function publishPair(handle, label, failing) {
  const script = { id: 'work', kind: 'script', label: 'Native local exit seven', config: {
    command: projectNode, args: ['-e', markerCode], cwd: handle.identity.store,
    stdin: 'none', stdout: 'ignore', timeoutSeconds: 5,
  } };
  const child = await publish(handle, chain(label + ' child', [wait, ...(failing ? [script] : []), exit()]));
  return publish(handle, chain(label + ' parent', [
    { id: 'call', kind: 'subloop', label: 'Call child', config: { loopRef: { loopId: child } } },
    exit(),
  ]));
}

async function startRun(handle, loopId) {
  const response = await json(handle, '/loops/' + loopId + '/runs', 202, { body: {} });
  return response.run.id;
}

async function parked(handle, loopId) {
  const parentId = await startRun(handle, loopId);
  const parent = await observe('genuine parent child wait', async () => {
    const response = await handle.request(runPath(parentId));
    assert.equal(response.status, 200);
    const run = response.data;
    assert.ok(['queued', 'running', 'waiting'].includes(run.status));
    return run.status === 'waiting' && run.waiting?.kind === 'child' ? run : false;
  });
  const childId = parent.waiting.childRunId;
  const child = await observe('genuine child input wait', async () => {
    const response = await handle.request(runPath(childId));
    assert.equal(response.status, 200);
    const run = response.data;
    assert.ok(['queued', 'running', 'waiting'].includes(run.status));
    return run.status === 'waiting' && run.waiting?.kind === 'input' ? run : false;
  });
  assert.equal(child.parentRunId, parentId);
  assert.equal(parent.waiting.waitId, parentId + ':' + parent.waiting.startedSeq);
  assert.equal(child.waiting.waitId, childId + ':' + child.waiting.startedSeq);
  const children = await json(handle, '/runs?parent=' + parentId + '&limit=1', 200);
  assert.deepEqual(children.items.map((run) => run.id), [childId]);
  assert.equal(children.nextCursor, null);
  return { loopId, parentId, childId, parentWait: parent.waiting, childWait: child.waiting };
}

async function readPages(label, read) {
  const pages = [];
  let cursor;
  do {
    const page = await read(cursor);
    assert.ok(Array.isArray(page.items));
    assert.ok(page.nextCursor === null || typeof page.nextCursor === 'string');
    pages.push(page);
    if (page.nextCursor !== null) assert.notEqual(page.nextCursor, cursor);
    cursor = page.nextCursor;
  } while (cursor !== null && pages.length < 8);
  assert.equal(cursor, null, label + ' exceeded its fixture page bound');
  return pages;
}

async function surfaces(handle, mcpConnection, db, id, loopId, parentId = 'none') {
  const rest = await json(handle, runPath(id), 200);
  const restPages = await readPages('REST /runs', (cursor) => json(handle, '/runs?' +
    new URLSearchParams({ loopId, parent: parentId, limit: '1', ...(cursor ? { cursor } : {}) }), 200));
  const mcpGet = await mcpConnection.tool('get_run', { runId: id });
  const mcpPages = await readPages('MCP list_runs', (cursor) => mcpConnection.tool('list_runs', {
    loopId, parentRunId: parentId, limit: 1, ...(cursor ? { cursor } : {}),
  }).then((response) => response.structuredContent));
  const [restList, mcpList] = [restPages, mcpPages].map((pages) => {
    const found = pages.flatMap((page) => page.items).filter((run) => run.id === id);
    assert.equal(found.length, 1);
    return found[0];
  });
  const structured = mcpGet.structuredContent;
  const raw = await db.raw(id);
  const restEvents = await json(handle, runPath(id, '/events?limit=100'), 200);
  const mcpEvents = await mcpConnection.tool('read_run_events', { runId: id, limit: 100 });
  assert.equal(restEvents.hasMore, false);
  assert.deepEqual(mcpEvents.structuredContent, restEvents);
  assert.deepEqual(restEvents.items, decoded(raw).map((event, index) => ({
    ...event, ts: raw.events[index].ts, runId: id,
  })));
  assert.deepEqual(structured, rest);
  for (const listing of [restList, mcpList]) {
    assert.equal(listing.status, rest.status);
    assert.equal(listing.finalizedAt, rest.finalizedAt);
    assert.equal(Object.hasOwn(listing, 'waiting'), Object.hasOwn(rest, 'waiting'));
    assert.deepEqual(listing.waiting, rest.waiting);
  }
  assert.deepEqual(restList.failure, rest.failure);
  if (rest.failure) {
    assert.equal(mcpList.failure.code, rest.failure.code);
    assert.equal(mcpList.failure.message, rest.failure.message);
    assert.deepEqual(mcpList.failure.script, rest.failure.script);
    if (rest.failure.script) assert.equal(mcpList.failure.resumable, rest.failure.resumable);
  }
  assert.equal(raw.row.status, rest.status);
  if (raw.row.waiting === null) assert.equal(Object.hasOwn(rest, 'waiting'), false);
  else assert.deepEqual(JSON.parse(raw.row.waiting), rest.waiting);
  return { rest, restPages, mcpGet, mcpPages, restEvents, mcpEvents, raw };
}

async function pairReadback(handle, connection, db, pair) {
  const parent = await surfaces(handle, connection, db, pair.parentId, pair.loopId);
  const child = await json(handle, runPath(pair.childId), 200);
  const rawChild = await db.raw(pair.childId);
  assert.equal(child.parentRunId, pair.parentId);
  assert.equal(rawChild.row.parent_run_id, pair.parentId);
  const childListing = await json(handle, '/runs?parent=' + pair.parentId + '&limit=1', 200);
  assert.deepEqual(childListing.items.map((run) => run.id), [pair.childId]);
  assert.equal(childListing.nextCursor, null);
  return { parent, child, childListing, rawChild };
}

function assertParked(observed, pair) {
  assert.equal(observed.parent.rest.status, 'waiting');
  assert.equal(observed.child.status, 'waiting');
  assert.deepEqual(observed.parent.rest.waiting, pair.parentWait);
  assert.deepEqual(observed.child.waiting, pair.childWait);
  const p = decoded(observed.parent.raw).find((event) => event.type === 'run.waiting');
  const c = decoded(observed.rawChild).find((event) => event.type === 'run.waiting');
  assert.deepEqual(p.wait, pair.parentWait);
  assert.deepEqual(c.wait, pair.childWait);
  assert.deepEqual(JSON.parse(observed.rawChild.row.waiting), pair.childWait);
  assert.equal(observed.parent.raw.row.finalized_at, null);
  assert.equal(observed.rawChild.row.finalized_at, null);
}

async function answer(handle, id, waitId, value = { release: 'qa410' }) {
  return json(handle, runPath(id, '/input'), 200, { body: { waitId, input: value } });
}

async function finalized(handle, id, status) {
  const observed = await observe(status + ' and finalized ' + id, async () => {
    const response = await handle.request(runPath(id));
    assert.equal(response.status, 200);
    return response.data.status === status && response.data.finalizedAt ? response.data : false;
  });
  return observed;
}

function matchedChildHistory(parent, child, pair, parentTerminal, childTerminal) {
  const events = decoded(parent);
  const starts = events.filter((event) => event.type === 'child_run.started');
  const parks = events.filter((event) => event.type === 'run.waiting');
  const wakes = events.filter((event) => event.type === 'run.woken');
  const completions = events.filter((event) => event.type === 'child_run.finished');
  for (const group of [starts, parks, wakes, completions]) assert.equal(group.length, 1);
  const [start] = starts;
  const [park] = parks;
  const [wake] = wakes;
  const [completion] = completions;
  const childEvents = decoded(child);
  const childParks = childEvents.filter((event) => event.type === 'run.waiting');
  const childWakes = childEvents.filter((event) => event.type === 'run.woken');
  assert.equal(childParks.length, 1);
  assert.equal(childWakes.length, 1);
  assert.deepEqual(childParks[0].wait, pair.childWait);
  assert.equal(childWakes[0].reason, 'input');
  assert.deepEqual(childWakes[0].payload, { release: 'qa410' });
  assert.ok(childParks[0].seq < childWakes[0].seq);
  assert.equal(start.childRunId, pair.childId);
  assert.deepEqual(park.wait, pair.parentWait);
  assert.equal(wake.reason, 'child');
  assert.equal(wake.payload.childRunId, pair.childId);
  assert.equal(wake.payload.childFinishedSeq, terminal(child, childTerminal).seq);
  assert.equal(completion.childRunId, pair.childId);
  assert.equal(completion.status, child.row.status);
  for (const event of [start, park, wake, completion]) assert.equal(event.nodeId, 'call');
  assert.ok(start.seq < park.seq && park.seq < wake.seq && wake.seq < completion.seq);
  assert.ok(completion.seq < terminal(parent, parentTerminal).seq);
}

function assertFailureHistory(parent, child, pair) {
  assert.equal(child.row.status, 'failed');
  assert.ok(child.row.finalized_at);
  const failure = terminal(parent, 'run.failed');
  const leaf = terminal(child, 'run.failed');
  assert.equal(failure.failure.code, 'SCRIPT_EXIT_CODE');
  assert.equal(failure.failure.nodeId, 'call');
  assert.equal(failure.failure.details.childRunId, pair.childId);
  assert.equal(failure.failure.details.childNodeId, 'work');
  assert.equal(failure.failure.resumable, leaf.failure.resumable);
  assert.deepEqual(failure.failure.script, leaf.failure.script);
  assert.equal(leaf.failure.script.exitCode, 7);
  assert.equal(leaf.failure.details.stderr, 'qa410-local-exit7');
  assert.equal(leaf.failure.script.state, 'completed');
  assert.equal(decoded(child).filter((event) => event.type === 'script.dispatched').length, 1);
  assert.equal(decoded(parent).filter((event) => event.type === 'node.started' && event.nodeId === 'done').length, 0);
  matchedChildHistory(parent, child, pair, 'run.failed', 'run.failed');
  return failure;
}

function assertFailed(observed, pair, oldWait) {
  const { parent, rawChild } = observed;
  const failure = assertFailureHistory(parent.raw, rawChild, pair);
  assert.equal(parent.rest.status, 'failed');
  assert.ok(parent.rest.finalizedAt);
  assert.deepEqual(parent.rest.failure, failure.failure);
  assert.deepEqual(JSON.parse(parent.raw.row.failure), failure.failure);
  assert.equal(parent.raw.row.last_event_seq, failure.seq);
  assert.ok(parent.raw.row.finalized_at);
  if (oldWait) assert.deepEqual(JSON.parse(parent.raw.row.waiting), pair.parentWait);
  else assert.equal(parent.raw.row.waiting, null);
}

async function scriptMarkers(store, writer) {
  const file = join(store, markerName);
  const raw = await readFile(file, 'utf8');
  const markers = raw.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(markers.length, 1);
  const [marker] = markers;
  assert.equal(marker.exe, projectNode);
  assert.equal(marker.ppid, writer.child.pid);
  assert.equal(await realpath(marker.cwd), store);
  assert.equal(marker.code, 7);
  assert.ok(Number.isSafeInteger(marker.pid) && marker.pid > 0 && marker.pid !== marker.ppid);
  return { marker, raw, sha256: sha(raw) };
}

async function clean(store, name, history) {
  const record = { path: store };
  report.cleanup[name] = record;
  assert.equal(observers.size, 0, 'all independent SQLite observers must be closed first');
  assert.equal(writers.size, 0, 'every owned gateway must be stopped first');
  await cleanOwnedStore(evidenceDir, store, record, (child) => { cleanupChild = child; }, history);
}

async function liveMatrix() {
  const store = await createStore('live-store');
  const writer = await boot(store, 'live-and-positive-ordinary-gateway');
  const connection = await mcp(writer);
  const db = readOnly(store);
  const failedLoop = await publishPair(writer, 'QA 410 live failure', true);
  const fail = await parked(writer, failedLoop);
  const keepWaiting = await parked(writer, failedLoop);
  report.W1.pair = fail;
  report.W1.before = await pairReadback(writer, connection, db, fail);
  assertParked(report.W1.before, fail);
  assert.ok(report.W1.before.parent.restPages.length > 1);
  assert.ok(report.W1.before.parent.mcpPages.length > 1);
  report.W3.activeBefore = await pairReadback(writer, connection, db, keepWaiting);
  assertParked(report.W3.activeBefore, keepWaiting);

  await answer(writer, fail.childId, fail.childWait.waitId);
  await finalized(writer, fail.parentId, 'failed');
  await finalized(writer, fail.childId, 'failed');
  report.W1.after = await pairReadback(writer, connection, db, fail);
  assertFailed(report.W1.after, fail, phase === 'baseline');
  if (phase === 'baseline') assert.equal(report.W1.after.parent.raw.row.waiting, report.W1.before.parent.raw.row.waiting);
  report.W1.script = await scriptMarkers(store, writer);

  const successLoop = await publishPair(writer, 'QA 410 success', false);
  const success = await parked(writer, successLoop);
  report.W3.successPair = success;
  report.W3.successBefore = await pairReadback(writer, connection, db, success);
  assertParked(report.W3.successBefore, success);
  await answer(writer, success.childId, success.childWait.waitId);
  await finalized(writer, success.parentId, 'succeeded');
  await finalized(writer, success.childId, 'succeeded');
  report.W3.successAfter = await pairReadback(writer, connection, db, success);
  const succeeded = report.W3.successAfter;
  assert.equal(succeeded.parent.raw.row.waiting, null);
  assert.equal(succeeded.rawChild.row.waiting, null);
  assert.equal(Object.hasOwn(succeeded.child, 'waiting'), false);
  assert.equal(succeeded.parent.rest.outcome, 'success');
  assert.equal(decoded(succeeded.parent.raw).filter((event) => event.type === 'node.finished' && event.nodeId === 'call').length, 1);
  assert.equal(decoded(succeeded.parent.raw).filter((event) => event.type === 'node.started' && event.nodeId === 'done').length, 1);
  matchedChildHistory(succeeded.parent.raw, succeeded.rawChild, success, 'run.finished', 'run.finished');
  const stale = await json(writer, runPath(success.childId, '/input'), 409, {
    body: { waitId: success.childWait.waitId, input: { release: 'stale' } },
  });
  assert.equal(stale.code, 'WAIT_MISMATCH');
  assert.deepEqual(await db.raw(success.childId), succeeded.rawChild);

  const authoredLoop = await publish(writer, chain('QA 410 authored failure exit', [wait, exit('failure')]));
  const authoredId = await startRun(writer, authoredLoop);
  const authoredWait = await observe('authored-failure input wait', async () => {
    const r = await writer.request(runPath(authoredId));
    assert.equal(r.status, 200);
    return r.data.status === 'waiting' && r.data.waiting?.kind === 'input' ? r.data.waiting : false;
  });
  await answer(writer, authoredId, authoredWait.waitId);
  await finalized(writer, authoredId, 'failed');
  report.W3.authoredFailure = await surfaces(writer, connection, db, authoredId, authoredLoop);
  assert.equal(report.W3.authoredFailure.rest.outcome, 'failure');
  assert.equal(report.W3.authoredFailure.rest.failure, undefined);
  assert.equal(report.W3.authoredFailure.raw.row.waiting, null);
  assert.equal(terminal(report.W3.authoredFailure.raw, 'run.finished').outcome, 'failure');

  report.W3.activeAfterOtherRuns = await pairReadback(writer, connection, db, keepWaiting);
  assertParked(report.W3.activeAfterOtherRuns, keepWaiting);
  assert.deepEqual(report.W3.activeAfterOtherRuns.parent.raw, report.W3.activeBefore.parent.raw);
  assert.deepEqual(report.W3.activeAfterOtherRuns.rawChild, report.W3.activeBefore.rawChild);
  await json(writer, runPath(keepWaiting.parentId, '/cancel'), 200, { method: 'POST' });
  await finalized(writer, keepWaiting.parentId, 'cancelled');
  await finalized(writer, keepWaiting.childId, 'cancelled');
  report.W3.cancelled = await pairReadback(writer, connection, db, keepWaiting);
  for (const raw of [report.W3.cancelled.parent.raw, report.W3.cancelled.rawChild]) {
    assert.equal(raw.row.waiting, null);
    terminal(raw, 'run.cancelled');
    assert.ok(raw.row.finalized_at);
  }
  assert.equal(Object.hasOwn(report.W3.cancelled.child, 'waiting'), false);
  assert.deepEqual(await scriptMarkers(store, writer), report.W1.script);
  await closeMcp(connection);
  db.close();
  await stop(writer);
  const history = phase === 'baseline' ? {
    directory: await createStore('private-history-seed'),
    sqliteBinding: report.runtimeBindings.sqlite,
    witness: [report.W1.after.parent.raw, report.W1.after.rawChild],
  } : undefined;
  await clean(store, 'live', history);
}

async function sidecars(store) {
  const entries = await readdir(store);
  const evidence = {};
  for (const name of ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm']) {
    if (!entries.includes(name)) {
      evidence[name] = { present: false };
      continue;
    }
    const file = join(store, name);
    const stat = await lstat(file, { bigint: true });
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(file), file);
    const data = await readFile(file);
    evidence[name] = { present: true, bytes: data.length, sha256: sha(data),
      device: stat.dev.toString(), fileId: stat.ino.toString() };
  }
  return evidence;
}

async function eventFirstMatrix() {
  const store = await createStore('event-first-store');
  const gated = await boot(store, 'event-first-gated-gateway', 'gated');
  const mcpBefore = await mcp(gated);
  const observer = readOnly(store);
  const loopId = await publishPair(gated, 'QA 410 event first', true);
  const pair = await parked(gated, loopId);
  report.W2.pair = pair;
  report.W2.before = await pairReadback(gated, mcpBefore, observer, pair);
  assertParked(report.W2.before, pair);
  await closeMcp(mcpBefore);
  await gated.send({ type: 'arm', parentId: pair.parentId, childId: pair.childId, waitId: pair.parentWait.waitId });
  await gated.waitMessage('armed', (message) => message.parentId === pair.parentId && message.childId === pair.childId);
  await answer(gated, pair.childId, pair.childWait.waitId);
  const gate = await gated.waitMessage('gate', (message) => message.runId === pair.parentId);
  report.W2.gate = gate;
  assert.equal(gate.pid, gated.child.pid);
  assert.equal(gate.childId, pair.childId);
  assert.equal(gate.delegateEntered, false);
  assert.equal(gate.change.status, 'failed');
  const landed = {
    parent: await observer.raw(pair.parentId),
    child: await observe('child finalized before deliberate interruption', async () => {
      const raw = await observer.raw(pair.childId);
      return raw.row.finalized_at ? raw : false;
    }),
  };
  report.W2.landing = landed;
  assert.equal(landed.parent.row.status, 'running');
  assert.equal(landed.parent.row.waiting, report.W2.before.parent.raw.row.waiting);
  assert.deepEqual(JSON.parse(landed.parent.row.waiting), pair.parentWait);
  for (const field of ['failure', 'finished_at', 'finalized_at']) assert.equal(landed.parent.row[field], null);
  const failureEvent = assertFailureHistory(landed.parent, landed.child, pair);
  assert.deepEqual(failureEvent.failure, gate.change.failure);
  assert.equal(landed.parent.row.last_event_seq, failureEvent.seq);
  assert.ok(landed.parent.row.thread_snapshot_seq < failureEvent.seq);
  report.W2.scriptBeforeKill = await scriptMarkers(store, gated);
  assertHealth(gated, await gated.request('/healthz', { record: true }));
  const lock = JSON.parse(await readFile(join(store, 'graphgoblin.lock'), 'utf8'));
  assert.equal(lock.pid, gated.child.pid);
  assert.equal(lock.windowsCreationTime, gated.identity.windowsCreationTime);
  assert.ok(!gated.identity.exit && !gated.identity.error);
  assert.equal(gated.identity.messages.filter((message) => message.type === 'gate').length, 1);
  observer.close();
  await collectSQLiteHandles();
  assert.equal(observers.size, 0);
  await save('W2-verified-before-interruption.json', {
    phase, process: { pid: gated.child.pid, windowsCreationTime: gated.identity.windowsCreationTime,
      origin: gated.identity.origin, store }, pair, gate, landed, failureEvent,
    script: report.W2.scriptBeforeKill,
  });

  // The sole deliberately abrupt API termination, after independent committed landing proof.
  assert.ok(gated.child.kill('SIGKILL'), 'failed to terminate the exact proven gate process');
  const interrupted = await bounded('gated process exit and pipe close', gated.closed);
  assert.ok(interrupted.signal === 'SIGKILL' || (interrupted.signal === null && interrupted.code !== 0),
    'expected abrupt exit, not an ordinary process shutdown');
  await refusedLocalPort(gated.identity.origin);
  gated.identity.listenerClosed = true;
  report.W2.interrupted = interrupted;
  writers.delete(gated);
  const crashFiles = await sidecars(store);
  assert.ok(crashFiles['graphgoblin.db'].present);
  assert.ok(crashFiles['graphgoblin.db-wal'].present && crashFiles['graphgoblin.db-wal'].bytes > 32);
  report.W2.beforeReopenFiles = crashFiles;
  await save('W2-post-crash-before-reopen.json', { interrupted, crashFiles });

  const restarted = await boot(store, 'event-first-ordinary-restart');
  assert.notEqual(restarted.identity.windowsCreationTime, gated.identity.windowsCreationTime);
  assert.equal(restarted.identity.store, gated.identity.store);
  const reopenedFile = await lstat(join(store, 'graphgoblin.db'), { bigint: true });
  assert.equal(reopenedFile.dev.toString(), crashFiles['graphgoblin.db'].device);
  assert.equal(reopenedFile.ino.toString(), crashFiles['graphgoblin.db'].fileId);
  const mcpAfter = await mcp(restarted);
  const afterDb = readOnly(store);
  await finalized(restarted, pair.parentId, 'failed');
  report.W2.after = await pairReadback(restarted, mcpAfter, afterDb, pair);
  assertFailed(report.W2.after, pair, phase === 'baseline');
  assert.equal(report.W2.after.parent.raw.row.thread_snapshot_seq, failureEvent.seq);
  assert.deepEqual(report.W2.after.parent.raw.events, landed.parent.events);
  assert.deepEqual(report.W2.after.rawChild, landed.child);
  assert.deepEqual(terminal(report.W2.after.parent.raw, 'run.failed'), failureEvent);
  assert.deepEqual(await scriptMarkers(store, gated), report.W2.scriptBeforeKill);
  await closeMcp(mcpAfter);
  afterDb.close();
  await stop(restarted);
  await clean(store, 'event-first');
}

async function historicalMatrix(baseline) {
  const origin = phase === 'baseline' ? report : baseline;
  const seed = origin.cleanup.live.seed;
  const expectedRoot = phase === 'baseline' ? evidenceDir : join(suiteRoot, baselineName);
  const seedDir = join(expectedRoot, 'private-history-seed');
  assert.equal(await realpath(seedDir), seedDir);
  const source = join(seedDir, 'graphgoblin.db');
  assert.equal(seed.database, source);
  assert.deepEqual(await readdir(seedDir), ['graphgoblin.db']);
  assert.equal(await realpath(source), source);
  const stat = await lstat(source);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(sha(await readFile(source)), seed.sha256);
  const store = await createStore('historical-store');
  const copied = join(store, 'graphgoblin.db');
  await copyFile(source, copied, constants.COPYFILE_EXCL);
  assert.equal(sha(await readFile(copied)), seed.sha256);
  const pair = origin.W1.pair;
  const original = origin.W1.after;
  assert.equal(original.parent.raw.row.status, 'failed');
  assert.ok(original.parent.raw.row.finalized_at);
  assert.ok(original.parent.raw.row.waiting);
  report.W4.seed = { ...seed, sourcePhase: 'baseline', parentId: pair.parentId };
  // The baseline witness already captured the fully projected exact run and child bytes.
  // This copy goes through ordinary startup before any new SQLite observer is opened.
  const writer = await boot(store, 'historical-ordinary-restart');
  const connection = await mcp(writer);
  const db = readOnly(store);
  const observed = await pairReadback(writer, connection, db, pair);
  report.W4.after = observed;
  assertFailed(observed, pair, true);
  assert.deepEqual(observed.parent.raw, original.parent.raw);
  assert.deepEqual(observed.rawChild, original.rawChild);
  assert.ok(!(await readdir(store)).includes(markerName));
  assert.equal(sha(await readFile(source)), seed.sha256);
  await closeMcp(connection);
  db.close();
  await stop(writer);
  await clean(store, 'historical');
}

async function failureCleanup() {
  for (const connection of [...mcpConnections]) {
    try { await closeMcp(connection); }
    catch (error) { connection.handle.identity.cleanupError = error; }
  }
  for (const observer of [...observers]) {
    try { observer.close(); }
    catch (error) { report.observerCloseError = error; }
  }
  for (const handle of [...writers]) {
    try {
      if (handle.identity.mode === 'gated' && handle.child.connected && !handle.identity.exit) {
        // The abrupt-kill branch above requires the saved landing proof. If the matrix stopped
        // earlier, permit only this explicitly recorded release and ordinary managed shutdown.
        await handle.send({ type: 'release-for-incomplete-cleanup' });
        handle.identity.incompleteCleanupReleasedGate = true;
        await observe('owned gated run settles after failure cleanup release', async () => {
          const a = await handle.request('/runs?status=queued,running,waiting,paused&limit=1');
          return a.status === 200 && a.data.items.length === 0;
        }, 2500);
      }
      if (handle.request || handle.identity.exit) await stop(handle);
      else handle.identity.cleanup = 'no verified origin for managed shutdown';
    } catch (error) {
      handle.identity.cleanupError = error;
    }
  }
}

await mkdir(evidenceDir);
assert.equal(await realpath(evidenceDir), evidenceDir);
const watchdog = setTimeout(() => {
  if (cleanupChild && cleanupChild.exitCode === null && cleanupChild.signalCode === null) cleanupChild.kill();
  process.stderr.write('QA #410 supervisor watchdog expired. Do not attribute an interruption or cleanup verdict to this timeout.\n');
  process.exit(124);
}, 210_000);
try {
  await prepareBindings();
  await save('runner.json', report);
  let baseline;
  if (baselineName) {
    const path = join(suiteRoot, baselineName, 'summary.json');
    assert.equal(await realpath(path), path);
    const bytes = await readFile(path);
    report.historicalBaseline = { path, sha256: sha(bytes) };
    baseline = JSON.parse(bytes);
    assert.equal(baseline.phase, 'baseline');
    assert.equal(baseline.result, 'assertions-met');
    assert.ok(baseline.W4.after);
  }
  runtime = {};
  for (const name of ['sqlite', 'contracts'])
    runtime[name] = await import(pathToFileURL(report.runtimeBindings[name].file).href);
  await liveMatrix();
  await eventFirstMatrix();
  await historicalMatrix(baseline);
} catch (error) {
  failure = error;
  report.error = error;
  await save('first-failure.json', report);
  await failureCleanup();
} finally {
  report.result = failure ? 'incomplete' : 'assertions-met';
  report.remaining = {
    writers: [...writers].map((handle) => ({ pid: handle.child.pid, role: handle.identity.role,
      origin: handle.identity.origin, windowsCreationTime: handle.identity.windowsCreationTime })),
    mcp: [...mcpConnections].map((connection) => connection.handle.child.pid),
    observers: observers.size,
    helper: cleanupChild?.pid,
  };
  await save('summary.json', report);
  clearTimeout(watchdog);
  if (failure) process.exit(1);
}
