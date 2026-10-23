function progress(value) {
  process.stdout.write(String(value) + '\n');
}
const { fetch } = globalThis;
import process from 'node:process';
// Public fault-boundary regression adapted from the D-029 round-4 audit.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { mkdtemp, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { pathToFileURL } from 'node:url';

import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();

const out =
  process.env.GG_WPF4_EVIDENCE_DIR ?? (await mkdtemp(join(tmpdir(), 'gg-wp-f4-evidence-')));
const port = Number(process.env.GG_WPF4_TEST_PORT ?? 5664);

const imp = (p) => import(pathToFileURL(join(root, p)).href);

const { createContainer } = await imp('apps/api/dist/container.js');

const { buildApp } = await imp('apps/api/dist/app.js');

const { loadConfig } = await imp('apps/api/dist/config.js');

const { FakeHarness, singleNodeLoop } = await import('@graphgoblin/engine/testing');

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const store = await mkdtemp(join(tmpdir(), 'gg-wp-f4-repair-'));

const active = new Map();

const harnesses = Object.fromEntries(
  ['codex', 'claude'].map((id) => [
    id,
    {
      id,
      preflight: () => new FakeHarness([], id).preflight(),

      start: (r, s) => active.get(id).start(r, s),

      resume: (id2, r, s) => active.get(id).resume(id2, r, s),
    },
  ]),
);

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_')),
);

Object.assign(env, {
  GG_DATA_DIR: store,
  GG_HOST: '127.0.0.1',
  GG_PORT: String(port),
  GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: '',
  GG_LOG_LEVEL: 'silent',
});

const c = await createContainer(loadConfig(env), { harnesses, startTimers: false });

let injection;

const originalEvents = c.ports.events;

c.ports.events = {
  append: async (id, drafts, options) => {
    const turn = drafts.find((d) => d.type === 'harness.turn' && d.promptKind === 'repair');

    if (turn && injection && !injection.fired) {
      injection.fired = true;
      injection.turn = turn;

      if (injection.afterCommit) await originalEvents.append(id, drafts, options);

      throw new Error(
        'Controlled event-store fault ' +
          (injection.afterCommit ? 'after' : 'before') +
          ' repair append',
      );
    }

    if (
      injection?.fired &&
      injection.writeDown &&
      drafts.some((d) => d.type === 'harness.turn' || d.type === 'harness.submission')
    ) {
      injection.writeFailures++;
      throw new Error('Continuing repair-log write outage');
    }

    return originalEvents.append(id, drafts, options);
  },
  read: (...a) => {
    if (injection?.fired && injection.readDown) {
      injection.readFailures++;
      if (injection.mode === 'read-once') injection.readDown = false;
      throw new Error('Controlled reconciliation read failure');
    }
    return originalEvents.read(...a);
  },
  subscribe: (...a) => originalEvents.subscribe(...a),
};

await c.start();

const app = await buildApp(c);

await app.listen({ host: '127.0.0.1', port });

const report = {
  head,
  store,
  port,
  tier: 'Built API and SQLite; public fake harnesses for both families; public event-store fault injection; no provider turns',
  checks: [],
};

async function api(path, body) {
  const response = await fetch(
    'http://127.0.0.1:' + port + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );

  return { status: response.status, value: await response.json() };
}

async function stopped(id) {
  const until = Date.now() + 60000;

  while (Date.now() < until) {
    const { value: r } = await api('/runs/' + id);
    if (['failed', 'succeeded', 'cancelled'].includes(r.status)) return r;
    await delay(20);
  }

  throw new Error('Run state deadline ' + id);
}

async function events(id) {
  return (await api('/runs/' + id + '/events')).value.items;
}

function definition(spec) {
  const session =
    spec.policy === 'resume-named'
      ? { policy: spec.policy, key: 'audit-' + spec.name.split('-')[1] }
      : { policy: spec.policy };

  const config = {
    harness: spec.family,
    model: spec.family === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
    effort: 'low',
    harnessOptions: { sandbox: 'read-only', approval: 'never' },
    session,

    prompt: { template: 'Original task' },
    output: {
      schema: {
        jsonSchema: { type: 'number' },
        repair: {
          enabled: true,
          maxAttempts: 3,
          prompt: spec.large
            ? 'Repair exactly: {{ invocation.trigger.payload.blob }}{{ invocation.trigger.payload.blob }}{{ invocation.trigger.payload.blob }} / {{ value }}'
            : 'Repair exactly: {{ value }}\nquote " slash \\ NUL \u0000 LS \u2028 PS \u2029 emoji \u{1F642}',
        },
      },
    },
  };

  const d = singleNodeLoop(spec.name, { id: 'infer', kind: 'inference', label: 'Infer', config });

  if (spec.policy !== 'fresh') {
    const incoming = d.edges.find((e) => e.to.node === 'infer');

    const source = incoming.from;

    incoming.from = { node: 'seed', port: 'out' };

    d.nodes.push({
      id: 'seed',
      kind: 'inference',
      label: 'Seed',
      config: {
        harness: spec.family,
        model: config.model,
        effort: 'low',
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
        session,
        prompt: { template: 'Seed task' },
      },
    });

    d.edges.push({ id: 'seed-entry', from: source, to: { node: 'seed', port: 'in' } });
  }

  return d;
}

try {
  for (const family of ['codex', 'claude'])
    for (const afterCommit of [false, true])
      for (const mode of ['read-once', 'read-down', 'write-down', 'both-down']) {
        const spec = {
          family,
          policy: 'fresh',
          name: 'store-' + family + '-' + afterCommit + '-' + mode,
        };
        const record = { ...spec, afterCommit, mode };
        const calls = [];
        const cancelled = [];
        const fake = new FakeHarness([{ finalText: 'invalid first' }, { finalText: '42' }], family);

        const invoke = (r, s, id) => {
          calls.push({ id, prompt: r.turn.prompt });
          const n = calls.length;
          const session = id ? fake.resume(id, r, s) : fake.start(r, s);
          return {
            ...session,
            cancel: async () => {
              cancelled.push(n);
              return session.cancel();
            },
          };
        };

        active.set(family, {
          start: (r, s) => invoke(r, s),
          resume: (id, r, s) => invoke(r, s, id),
        });
        injection = {
          afterCommit,
          fired: false,
          mode,
          readDown: mode !== 'write-down',
          writeDown: mode === 'write-down' || mode === 'both-down',
          readFailures: 0,
          writeFailures: 0,
        };

        try {
          const created = await api('/loops', { definition: definition(spec) });
          assert.equal(created.status, 201);
          const loopId = created.value.loop.id;
          assert.equal((await api('/loops/' + loopId + '/publish', {})).status, 200);

          const started = await api('/loops/' + loopId + '/runs', {});
          assert.equal(started.status, 202);
          const id = started.value.run.id;
          record.runId = id;

          if (mode === 'read-down' || mode === 'both-down') {
            // The original audit qualified these eight deadlines separately: terminal recording
            // itself needs a read. Assert no extra invocation while unavailable, then restore the
            // store and recover through the public manager. This is not an exact-repair assertion
            // where no terminal refusal could be persisted; native restart is a separate suite.
            await c.manager.waitForIdle();
            const blocked = (await api('/runs/' + id)).value;
            assert.equal(blocked.status, 'running');
            assert.equal(calls.length, 1);
            assert.ok(injection.readFailures > 0);
            record.blockedStatus = blocked.status;
            record.callsWhileUnavailable = calls.length;
            record.qualification =
              'Sustained read outage prevents terminal persistence; restore and recover, without claiming durable definite non-submission.';
            injection.readDown = false;
            injection.writeDown = false;
            c.manager.stop();
            await c.manager.start();
            record.recoveredStatus = (await stopped(id)).status;
            assert.equal(record.recoveredStatus, 'succeeded');
            record.calls = calls;
            record.after = await events(id);
            record.pass = true;
            report.checks.push(record);
            await writeFile(join(out, 'storage-outages.json'), JSON.stringify(report, null, 2));
            progress(
              JSON.stringify({
                name: record.name,
                pass: true,
                qualification: record.qualification,
              }),
            );
            continue;
          }
          const failed = await stopped(id);
          record.failure = failed.failure;
          record.initialStatus = failed.status;
          record.storageFaults = { reads: injection.readFailures, writes: injection.writeFailures };
          injection.readDown = false;
          injection.writeDown = false;
          record.before = await events(id);
          record.durableRepairCount = record.before.filter(
            (e) => e.type === 'harness.turn' && e.promptKind === 'repair',
          ).length;
          record.interruptedRepair = injection.turn;
          assert.ok(injection.fired);
          assert.equal(calls.length, 1);

          const resumed = await api('/runs/' + id + '/resume', {});
          record.resumeStatus = resumed.status;
          record.afterStatus = resumed.status === 200 ? (await stopped(id)).status : undefined;

          record.calls = calls;
          record.cancelled = cancelled;
          record.after = await events(id);
          record.exactRetry = calls.at(-1).prompt === injection.turn.prompt;

          assert.equal(cancelled.length, 0);
          assert.ok(record.durableRepairCount <= 1, 'no duplicate repair before explicit retry');
          assert.equal(resumed.status, 200);
          assert.equal(record.afterStatus, 'succeeded');
          assert.equal(record.exactRetry, true);
          assert.equal(record.failure?.inference?.promptKind, 'repair');
          assert.equal(record.failure?.inference?.submission, 'definitely-not-submitted');
          record.pass = true;
        } catch (error) {
          record.pass = false;
          record.error = error.stack;
          process.exitCode = 1;
        }

        report.checks.push(record);
        await writeFile(join(out, 'storage-outages.json'), JSON.stringify(report, null, 2));
        progress(
          JSON.stringify({
            name: record.name,
            mode,
            pass: record.pass,
            status: record.initialStatus,
            failure: record.failure?.code,
            provenance: record.failure?.inference,
            exactRetry: record.exactRetry,
            durableRepairCount: record.durableRepairCount,
            storageFaults: record.storageFaults,
            error: record.error,
          }),
        );
      }
} finally {
  await app.close();
  await c.stop();
  report.closed = true;
  await writeFile(join(out, 'storage-outages.json'), JSON.stringify(report, null, 2));
}
