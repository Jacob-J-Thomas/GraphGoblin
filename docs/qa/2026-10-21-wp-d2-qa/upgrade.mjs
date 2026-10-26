// Real base-build -> integrated-build crash/upgrade regression. Run before, then after the fix.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
const { fetch, AbortSignal } = globalThis;
const [requestedMode, baseExport] = process.argv.slice(2);
assert.ok(['before', 'after', 'verify'].includes(requestedMode));
const mode = requestedMode === 'before' ? 'before' : 'after';
const prepare = requestedMode !== 'after';
const workspace = process.cwd();
const evidence = join(workspace, 'docs/qa/2026-10-21-wp-d2-qa');
const manifest = join(tmpdir(), 'gg-qa-246-upgrade-manifest.json');
const fixture = prepare
  ? { root: await mkdtemp(join(tmpdir(), 'gg-qa-246-upgrade-')) }
  : JSON.parse(await readFile(manifest, 'utf8'));
assert.equal(dirname(fixture.root), resolve(tmpdir()));
assert.ok(basename(fixture.root).startsWith('gg-qa-246-upgrade-'));
let child;
let base;
let output = '';
let held = prepare;
let requests = 0;
let keep = false;
const receiver = createServer((req, res) => {
  req.resume();
  requests++;
  if (!held) res.writeHead(200).end('accepted');
});
async function listen(server, preferred) {
  for (const port of preferred ? [preferred] : Array.from({ length: 7 }, (_, i) => 5812 + i)) {
    try {
      await new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(port, '127.0.0.1', ok);
      });
      server.removeAllListeners('error');
      return port;
    } catch (error) {
      server.removeAllListeners('error');
      if (error.code !== 'EADDRINUSE' || preferred) throw error;
    }
  }
  throw Error('No disposable port available in 5812-5818');
}
async function until(check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw Error('Timed out: ' + output);
}
async function kill() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function boot(dataDir, archived = false) {
  output = '';
  const probe = createServer();
  const apiPort = await listen(probe);
  await new Promise((ok) => probe.close(ok));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GG_') && key !== 'NODE_V8_COVERAGE',
    ),
  );
  const root = archived ? baseExport : workspace;
  const args = archived
    ? ['--experimental-loader', pathToFileURL(join(evidence, 'base-loader.mjs')).href]
    : [];
  args.push(join(root, 'apps/api/dist/main.js'));
  child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: {
      ...env,
      GG_WP_D2_BASE_ROOT: baseExport,
      GG_WP_D2_CURRENT_ROOT: workspace,
      GG_DATA_DIR: dataDir,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(apiPort),
      GG_WEB_DIST: '',
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 17).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = undefined;
  const capture = (chunk) => {
    output += chunk;
    const address = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
    if (address) base = address[1];
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => {
    output += String(error);
  });
  await until(async () => {
    assert.equal(child.exitCode, null, output);
    if (!base) return false;
    return fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false,
    );
  });
}
async function request(path, body) {
  const response = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
function inspect(directory) {
  const source = `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(JSON.stringify({
      runs: db.prepare('SELECT * FROM runs ORDER BY id').all(),
      events: db.prepare('SELECT run_id,seq,ts,type,node_id,payload FROM run_events ORDER BY run_id,seq').all(),
      versions: db.prepare('SELECT * FROM loop_versions ORDER BY id').all()
    })); db.close();`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source, join(directory, 'graphgoblin.db')],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function publish(definition) {
  const { loop } = await request('/loops', { definition });
  await request('/loops/' + loop.id + '/publish', {});
  return loop.id;
}
const nodes = (middle, exit) => [
  { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
  middle,
  { id: 'done', kind: 'exit', label: 'Done', config: exit },
];
const edges = (middle) => [
  { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: middle } },
  { id: 'e2', from: { node: middle, port: 'out' }, to: { node: 'done' } },
];
try {
  fixture.receiverPort = await listen(receiver, fixture.receiverPort);
  if (prepare) {
    assert.ok(baseExport);
    const original = join(fixture.root, 'original');
    await mkdir(original);
    await boot(original, true);
    fixture.childLoopId = await publish({
      schemaVersion: 4,
      name: 'Pre-upgrade Event-return child',
      nodes: nodes(
        { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: '?' } },
        {
          returns: '"old-child-result"',
          destinations: [
            { kind: 'webhook', url: `http://127.0.0.1:${fixture.receiverPort}/hold-finalisation` },
            { kind: 'event', eventType: 'retired-child-return' },
            { kind: 'caller' },
            { kind: 'log' },
          ],
        },
      ),
      edges: edges('ask'),
    });
    const parentLoop = await publish({
      schemaVersion: 4,
      name: 'Pre-upgrade awaiting parent',
      nodes: nodes(
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: fixture.childLoopId } },
        },
        { returns: 'lastOutput.value' },
      ),
      edges: edges('sub'),
    });
    const started = await request('/loops/' + parentLoop + '/runs', {});
    fixture.parentId = started.run.id;
    const childRun = await until(async () => {
      const parent = await request('/runs/' + fixture.parentId);
      if (parent.waiting?.kind !== 'child') return false;
      const run = await request('/runs/' + parent.waiting.childRunId);
      return run.waiting?.kind === 'input' ? run : false;
    });
    fixture.childId = childRun.id;
    await request('/runs/' + childRun.id + '/input', {
      waitId: childRun.waiting.waitId,
      input: 'finish before upgrade',
    });
    await until(() => requests === 1);
    await kill();
    receiver.closeAllConnections();
    held = false;
    fixture.original = inspect(original);
    const row = fixture.original.runs.find((run) => run.id === fixture.childId);
    assert.equal(row.status, 'succeeded');
    assert.equal(row.finalized_at, null);
    assert.equal(
      fixture.original.runs.find((run) => run.id === fixture.parentId).status,
      'waiting',
    );
    assert.equal(
      fixture.original.events.filter(
        (event) => event.run_id === fixture.childId && event.type === 'run.finished',
      ).length,
      1,
    );
    assert.ok(!fixture.original.events.some((event) => event.type.startsWith('return.')));
  }
  const upgrade = join(fixture.root, mode);
  await cp(join(fixture.root, 'original'), upgrade, { recursive: true });
  await boot(upgrade);
  if (mode === 'before') {
    await until(() => output.includes('finalize failed'));
    await until(async () => (await request('/runs/' + fixture.parentId)).status === 'succeeded');
    await delay(300);
  } else {
    await until(
      async () =>
        (await request('/runs/' + fixture.childId)).deliveries?.[0]?.status === 'delivered',
    );
    await until(async () => (await request('/runs/' + fixture.parentId)).status === 'succeeded');
    await until(() => output.includes('retired Event return skipped'));
    await delay(300);
  }
  const childRun = await request('/runs/' + fixture.childId);
  const parentRun = await request('/runs/' + fixture.parentId);
  const childEvents = await request('/runs/' + fixture.childId + '/events');
  const parentEvents = await request('/runs/' + fixture.parentId + '/events');
  const logs = output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  await kill();
  const state = inspect(upgrade);
  assert.deepEqual(state.versions, fixture.original.versions);
  for (const old of fixture.original.events)
    assert.deepEqual(
      state.events.find((event) => event.run_id === old.run_id && event.seq === old.seq),
      old,
    );
  const childRow = state.runs.find((run) => run.id === fixture.childId);
  const notifications = parentEvents.items.filter((event) => event.type === 'child_run.finished');
  assert.equal(childRun.status, 'succeeded');
  assert.equal(childRun.result, 'old-child-result');
  assert.equal(parentRun.status, 'succeeded');
  assert.equal(parentRun.result.result, 'old-child-result');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].status, 'succeeded');
  assert.ok(!childEvents.items.some((event) => event.channel?.kind === 'event'));
  const diagnostics = logs.filter(
    (line) => line.msg === 'retired Event return skipped; loop upgrade required',
  );
  if (mode === 'before') {
    assert.equal(childRow.finalized_at, null);
    assert.ok(logs.some((line) => line.msg === 'finalize failed'));
    await writeFile(manifest, JSON.stringify(fixture));
    keep = true;
  } else {
    assert.ok(childRow.finalized_at);
    assert.deepEqual(
      childEvents.items
        .filter((event) => event.type === 'return.delivered')
        .map((event) => event.channel.kind)
        .sort(),
      ['caller', 'log'],
    );
    assert.ok(state.runs.find((run) => run.id === fixture.parentId).finalized_at);
    assert.ok(diagnostics.length > 0);
    for (const log of diagnostics) assert.equal(log.code, 'LOOP_UPGRADE_REQUIRED');
    assert.ok(
      diagnostics.every(
        (log) => log.runId === fixture.childId && log.loopId === fixture.childLoopId,
      ),
    );
    assert.ok(!logs.some((line) => line.msg === 'finalize failed'));
    const previousRequests = requests;
    await boot(upgrade);
    await delay(300);
    assert.ok(!output.includes('retired Event return skipped'));
    assert.ok(!output.includes('finalize failed'));
    await kill();
    assert.deepEqual(inspect(upgrade), state);
    assert.equal(requests, previousRequests);
  }

  const imported = state.events.filter(
    (e) =>
      e.type === 'delivery.attempt_finished' &&
      JSON.parse(e.payload).delivery.lastError?.code === 'interrupted',
  );
  assert.equal(imported.length, 1);
  assert.equal(JSON.parse(imported[0].payload).delivery.maxAttempts, 5);
  assert.equal(JSON.parse(imported[0].payload).delivery.attempts, 1);
  assert.equal(childRun.deliveries[0].maxAttempts, 5);
  assert.equal(childRun.deliveries[0].attempts, 2);
  assert.equal(childRun.deliveries[0].status, 'delivered');
  assert.equal(requests, 2); // old unknown request plus one resumed current-build request
  const summary = {
    evidenceProcedure:
      'Fresh archived old API store; independent execution of documented fixture with additional migration assertions',
    storeRoot: '%TEMP%/' + basename(fixture.root),
    originalState: fixture.original,
    migratedState: state,
    childApiEvents: childEvents,
    parentApiEvents: parentEvents,
    migrationImport: imported,
    receiverRequests: requests,
    apiLogs: logs,

    mode,
    sourceCommit: '52360d9',
    childId: fixture.childId,
    parentId: fixture.parentId,
    original: {
      childStatus: 'succeeded',
      childFinalized: false,
      parentStatus: 'waiting',
      heldWebhookRequests: 1,
    },
    child: childRun,
    parent: parentRun,
    finalizedAt: childRow.finalized_at,
    childFinishedNotifications: notifications.length,
    diagnostics,
    finalizeErrors: logs.filter((line) => line.msg === 'finalize failed'),
    originalEventsAndDefinitionsUnchanged: true,
    secondStartupUnchanged: mode === 'after',
  };
  await writeFile(
    join(evidence, requestedMode + '.json'),
    JSON.stringify(summary, null, 2)
      .replaceAll(workspace, '%WORKTREE%')
      .replaceAll(process.env.TEMP, '%TEMP%')
      .replaceAll(process.env.USERPROFILE, '%USERPROFILE%') + '\n',
  );
  console.log(
    JSON.stringify({
      mode,
      finalized: Boolean(childRow.finalized_at),
      parentStatus: parentRun.status,
      notifications: notifications.length,
      diagnostics: diagnostics.length,
      secondStartupUnchanged: mode === 'after',
    }),
  );
} finally {
  await kill();
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
  if (!keep) {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    await rm(manifest, { force: true });
    await writeFile(
      join(evidence, 'upgrade-cleanup.json'),
      JSON.stringify({ root: '%TEMP%/' + basename(fixture.root), removed: true }),
    );
  }
}
