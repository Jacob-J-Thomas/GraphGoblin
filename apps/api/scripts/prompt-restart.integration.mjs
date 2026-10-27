import process from 'node:process';
import { Buffer } from 'node:buffer';
import { log, error as reportError } from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { singleNodeLoop } from '@graphgoblin/engine/testing';

const { fetch } = globalThis;

const fixture = fileURLToPath(new URL('./prompt-restart.fixture.mjs', import.meta.url));
const portBase = Number(process.env.GG_PROMPT_RESTART_PORT_BASE ?? 5660);
assert.ok(Number.isInteger(portBase) && portBase > 0 && portBase <= 65526);
const dataPrefix = process.env.GG_PROMPT_RESTART_DATA_PREFIX ?? 'gg-wp-f4-restart-';
assert.match(dataPrefix, /^gg-[a-z0-9-]+-$/);
async function freePort() {
  for (let port = portBase; port < portBase + 10; port++) {
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`No disposable port in ${portBase}-${portBase + 9}`);
}
async function eventually(check) {
  const until = Date.now() + 60000;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('Disposable API state deadline under load');
    await delay(25);
  }
}
function message(child, type) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exited);
    };
    const receive = (value) => {
      if (value.type === type) {
        cleanup();
        resolve(value);
      }
    };
    const exited = (code) => {
      cleanup();
      reject(new Error(`Fixture exited before ${type}: ${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`IPC deadline for ${type}`));
    }, 60000);
    child.on('message', receive);
    child.once('exit', exited);
  });
}

async function withApiFixture(task) {
  const dataDir = await mkdtemp(join(tmpdir(), dataPrefix));
  const children = new Map();
  const kill = async (child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await children.get(child);
  };
  try {
    const port = await freePort();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith('GG_') && key !== 'NODE_V8_COVERAGE',
      ),
    );
    Object.assign(env, {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_WEB_DIST: '',
      GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const start = (hold) => {
      const child = spawn(process.execPath, [fixture], {
        env: { ...env, WP_F4_HOLD: hold },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const closed = once(child, 'close');
      closed.catch(() => undefined);
      children.set(child, closed);
      child.stdout.resume();
      let output = '';
      child.stderr.on('data', (chunk) => {
        output = (output + chunk).slice(-8192);
      });
      child.on('exit', (code) => {
        if (code) reportError(output);
      });
      return child;
    };
    const origin = `http://127.0.0.1:${port}`;
    const api = async (path, body, status) => {
      const response = await fetch(
        origin + path,
        body === undefined
          ? undefined
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      if (status !== undefined) assert.equal(response.status, status, path);
      else assert.equal(response.ok, true, `${path}: ${response.status}`);
      return response.json();
    };
    const inspect = async (child) => {
      const received = message(child, 'calls');
      child.send({ type: 'inspect' });
      return received;
    };
    await task({ dataDir, port, start, kill, api, inspect });
  } finally {
    try {
      for (const child of children.keys()) await kill(child);
    } finally {
      // Only this exclusively created disposable store may be removed. Never follow an arbitrary path.
      const target = resolve(dataDir);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith(dataPrefix));
      if (process.env.GG_PROMPT_RESTART_KEEP_DATA === '1')
        log(JSON.stringify({ retainedStore: basename(target) }));
      else await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

test(
  'a real kill of the built API continues accepted work from durable visit evidence',
  { timeout: 180000 },
  () =>
    withApiFixture(async ({ dataDir, port, start, kill, api, inspect }) => {
      let child = start('1');
      await message(child, 'ready');
      const created = await api('/loops', {
        definition: singleNodeLoop('prompt restart', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { prompt: { template: 'The complete synthetic authored task.' } },
        }),
      });
      const loopId = created.loop.id;
      await api(`/loops/${loopId}/publish`, {});
      const { run } = await api(`/loops/${loopId}/runs`, {});
      const runId = run.id;
      let before;
      await eventually(async () => {
        before = (await api(`/runs/${runId}/events`)).items;
        return before.some(
          (event) =>
            event.type === 'harness.submission' && event.submission === 'submitted' && event.marker,
        );
      });
      const original = before.find((event) => event.type === 'harness.turn');
      await kill(child);
      child = start('0');
      await message(child, 'ready');
      await eventually(async () => (await api(`/runs/${runId}`)).status === 'succeeded');
      const calls = await inspect(child);
      assert.equal(calls.started.length, 0);
      assert.equal(calls.resumed.length, 1);
      assert.equal(calls.resumed[0].sessionId, 'fake-session-1');
      assert.match(calls.resumed[0].request.turn.prompt, /previous turn was interrupted/);
      const turns = (await api(`/runs/${runId}/events`)).items.filter(
        (event) => event.type === 'harness.turn',
      );
      assert.equal(turns.length, 2);
      assert.equal(turns[1].visitId, original.visitId);
      assert.equal(turns[1].promptKind, 'continuation');
      log(
        JSON.stringify({
          dataDir,
          port,
          runId,
          visitId: original.visitId,
          recovered: 'same session, continuation only',
        }),
      );
    }),
);

for (const policy of ['resume-previous', 'resume-named']) {
  test(
    `a real restart blocks unaccepted authored work with only an inherited ${policy} handle`,
    { timeout: 180000 },
    () =>
      withApiFixture(async ({ dataDir, port, start, kill, api, inspect }) => {
        let child = start('unaccepted');
        await message(child, 'ready');
        const definition = singleNodeLoop('unaccepted restart-' + policy, {
          id: 'a',
          kind: 'inference',
          label: 'A',
          config: {
            prompt: { template: 'Task A' },
            session: { policy: 'resume-named', key: 'shared' },
          },
        });
        definition.nodes.splice(2, 0, {
          id: 'b',
          kind: 'inference',
          label: 'B',
          config: {
            prompt: { template: 'Task B' },
            session: policy === 'resume-named' ? { policy, key: 'shared' } : { policy },
          },
        });
        definition.edges[1].to.node = 'b';
        definition.edges.push({
          id: 'b-out',
          from: { node: 'b', port: 'out' },
          to: { node: 'done' },
        });
        const created = await api('/loops', { definition });
        const loopId = created.loop.id;
        await api(`/loops/${loopId}/publish`, {});
        const { run } = await api(`/loops/${loopId}/runs`, {});
        const runId = run.id;
        await eventually(async () =>
          (await api(`/runs/${runId}/events`)).items.some(
            (event) => event.type === 'harness.turn' && event.nodeId === 'b',
          ),
        );
        await kill(child);
        child = start('0');
        await message(child, 'ready');
        await eventually(async () => (await api(`/runs/${runId}`)).status === 'failed');
        const failed = await api(`/runs/${runId}`);
        assert.equal(failed.failure.code, 'HARNESS_DELIVERY_UNCERTAIN');
        assert.equal(failed.failure.resumable, false);
        const reviewed = await api(`/runs/${runId}`);
        await api(`/runs/${runId}/resume`, { observedSeq: reviewed.recovery.observedSeq }, 409);
        const calls = await inspect(child);
        assert.equal(calls.started.length + calls.resumed.length, 0);
        const thread = await api(`/runs/${runId}/thread`);
        assert.equal(thread.outputs.b, undefined);
        log(
          JSON.stringify({
            dataDir,
            port,
            runId,
            policy,
            recovered: 'blocked inherited conversation; no provider call',
          }),
        );
      }),
  );
}

for (const policy of ['resume-previous', 'resume-named']) {
  test(
    `a kill after Claude's result-only acceptance recovers ${policy} work`,
    { timeout: 180000 },
    () =>
      withApiFixture(async ({ dataDir, port, start, kill, api, inspect }) => {
        let child = start('claude-result');
        await message(child, 'ready');
        const config = {
          harness: 'claude',
          model: 'claude-opus-5-5',
          effort: 'low',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
        };
        const definition = singleNodeLoop('result-only restart-' + policy, {
          id: 'a',
          kind: 'inference',
          label: 'A',
          config: {
            ...config,
            prompt: { template: 'Task A' },
            session: { policy: 'resume-named', key: 'shared' },
          },
        });
        definition.nodes.splice(2, 0, {
          id: 'b',
          kind: 'inference',
          label: 'B',
          config: {
            ...config,
            prompt: { template: 'Task B' },
            session: policy === 'resume-named' ? { policy, key: 'shared' } : { policy },
          },
        });
        definition.edges[1].to.node = 'b';
        definition.edges.push({
          id: 'b-out',
          from: { node: 'b', port: 'out' },
          to: { node: 'done' },
        });
        const created = await api('/loops', { definition });
        await api(`/loops/${created.loop.id}/publish`, {});
        const held = message(child, 'claude.result.hold');
        const { run } = await api(`/loops/${created.loop.id}/runs`, {});
        await held;
        // Retain before-fix crash evidence too: if the marker never arrives, still kill/restart
        // and report D-022's resulting refusal before asserting this acceptance requirement.
        const until = Date.now() + 10000;
        let before, acceptance;
        do {
          before = (await api(`/runs/${run.id}/events`)).items;
          acceptance = before.find(
            (event) =>
              event.type === 'harness.submission' &&
              event.nodeId === 'b' &&
              event.marker === 'claude.result',
          );
          if (!acceptance) await delay(25);
        } while (!acceptance && Date.now() < until);
        assert.equal(
          before.some(
            (event) =>
              event.nodeId === 'b' && ['harness.usage', 'node.finished'].includes(event.type),
          ),
          false,
        );
        await kill(child);
        child = start('claude-recovery');
        await message(child, 'ready');
        await eventually(async () =>
          ['succeeded', 'failed'].includes((await api(`/runs/${run.id}`)).status),
        );
        const recovered = await api(`/runs/${run.id}`);
        const calls = await inspect(child);
        log(
          JSON.stringify({
            dataDir,
            port,
            runId: run.id,
            policy,
            acceptanceBeforeKill: !!acceptance,
            recovered: recovered.status,
            failure: recovered.failure,
            calls,
          }),
        );
        assert.equal(recovered.status, 'succeeded');
        assert.ok(acceptance, 'result acceptance must be durable before the process exits');
        assert.equal(acceptance.submission, 'submitted');
        assert.equal(calls.started.length, 0);
        assert.equal(calls.resumed.length, 1);
        assert.equal(calls.resumed[0].sessionId, '11111111-1111-4111-8111-111111111111');
        assert.match(calls.resumed[0].request.turn.prompt, /previous turn was interrupted/);
        const turns = (await api(`/runs/${run.id}/events`)).items.filter(
          (event) => event.type === 'harness.turn' && event.nodeId === 'b',
        );
        assert.equal(turns.length, 2);
        assert.equal(turns[1].visitId, acceptance.visitId);
        assert.equal(turns[1].promptKind, 'continuation');
      }),
  );
}

test(
  'a real restart preserves separate own handles across completed visits',
  { timeout: 180000 },
  () =>
    withApiFixture(async ({ start, kill, api, inspect }) => {
      let child = start('0');
      await message(child, 'ready');
      const definition = singleNodeLoop('own-session restart', {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: {
          session: { policy: 'resume-own', resetAfterVisits: 2 },
          prompt: {
            template:
              'Worker feedback {{ messages | where: "nodeId", "reviewer" | map: "content" | join: " " }}',
          },
        },
      });
      definition.nodes.push(
        {
          id: 'reviewer',
          kind: 'inference',
          label: 'Reviewer',
          config: { session: { policy: 'resume-own' }, prompt: { template: 'Reviewer' } },
        },
        { id: 'park', kind: 'wait', label: 'Park', config: { mode: 'input', prompt: 'Continue' } },
        {
          id: 'again',
          kind: 'decision',
          label: 'Again',
          config: {
            kind: 'expression',
            jsonata: '"repeat"',
            routes: [
              { id: 'repeat', label: 'Repeat', repeat: true },
              { id: 'finish', label: 'Finish' },
            ],
            maxPasses: 2,
          },
        },
      );
      definition.edges = definition.edges.filter((x) => x.from.node !== 'worker');
      definition.edges.push(
        { id: 'review', from: { node: 'worker', port: 'out' }, to: { node: 'reviewer' } },
        { id: 'park', from: { node: 'reviewer', port: 'out' }, to: { node: 'park' } },
        { id: 'gate', from: { node: 'park', port: 'out' }, to: { node: 'again' } },
        { id: 'repeat', from: { node: 'again', port: 'repeat' }, to: { node: 'worker' } },
        { id: 'finish', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
        { id: 'limit', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
      );
      const created = await api('/loops', { definition });
      await api(`/loops/${created.loop.id}/publish`, {});
      const { run } = await api(`/loops/${created.loop.id}/runs`, {});
      await eventually(async () => (await api(`/runs/${run.id}`)).status === 'waiting');
      const firstWait = (await api(`/runs/${run.id}`)).waiting.waitId;
      const first = (await api(`/runs/${run.id}/events`)).items.filter(
        (x) => x.type === 'harness.session',
      );
      assert.deepEqual(
        first.map((x) => [x.nodeId, x.sessionId, x.mode]),
        [
          ['worker', 'fake-session-1', 'fresh'],
          ['reviewer', 'fake-session-2', 'fresh'],
        ],
      );
      await kill(child);
      child = start('0');
      await message(child, 'ready');
      await api(`/runs/${run.id}/input`, { waitId: firstWait, input: null });
      await eventually(async () => {
        const state = await api(`/runs/${run.id}`);
        return state.status === 'waiting' && state.waiting.waitId !== firstWait;
      });
      const calls = await inspect(child);
      assert.equal(calls.started.length, 0);
      assert.deepEqual(
        calls.resumed.map((x) => x.sessionId),
        ['fake-session-1', 'fake-session-2'],
      );
      assert.match(calls.resumed[0].request.turn.prompt, /^Worker feedback OK$/);
      const secondWait = (await api(`/runs/${run.id}`)).waiting.waitId;
      await api(`/runs/${run.id}/input`, { waitId: secondWait, input: null });
      await eventually(async () => (await api(`/runs/${run.id}`)).status === 'succeeded');
      const sessions = (await api(`/runs/${run.id}/events`)).items.filter(
        (x) => x.type === 'harness.session',
      );
      assert.deepEqual(
        sessions.map((x) => [x.nodeId, x.sessionId, x.mode]),
        [
          ['worker', 'fake-session-1', 'fresh'],
          ['reviewer', 'fake-session-2', 'fresh'],
          ['worker', 'fake-session-1', 'resumed'],
          ['reviewer', 'fake-session-2', 'resumed'],
        ],
      );
      log(
        JSON.stringify({
          runId: run.id,
          recovered: 'own worker/reviewer handles, new process, authored feedback preserved',
        }),
      );
    }),
);
