import process from 'node:process';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, unlink, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { singleNodeLoop } from '@graphgoblin/engine/testing';

const { fetch } = globalThis;
const fixture = new URL('./missing-session.fixture.mjs', import.meta.url);
async function until(check) {
  const deadline = Date.now() + 60000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'Disposable API state deadline');
    await delay(50);
  }
}
function message(child, wanted) {
  return new Promise((resolve, reject) => {
    const receive = (value) => {
      if (value.type === wanted) {
        child.off('message', receive);
        child.off('exit', exited);
        resolve(value);
      }
    };
    const exited = () => {
      child.off('message', receive);
      reject(new Error(`Process exited before ${wanted}`));
    };
    child.on('message', receive);
    child.once('exit', exited);
  });
}
for (const family of ['codex', 'claude'])
  for (const policy of ['resume-previous', 'resume-own'])
    test(
      `${family} ${policy}: removed on-disk session, declined restart, choice-commit crash, recovered fresh`,
      { timeout: 240000 },
      async () => {
        const dataDir = await mkdtemp(
          join(tmpdir(), process.env.GG_TEST_DATA_PREFIX ?? 'gg-wp-f4-265-'),
        );
        const port = Number(process.env.GG_265_RESTART_PORT ?? 5992);
        assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
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
          WP_265_HARNESS: family,
        });
        const children = [];
        function start() {
          const child = spawn(process.execPath, [fileURLToPath(fixture)], {
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          });
          children.push(child);
          child.stdout.resume();
          child.stderr.resume();
          return child;
        }
        async function stop(child) {
          if (child.exitCode !== null) return;
          const closed = once(child, 'close');
          child.send({ type: 'stop' });
          await closed;
        }
        async function api(path, body, expected = 200) {
          const response = await fetch(
            `http://127.0.0.1:${port}${path}`,
            body === undefined
              ? {}
              : {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(body),
                },
          );
          const responseBody = await response.json();
          assert.equal(response.status, expected, path + ': ' + JSON.stringify(responseBody));
          return responseBody;
        }
        try {
          let child = start();
          await message(child, 'ready');
          const def = singleNodeLoop('missing disk session', {
            id: 'worker',
            kind: 'inference',
            label: 'Worker',
            config: {
              harness: family,
              model: family === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
              effort: 'low',
              session: { policy },
              harnessOptions: { sandbox: 'read-only', approval: 'never' },
              prompt: { template: 'Original selected task' },
            },
          });
          def.nodes.push(
            {
              id: 'warm',
              kind: 'inference',
              label: 'Warm',
              config: {
                ...def.nodes[1].config,
                session: { policy: 'fresh' },
                prompt: { template: 'Earlier context' },
              },
            },
            {
              id: 'hold',
              kind: 'wait',
              label: 'Hold',
              config: {
                mode: 'input',
                prompt: 'Continue after removing the disposable provider session.',
                exposeTo: ['api'],
              },
            },
          );
          def.edges[0] = { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'warm' } };
          def.edges.push(
            { id: 'warm-hold', from: { node: 'warm', port: 'out' }, to: { node: 'hold' } },
            { id: 'hold-worker', from: { node: 'hold', port: 'out' }, to: { node: 'worker' } },
          );
          if (policy === 'resume-own') {
            def.nodes = def.nodes.filter((node) => node.id !== 'warm');
            def.nodes.push({
              id: 'again',
              kind: 'decision',
              label: 'Again',
              config: {
                kind: 'expression',
                jsonata: '"repeat"',
                maxPasses: 2,
                routes: [
                  { id: 'repeat', label: 'Repeat', repeat: true },
                  { id: 'finish', label: 'Finish' },
                ],
              },
            });
            def.edges = [
              { id: 'start-worker', from: { node: 'start', port: 'out' }, to: { node: 'worker' } },
              { id: 'worker-gate', from: { node: 'worker', port: 'out' }, to: { node: 'again' } },
              { id: 'gate-hold', from: { node: 'again', port: 'repeat' }, to: { node: 'hold' } },
              { id: 'hold-worker', from: { node: 'hold', port: 'out' }, to: { node: 'worker' } },
              { id: 'limit', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
              { id: 'finish', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
            ];
          }
          const created = await api('/loops', { definition: def }, 201);
          await api(`/loops/${created.loop.id}/publish`, {});
          const { run } = await api(`/loops/${created.loop.id}/runs`, {}, 202);
          await until(async () => (await api(`/runs/${run.id}`)).status === 'waiting');
          const waiting = await api(`/runs/${run.id}`);
          const sessions = await api(`/runs/${run.id}/sessions`);
          const old = sessions.items[0].sessionId;
          assert.match(old, /^[a-f0-9-]+$/);
          await unlink(join(dataDir, 'provider-sessions', old));
          await api(`/runs/${run.id}/input`, { waitId: waiting.waiting.waitId, input: 'continue' });
          await until(async () => (await api(`/runs/${run.id}`)).status === 'failed');
          const failed = await api(`/runs/${run.id}`);
          assert.equal(failed.failure.code, 'HARNESS_SESSION_MISSING');
          assert.ok(failed.failure.message.includes(old));
          await stop(child);
          child = start();
          await message(child, 'ready');
          assert.deepEqual((await api(`/runs/${run.id}`)).failure, failed.failure);
          const reviewed = await api(`/runs/${run.id}`);
          await api(`/runs/${run.id}/resume`, { observedSeq: reviewed.recovery.observedSeq }, 409);
          let events = (await api(`/runs/${run.id}/events`)).items;
          const failureSeq = events.findLast((event) => event.type === 'run.failed').seq;
          const armed = message(child, 'armed');
          child.send({ type: 'arm-choice-crash', runId: run.id });
          await armed;
          const closed = once(child, 'close');
          await api(`/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq }).then(
            () => assert.fail('Expected connection closure at committed intent'),
            () => {},
          );
          await closed;
          child = start();
          await message(child, 'ready');
          await until(async () => (await api(`/runs/${run.id}`)).status === 'succeeded');
          events = (await api(`/runs/${run.id}/events`)).items;
          const choices = events.filter((event) => event.type === 'run.resumed');
          assert.equal(choices.length, 1);
          assert.equal(choices[0].freshSession.priorContextCarried, false);
          assert.equal(choices[0].freshSession.sessionId, old);
          assert.equal(choices[0].freshSession.nodeId, 'worker');
          assert.equal(choices[0].actor.id, 'local');
          assert.ok(choices[0].ts);
          await api(`/runs/${run.id}/recover-session`, { nodeId: 'worker', failureSeq }, 409);
          const calls = (await readFile(join(dataDir, 'provider-calls.jsonl'), 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          assert.deepEqual(
            calls.map((call) => call.mode),
            ['fresh', 'resume', 'fresh'],
          );
          assert.equal(calls[2].prompt, 'Original selected task');
          assert.equal(calls[2].model, failed.failure.missingSession.model);
          assert.equal(calls[2].effort, failed.failure.missingSession.effort);
          assert.notEqual(calls[2].id, old);
          const evidence = new URL('../../../docs/qa/2026-10-24-wp-f4-265/', import.meta.url);
          await copyFile(
            join(dataDir, 'provider-calls.jsonl'),
            new URL(`restart-calls-${family}-${policy}.jsonl`, evidence),
          );
          await writeFile(
            new URL(`restart-events-${family}-${policy}.json`, evidence),
            JSON.stringify(events),
          );
        } finally {
          for (const child of children) await stop(child);
          // Keep this exclusively created temp store for orchestrator inspection; no directory deletion.
        }
      },
    );
