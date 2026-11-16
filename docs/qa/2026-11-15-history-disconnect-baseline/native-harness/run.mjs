import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bounded, createTransport } from './transport.mjs';
import { cleanOwnedStore } from './owned-store.mjs';

const suiteRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const [phase, checkoutArg, evidenceName, baselineName, ...rest] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(phase));
assert.match(evidenceName ?? '', /^evidence-(baseline|candidate)-[a-z0-9-]{3,48}$/);
assert.ok(evidenceName.startsWith('evidence-' + phase + '-'));
assert.equal(rest.length, 0);
if (phase === 'candidate') assert.match(baselineName ?? '', /^evidence-baseline-[a-z0-9-]{3,48}$/);
else assert.equal(baselineName, undefined);
assert.equal(process.platform, 'win32');
assert.deepEqual(process.execArgv, ['--expose-gc']);
assert.equal(typeof globalThis.gc, 'function');
assert.equal(process.env.NODE_OPTIONS, undefined);
const profile = resolve(suiteRoot, '..', '..', '..');
const projectNode = await realpath(join(profile, '.claude', 'codex-runs', 'GraphGoblin',
  'runtime', 'node-v22.23.4-win-x64', 'node.exe'));
assert.equal(await realpath(process.execPath), projectNode);
assert.equal(process.version, 'v22.23.4');
const checkout = await realpath(resolve(checkoutArg));
const worktrees = await realpath(join(profile, '.codex', 'worktrees'));
assert.match(relative(worktrees, checkout), /^gg-[^\\/]+[\\/]GraphGoblin$/i);

const evidenceDir = join(suiteRoot, evidenceName);
const storeDir = join(evidenceDir, 'store');
const dbFile = join(storeDir, 'graphgoblin.db');
const sha = (body) => createHash('sha256').update(body).digest('hex');
const report = {
  phase, checkout, evidenceDir, runner: { pid: process.pid, exe: process.execPath, node: process.version },
  tier: 'compiled production routes and repository, instrumented Fastify over actual TCP, file SQLite',
  transport: {}, bindings: {}, cases: {}, positives: {}, history: {}, cleanup: {},
};
const runtime = {};
const fixtures = {};
const transport = createTransport();
const readBack = [];
let cleanupChild;
let app;
let container;
let failure;

function serialize(_key, value) {
  if (value instanceof Error) return { ...value, name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'bigint') return value.toString();
  return value;
}

async function save(file, value) {
  await writeFile(join(evidenceDir, file), JSON.stringify(value, serialize, 2) + '\n', { flag: 'wx' });
}

function assertBelowCheckout(file) {
  const below = relative(checkout, file).replaceAll('\\', '/');
  assert.ok(below && below !== '..' && !below.startsWith('../') && !below.includes(':'));
}

async function bind(name, declared) {
  const file = await realpath(declared);
  assertBelowCheckout(file);
  report.bindings[name] = { file, sha256: sha(await readFile(file)) };
}

async function bindRuntime() {
  const apiRoot = join(checkout, 'apps', 'api');
  for (const [name, built] of Object.entries({
    api: 'dist/index.js',
    routes: 'dist/routes/runs.js',
    history: 'dist/run-history.js',
    auth: 'dist/plugins/auth.js',
    errors: 'dist/plugins/errors.js',
    system: 'dist/routes/system.js',
  })) await bind(name, join(apiRoot, built));

  for (const [name, pkg, entry] of [
    ['contracts', 'contracts', '.'], ['domain', 'domain', '.'], ['testing', 'engine', './testing'],
  ]) {
    const root = join(checkout, 'packages', pkg);
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(metadata.name, '@graphgoblin/' + pkg);
    const target = metadata.exports[entry].import;
    assert.match(target, /^\.\/dist\/(?:[a-z-]+\/)*index\.js$/);
    await bind(name, join(root, target));
  }

  const requireFromApi = createRequire(join(apiRoot, 'package.json'));
  await bind('fastify', requireFromApi.resolve('fastify'));
  const zodProviderDir = await realpath(join(apiRoot, 'node_modules', 'fastify-type-provider-zod'));
  const providerPackage = JSON.parse(await readFile(join(zodProviderDir, 'package.json'), 'utf8'));
  assert.equal(providerPackage.name, 'fastify-type-provider-zod');
  const importTarget = providerPackage.exports.default.default;
  assert.equal(importTarget, './dist/esm/index.js');
  await bind('zodProvider', join(zodProviderDir, importTarget));
}

function shaWire(response) {
  return { status: response.status, contentType: response.contentType,
    bodyBase64: response.body.toString('base64'), bodySha256: sha(response.body) };
}

async function rawHistory(id) {
  const sql = container.handle.client;
  const run = await sql.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [id] });
  const events = await sql.execute({
    sql: 'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq', args: [id],
  });
  assert.equal(run.rows.length, 1);
  return sha(JSON.stringify({ run: run.rows.map((row) => ({ ...row })),
    events: events.rows.map((row) => ({ ...row })) }, serialize));
}

async function bootstrap() {
  const { loadConfig, createContainer } = runtime.api;
  const { FakeClock, FakeIds, CapturingLogger, singleNodeLoop } = runtime.testing;
  const config = loadConfig({
    GG_DATA_DIR: storeDir,
    GG_DB_URL: pathToFileURL(dbFile).href,
    GG_HOST: '127.0.0.1',
    GG_PORT: '0',
    GG_REQUIRE_API_KEY: 'true',
    GG_SWAGGER_UI: 'false',
    GG_OLLAMA_ENABLED: 'false',
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
  });
  const byDesignUnused = async () => { throw new Error('Unexpected provider or script access in #419 fixture'); };
  container = await createContainer(config, {
    clock: new FakeClock(), ids: new FakeIds(), logger: new CapturingLogger(),
    startTimers: false, masterKey: Buffer.alloc(32, 19),
    harnesses: {}, deciders: [], structured: { complete: byDesignUnused },
    scripts: { run: byDesignUnused }, probes: { fetch: byDesignUnused },
    storageCapacity: { read: async () => ({ totalBytes: 100 * 1024 ** 3, availableBytes: 50 * 1024 ** 3 }) },
  });
  await container.start();
  report.storeOwnership = [];
  for (const name of ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock']) {
    const file = join(storeDir, name);
    const { pid, startedAt, windowsCreationTime } = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(pid, process.pid);
    assert.match(windowsCreationTime, /^[1-9][0-9]{16,18}$/);
    report.storeOwnership.push({ file, pid, startedAt, windowsCreationTime });
  }
  const { loops, runs, events, apiKeys } = container.repos;
  const definition = runtime.contracts.LoopDefinitionSchema.parse(singleNodeLoop('QA 419 replay control', {
    id: 'work', kind: 'mutate', label: 'Fixture visit',
    config: { operations: [{ op: 'set', path: '/vars/authored', value: { kind: 'literal', value: true } }] },
  }));
  const { loop } = await loops.create('local', definition);
  await loops.publish(loop.id);

  for (const name of ['cold', 'checked', 'bad-event', 'bad-checkpoint']) {
    const run = await container.manager.startRun({
      loopId: loop.id, ownerId: 'local', source: 'manual.api', payload: { fixture: name },
    });
    await container.manager.waitForIdle();
    assert.equal((await runs.get(run.id)).status, 'succeeded');
    const original = await events.read(run.id);
    const seed = await runs.getInitialThread(run.id);
    assert.ok(seed);
    const drafts = [];
    for (let i = 1; i <= 350; i += 1) {
      drafts.push(
        { type: 'node.started', nodeId: 'work', kind: 'mutate', attempt: i, configHash: 'a'.repeat(64) },
        { type: 'node.finished', nodeId: 'work', durationMs: 0,
          patch: [{ op: 'add', path: '/vars/count', value: i }] },
      );
    }
    for (let offset = 0; offset < drafts.length; offset += 140)
      await events.append(run.id, drafts.slice(offset, offset + 140));
    const history = await events.read(run.id);
    const tail = history.at(-1).seq;
    assert.equal(tail, original.length + drafts.length);
    const target = tail - 17;
    const fixture = { id: run.id, seed, history, tail, target, name };
    if (name === 'checked' || name === 'bad-checkpoint') {
      const cp = original.length + 181; // Checkpoint carries the state of an open synthetic visit.
      const state = runtime.domain.replayStateAt(history, cp);
      assert.equal(state.openNodeId, 'work');
      await runs.saveThread(run.id, expected(fixture, cp), cp, state);
      assert.equal((await runs.getThreadCheckpoint(run.id)).seq, cp);
      fixture.checkpoint = cp;
    } else {
      const result = await container.handle.client.execute({
        sql: 'UPDATE runs SET thread_snapshot = NULL, thread_snapshot_seq = NULL, thread_snapshot_replay_state = NULL WHERE id = ?',
        args: [run.id],
      });
      assert.equal(result.rowsAffected, 1);
      assert.equal(await runs.getThreadCheckpoint(run.id), undefined);
    }
    if (name === 'bad-event') {
      fixture.damage = original.length + 190;
      const result = await container.handle.client.execute({
        sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = ?',
        args: ['{qa419-invalid-json', run.id, fixture.damage],
      });
      assert.equal(result.rowsAffected, 1);
    }
    if (name === 'bad-checkpoint') {
      const result = await container.handle.client.execute({
        sql: 'UPDATE runs SET thread_snapshot = ? WHERE id = ?',
        args: ['{qa419-invalid-json', run.id],
      });
      assert.equal(result.rowsAffected, 1);
    }
    fixtures[name] = fixture;
    report.history[name] = { id: run.id, tail, target, checkpoint: fixture.checkpoint,
      damagedEvent: fixture.damage, beforeReadSha256: await rawHistory(run.id) };
  }
  return {
    local: (await apiKeys.create('local', 'QA 419 reader', ['runs:read'])).token,
    other: (await apiKeys.create('other', 'QA 419 other owner', ['runs:read'])).token,
    wrong: (await apiKeys.create('local', 'QA 419 wrong scope', ['loops:read'])).token,
  };
}

function expected(fixture, at) {
  return runtime.contracts.ContextThreadSchema.parse(
    runtime.domain.reconcileThread(fixture.seed, fixture.history, undefined, at),
  );
}

function path(fixture, query = '') {
  return '/runs/' + fixture.id + '/thread' + query;
}

function register(name, plan) {
  const control = transport.monitor(name, plan);
  const record = {};
  report.cases[name] = record;
  readBack.push({ control, record });
  return { control, record };
}

function completed(control) {
  const listenerSnapshot = control.listeners.find((entry) => entry.at === 'handler-settled');
  assert.ok(listenerSnapshot, 'missing production route handler settlement');
  assert.deepEqual(listenerSnapshot.observed.filter((entry) => entry.added !== 0), []);
  assert.equal(control.active.size, 0);
}

function pagePlan(fixture, at) {
  const calls = [];
  let after = 0;
  if (fixture.checkpoint && fixture.checkpoint <= at) {
    calls.push([fixture.id, fixture.checkpoint - 1, 1]);
    after = fixture.checkpoint;
  }
  while (after < at) {
    const limit = Math.min(128, at - after);
    calls.push([fixture.id, after, limit]);
    const seen = Math.min(limit, fixture.tail - after);
    if (seen === 0) break;
    after += seen;
  }
  return calls;
}

function reads(control) {
  return control.operations.filter((op) => op.stage === 'boundary' || op.stage.startsWith('page-'));
}

async function exchange(request, label, ms = 5000) {
  try {
    const response = await bounded(label, request.response, ms);
    assert.equal(response.error, undefined, label + ': ' + response.error?.message);
    return response;
  } finally {
    request.destroy();
    await bounded(label + ' client socket close', request.socketClosed);
  }
}

async function positive(name, fixture, token, at, baseline, plan = {}) {
  const { control, record } = register(name, { ...plan, checkpoint: fixture.checkpoint });
  const response = await exchange(transport.connect(
    path(fixture, at === undefined ? '' : '?at=' + at), token, control,
  ), name);
  record.response = shaWire(response);
  assert.equal(response.status, 200);
  assert.match(response.contentType, /^application\/json/);
  assert.deepEqual(JSON.parse(response.body), expected(fixture, at));
  const wire = record.response;
  if (baseline) assert.deepEqual(wire, baseline.positives[name], 'HTTP body drift: ' + name);
  report.positives[name] = wire;
  await bounded(name + ' handler exit', control.handlerSettled.promise);
  completed(control);
  noteConnected(control, at === undefined);
  if (plan.drainInput) {
    const events = control.trace.map((entry) => entry.event);
    assert.ok(events.indexOf('input-end') < events.indexOf('product-handler-entry'));
    assert.equal(control.trace.find((entry) => entry.event === 'input-end').responseFinished, false);
  }
  if (at !== undefined) assert.deepEqual(reads(control).map((op) => op.args), pagePlan(fixture, at));
}

function noteConnected(control, current) {
  assert.ok(control.trace.some((entry) => entry.event === 'response-finish'));
  assert.deepEqual(control.writes, []);
  assert.deepEqual(control.onSendAfterClose, []);
  if (current) assert.deepEqual(control.operations.map((operation) => operation.stage), ['ownership', 'current']);
}

async function negative(name, fixture, query, token, status, code, plan = {}) {
  const { control, record } = register(name, { ...plan, checkpoint: fixture.checkpoint });
  const response = await exchange(transport.connect(path(fixture, query), token, control), name);
  record.response = shaWire(response);
  assert.equal(response.status, status);
  assert.match(response.contentType, /^application\/problem\+json/);
  const problem = JSON.parse(response.body);
  assert.equal(problem.code, code);
  assert.equal(problem.status, status);
  assert.doesNotMatch(response.body.toString('utf8'), /qa419-invalid-json|qa419-synthetic-repository-error/);
  if (plan.expectStages) assert.deepEqual(control.operations.map((operation) => operation.stage), plan.expectStages);
  if (plan.expectStages?.length === 0)
    assert.ok(!control.trace.some((entry) => entry.event === 'product-handler-entry'));
  if (control.trace.some((entry) => entry.event === 'handler-entry')) {
    await bounded(name + ' handler exit', control.handlerSettled.promise);
    completed(control);
  }
  if (plan.rejectAt) assert.ok(transport.receipt(control).logs.some((line) =>
    line.msg === 'unhandled error' && line.error?.message === 'qa419-synthetic-repository-error'));
  assert.ok(control.trace.some((entry) => entry.event === 'response-finish'));
}

async function unrelated(token) {
  const health = await exchange(transport.connect('/healthz'), 'held-replay health', 3000);
  assert.equal(health.status, 200);
  assert.equal(health.serverPid, String(process.pid));
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
  const unaffected = fixtures.checked;
  const current = await exchange(transport.connect(path(unaffected), token), 'held-replay genuine current read');
  assert.equal(current.status, 200);
  assert.deepEqual(JSON.parse(current.body), expected(unaffected));
  return { healthMs: health.elapsedMs, currentReadMs: current.elapsedMs };
}

async function disconnect(name, stage, fixture, token, rejectAt) {
  const { control, record } = register(name, { stage, rejectAt, checkpoint: fixture.checkpoint });
  const requested = transport.connect(path(fixture, '?at=' + fixture.target), token, control);
  const restoreYield = stage === 'yield-1' ? transport.installYieldBarrier() : undefined;
  try {
    await bounded(name + ' barrier', Promise.race([
      control.reached.promise,
      control.handlerSettled.promise.then(() => {
        if (control.barrier === undefined)
          throw new Error(name + ' fixture barrier was unreachable for this build');
      }),
    ]));
    assert.equal(control.barrier, stage);
    assert.equal(control.closeFlags, undefined);
    if (stage === 'page-2') record.responsiveness = await unrelated(token);
    requested.destroy();
    const close = await bounded(name + ' server-observed unfinished response close', control.closed.promise);
    assert.equal(close.responseFinished, false);
    assert.equal(close.socketDestroyed, true);
    assert.deepEqual(close.active, ['before-handler', 'yield-1'].includes(stage) ? [] : [stage]);
    await bounded(name + ' client socket close', requested.socketClosed);
    record.client = await bounded(name + ' client outcome', requested.response);
    assert.ok(record.client.error);
    control.release.resolve('transport close observed');
    await bounded(name + ' handler settlement', control.handlerSettled.promise);
    await setImmediate();
    completed(control);
    const observed = control.operations.filter((op) => op.afterClose);
    const allStages = ['ownership', 'initial', 'checkpoint',
      ...(fixture.checkpoint ? ['boundary'] : []),
      ...pagePlan(fixture, fixture.target).filter((call) =>
        !(fixture.checkpoint && call[1] === fixture.checkpoint - 1 && call[2] === 1))
        .map((_call, index) => 'page-' + (index + 1))];
    const stopped = stage === 'before-handler' ? []
      : allStages.slice(0, allStages.indexOf(stage === 'yield-1' ? 'page-1' : stage) + 1);
    assert.ok(stopped.length > 0 || stage === 'before-handler');
    const expectedStages = phase === 'baseline' && !rejectAt ? allStages : stopped;
    assert.deepEqual(control.operations.map((op) => op.stage), expectedStages);
    assert.deepEqual(reads(control).map((op) => op.args),
      pagePlan(fixture, fixture.target).slice(0, reads(control).length));
    if (phase === 'candidate') {
      assert.deepEqual(observed, [], 'a new repository call followed the actual response close');
      assert.deepEqual(control.writes, []);
      assert.deepEqual(control.onSendAfterClose, []);
      assert.ok(!transport.receipt(control).logs.some((line) =>
        line.statusCode === 500 || (line.level >= 50 && line.msg === 'unhandled error')));
    } else if (!rejectAt) {
      assert.ok(observed.some((op) => op.stage.startsWith('page-')), 'baseline must witness extra pages');
    }
    const seq = (event) => control.trace.find((entry) => entry.event === event).step;
    if (stage === 'yield-1') {
      assert.ok(seq('replay-yield-scheduled') < seq('replay-yield-callback'));
      assert.ok(seq('replay-yield-callback') < seq('barrier-entered'));
    }
    assert.ok(seq('barrier-entered') < seq('client-destroy') && seq('client-destroy') < seq('response-close'));
    assert.ok(seq('response-close') < seq('barrier-released') && seq('barrier-released') < seq('handler-settled'));
  } finally {
    restoreYield?.();
    control.release.resolve('fixture cleanup');
    if (!control.closeFlags) requested.destroy();
  }
}

async function runMatrix(tokens, baseline) {
  const { cold, checked } = fixtures;
  const badEvent = fixtures['bad-event'];
  const badCheckpoint = fixtures['bad-checkpoint'];
  for (const [name, stage, fixture, rejectAt] of [
    ['closed-before-handler', 'before-handler', cold],
    ['closed-during-owner', 'ownership', cold],
    ['closed-during-initial', 'initial', cold],
    ['closed-during-checkpoint', 'checkpoint', checked],
    ['closed-during-boundary', 'boundary', checked],
    ['closed-during-page', 'page-2', cold],
    ['closed-at-yield', 'yield-1', cold],
    ['closed-page-rejects', 'page-2', cold, 'page-2'],
  ]) await disconnect(name, stage, fixture, tokens.local, rejectAt);

  for (const [name, fixture, at, plan] of [
    ['historical-seed', cold, 0],
    ['historical-first-event', cold, 1],
    ['historical-two-pages', cold, 129],
    ['historical-cold', cold, cold.target],
    ['historical-completed-input', cold, cold.target, { drainInput: true }],
    ['historical-checkpoint', checked, checked.target],
    ['historical-before-checkpoint', checked, checked.checkpoint - 1],
    ['historical-past-tail', cold, cold.tail + 33],
    ['historical-before-bad-event', badEvent, badEvent.damage - 1],
    ['historical-before-bad-checkpoint', badCheckpoint, badCheckpoint.checkpoint - 1],
    ['current', checked, undefined],
  ]) await positive(name, fixture, tokens.local, at, baseline, plan);

  assert.deepEqual(report.positives['historical-cold'], report.positives['historical-completed-input']);
  const noStage = { expectStages: [] };
  const none = ['owner-key-missing', cold, '?at=0', undefined, 401, 'UNAUTHORIZED', noStage];
  for (const input of [
    none,
    ['wrong-scope', cold, '?at=0', tokens.wrong, 403, 'FORBIDDEN', noStage],
    ['other-owner', cold, '?at=0', tokens.other, 404, 'RUN_NOT_FOUND', { expectStages: ['ownership'] }],
    ['missing-run', { id: '00000000000000000000000000' }, '?at=0', tokens.local, 404, 'RUN_NOT_FOUND',
      { expectStages: ['ownership'] }],
    ['negative-query', cold, '?at=-1', tokens.local, 400, 'VALIDATION_FAILED', noStage],
    ['unsafe-query', cold, '?at=9007199254740992', tokens.local, 400, 'VALIDATION_FAILED', noStage],
    ['extra-query', cold, '?at=4&unexpected=1', tokens.local, 400, 'VALIDATION_FAILED', noStage],
    ['corrupt-event', badEvent, '?at=' + badEvent.damage, tokens.local, 500, 'STORED_EVENT_INVALID'],
    ['corrupt-checkpoint', badCheckpoint, '?at=' + badCheckpoint.checkpoint, tokens.local, 500, 'STORED_RUN_INVALID'],
    ['connected-generic-error', cold, '?at=129', tokens.local, 500, 'INTERNAL_ERROR',
      { rejectAt: 'page-1', expectStages: ['ownership', 'initial', 'checkpoint', 'page-1'] }],
  ]) await negative(...input);

  for (const fixture of Object.values(fixtures)) {
    const entry = report.history[fixture.name];
    entry.afterReadSha256 = await rawHistory(fixture.id);
    assert.equal(entry.afterReadSha256, entry.beforeReadSha256);
  }
}

await mkdir(evidenceDir);
assert.equal(await realpath(evidenceDir), evidenceDir);
await mkdir(storeDir);
assert.equal(await realpath(storeDir), storeDir);
const watchdog = setTimeout(() => {
  transport.releaseAll();
  if (cleanupChild && cleanupChild.exitCode === null && cleanupChild.signalCode === null) cleanupChild.kill();
  process.stderr.write('QA #419 watchdog expired. Keep the incomplete owned store and evidence.\n');
  process.exit(124);
}, 115_000);
try {
  await bindRuntime();
  await save('runner.json', report);
  let baseline;
  if (baselineName) {
    const baselineDir = join(suiteRoot, baselineName);
    assert.equal(await realpath(baselineDir), baselineDir);
    baseline = JSON.parse(await readFile(join(baselineDir, 'summary.json'), 'utf8'));
    assert.equal(baseline.phase, 'baseline');
    assert.equal(baseline.result, 'assertions-met');
    assert.equal(baseline.cleanup.empty, true);
    report.baseline = { directory: baselineDir, bindings: baseline.bindings };
  }
  for (const [name, binding] of Object.entries(report.bindings))
    runtime[name] = await import(pathToFileURL(binding.file).href);
  const tokens = await bootstrap();
  app = runtime.fastify.default({
    logger: { level: 'trace', stream: { write: transport.recordLog } },
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: false,
  });
  app.setValidatorCompiler(runtime.zodProvider.validatorCompiler);
  app.setSerializerCompiler(runtime.zodProvider.serializerCompiler);
  transport.attach(app);
  const composed = transport.instrument(container);
  runtime.errors.registerErrorHandler(app);
  runtime.auth.registerAuth(app, composed);
  runtime.system.registerSystemRoutes(app, composed);
  runtime.routes.registerRunRoutes(app, composed);
  app.addHook('onListen', (done) => { container.historyCleanup.afterListen(); done(); });
  await bounded('actual Fastify loopback listen', app.listen({ host: '127.0.0.1', port: 0 }));
  const address = app.server.address();
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0 && ![4747, 4748].includes(address.port));
  report.transport = { bound: address, ownsOnlyThisListener: true };
  transport.setPort(address.port);
  await runMatrix(tokens, baseline);
} catch (error) {
  failure = error;
  report.error = error;
} finally {
  transport.releaseAll();
  transport.destroyOwnedServerSockets();
  for (const [label, close] of [
    ['fastify', app ? () => app.close() : undefined],
    ['container', container ? () => container.dispose() : undefined],
  ]) {
    if (!close) continue;
    if (label === 'container' && app && report.cleanup.fastify !== 'closed') {
      report.cleanup.container = 'retained for unresolved HTTP cleanup';
      continue;
    }
    try {
      await bounded('owned ' + label + ' cleanup', close(), 10_000);
      report.cleanup[label] = 'closed';
    } catch (cleanupError) {
      report.cleanup[label] = cleanupError;
      failure ??= cleanupError;
    }
  }
  await setImmediate();
  for (const { record, control } of readBack) Object.assign(record, transport.receipt(control));
  report.cleanup.sockets = transport.activeSockets();
  report.cleanup.remainingListener = app?.server.address() ?? null;
  try {
    assert.deepEqual(report.cleanup.sockets, { clients: 0, server: 0 });
    assert.equal(report.cleanup.remainingListener, null);
    if (!failure) {
      assert.equal(report.cleanup.fastify, 'closed');
      assert.equal(report.cleanup.container, 'closed');
      if (phase === 'candidate')
        for (const { control, record } of readBack.filter(({ control }) => control.plan.stage)) {
          assert.deepEqual(record.writesAfterClose, [], control.name);
          assert.deepEqual(record.attemptedSendsAfterClose, [], control.name);
          assert.ok(!record.logs.some((line) => line.statusCode === 500 ||
            (line.level >= 50 && line.msg === 'unhandled error')), control.name);
        }
      await cleanOwnedStore(evidenceDir, storeDir, report.cleanup, (child) => { cleanupChild = child; });
    }
    report.cleanup.remainingStoreFiles = await readdir(storeDir);
  } catch (cleanupError) {
    report.cleanup.error = cleanupError;
    failure ??= cleanupError;
  }
  report.result = failure ? 'incomplete' : 'assertions-met';
  await save('summary.json', report);
  if (failure) process.exitCode = 1;
  if (!cleanupChild && (!app || report.cleanup.fastify === 'closed') &&
      (!container || report.cleanup.container === 'closed')) clearTimeout(watchdog);
}
