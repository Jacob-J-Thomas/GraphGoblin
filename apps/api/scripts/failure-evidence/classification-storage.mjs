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

const { CodexHarness } = await import('@graphgoblin/adapter-codex');

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
const eventStore = c.ports.events;

c.ports.events = {
  append: async (id, drafts, options) => {
    const repair = drafts.find((d) => d.type === 'harness.turn' && d.promptKind === 'repair');
    if (repair && injection) injection.turnId = repair.turnId;

    const marker = drafts.find(
      (d) =>
        d.type === 'harness.submission' &&
        d.turnId === injection?.turnId &&
        d.submission === injection?.state,
    );

    if (marker && injection && !injection.fired) {
      injection.fired = true;
      injection.marker = marker;
      if (injection.afterCommit) await eventStore.append(id, drafts, options);
      throw new Error(
        'Controlled classification append ' +
          (injection.afterCommit ? 'after' : 'before') +
          ' commit',
      );
    }

    return eventStore.append(id, drafts, options);
  },
  recoveryFacts: (...args) => eventStore.recoveryFacts(...args),
  read: (...args) => eventStore.read(...args),
  subscribe: (...args) => eventStore.subscribe(...args),
};

await c.start();

const app = await buildApp(c);

await app.listen({ host: '127.0.0.1', port });

const report = {
  head,
  store,
  port,
  tier: 'Built API and SQLite; public HarnessPort and event-store fixtures over real SQLite for both families; no provider turns',
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

function faultHarness(spec) {
  const calls = [],
    cancelled = [];
  let entered = false;

  const fake = new FakeHarness([], spec.family);

  const failure = () =>
    Object.assign(new Error('Recorded conversation no longer exists'), {
      code: spec.code,
      retriable: spec.retriable,
      ...(spec.state !== undefined ? { submission: spec.state } : {}),
      ...(spec.abortName ? { name: 'AbortError' } : {}),
    });

  const missingSdk = new CodexHarness({
    clientFactory: () => ({
      startThread: () => {
        throw new Error('unexpected start');
      },

      resumeThread: (id) => {
        if (spec.mode === 'sdk-sync') throw failure();

        return {
          runStreamed: async () => {
            if (spec.mode === 'sdk-promise') throw failure();

            return {
              events: (async function* () {
                if (spec.mode === 'sdk-iterator') throw failure();

                yield { type: 'turn.failed', error: { message: 'No rollout found with id ' + id } };
              })(),
            };
          },
        };
      },
    }),
  });

  function invoke(request, signal, id) {
    calls.push({ id, prompt: request.turn.prompt });

    if (calls.length !== 2) {
      fake.script([{ finalText: calls.length === 1 ? 'invalid first' : '42' }]);
      return id ? fake.resume(id, request, signal) : fake.start(request, signal);
    }

    entered = true;

    if (spec.mode.startsWith('sdk-')) return missingSdk.resume(id, request, signal);

    if (spec.mode === 'sync') throw failure();

    let rejectResult;

    const result = new Promise((resolve, reject) => {
      rejectResult = reject;
    });
    result.catch(() => {});

    const stream = (async function* () {
      try {
        if (spec.accepted)
          yield {
            type: 'submitted',
            marker: spec.family === 'codex' ? 'codex.turn.started' : 'claude.assistant',
          };

        if (spec.cancel)
          await new Promise((resolve) =>
            signal.aborted ? resolve() : signal.addEventListener('abort', resolve, { once: true }),
          );

        const error = failure();

        if (spec.priorError)
          yield {
            type: 'error',
            code: spec.priorError,
            message: 'preceding error',
            retriable: true,
            submission: spec.priorState ?? 'definitely-not-submitted',
          };

        if (spec.mode === 'event')
          yield {
            type: 'error',
            code: spec.code,
            message: error.message,
            retriable: spec.retriable,
            submission: spec.state ?? 'delivery-uncertain',
          };

        rejectResult(error);

        if (spec.mode === 'iterator') throw error;
      } catch (error) {
        rejectResult(error);
        throw error;
      }
    })();

    return {
      sessionId: Promise.resolve(id),
      events: stream,
      result,
      cancel: async () => {
        cancelled.push(2);
        if (spec.cleanupUnconfirmed)
          throw Object.assign(new Error('Process still alive'), {
            code: 'HARNESS_TERMINATION_UNCONFIRMED',
          });
      },
    };
  }

  return {
    calls,
    cancelled,
    get entered() {
      return entered;
    },
    start: (r, s) => invoke(r, s),
    resume: (id, r, s) => invoke(r, s, id),
  };
}

const specs = [];

for (const family of ['codex', 'claude'])
  for (const retriable of [false, true])
    for (const afterCommit of [false, true])
      for (const mode of ['sync', 'iterator', 'result', 'event', 'cleanup'])
        for (const cancel of [false, true]) {
          if (mode === 'sync' && cancel) continue;

          const cleanupUnconfirmed = mode === 'cleanup';
          specs.push({
            family,
            afterCommit,
            mode: cleanupUnconfirmed ? 'result' : mode,
            boundary: mode,
            cancel,
            cleanupUnconfirmed,
            code: cleanupUnconfirmed
              ? 'HARNESS_NOT_AUTHENTICATED'
              : 'HARNESS_TERMINATION_UNCONFIRMED',
            state: cleanupUnconfirmed ? 'definitely-not-submitted' : undefined,
            retriable,
            policy: 'fresh',
            expected: 'HARNESS_TERMINATION_UNCONFIRMED',
            classification: 'delivery-uncertain',
            eligible: false,
          });
        }

try {
  for (const [index, spec] of specs.entries()) {
    spec.name = 'mapper-' + index + '-' + spec.family + '-' + spec.mode + '-' + spec.code;

    const record = { ...spec };
    injection = { afterCommit: spec.afterCommit, state: 'delivery-uncertain', fired: false };
    const h = faultHarness(spec);
    active.set(spec.family, h);

    try {
      const created = await api('/loops', { definition: definition(spec) });
      assert.equal(created.status, 201, JSON.stringify(created.value));
      const loopId = created.value.loop.id;

      assert.equal((await api('/loops/' + loopId + '/publish', {})).status, 200);

      const start = await api('/loops/' + loopId + '/runs', {});
      assert.equal(start.status, 202, JSON.stringify(start.value));
      const id = start.value.run.id;
      record.runId = id;

      if (spec.cancel) {
        const deadline = Date.now() + 60000;
        while (!h.entered && Date.now() < deadline) await delay(10);
        assert.ok(h.entered);
        record.cancelResponse = (await api('/runs/' + id + '/cancel', {})).status;
      }

      const run = await stopped(id);
      record.status = run.status;
      record.failure = run.failure;

      const history = await events(id);
      record.turn = history.filter((x) => x.type === 'harness.turn').at(-1);
      record.submissions = history.filter(
        (x) => x.type === 'harness.submission' && x.turnId === record.turn.turnId,
      );

      assert.equal(record.turn.prompt, h.calls[1].prompt);
      assert.equal(record.turn.promptKind, 'repair');

      const beforeCount = h.calls.length;
      const resume = await api('/runs/' + id + '/resume', {
        observedSeq: (await api('/runs/' + id)).value.recovery.observedSeq,
      });
      record.resumeStatus = resume.status;

      if (resume.status === 200) record.afterResume = (await stopped(id)).status;

      record.extraCalls = h.calls.length - beforeCount;

      const mismatches = [];
      const same = (label, a, e) => {
        if (a !== e) mismatches.push({ label, actual: a, expected: e });
      };

      if (spec.cancelled) {
        same('status', run.status, 'cancelled');
        same('resume', resume.status, 409);
        same('extra calls', record.extraCalls, 0);
      } else {
        same('status', run.status, 'failed');
        same('code', run.failure?.code, spec.expected);
        same('classification', run.failure?.inference?.submission, spec.classification);
        same('resumable', run.failure?.resumable, spec.eligible);
        same('resume', resume.status, spec.eligible ? 200 : 409);
        same('extra calls', record.extraCalls, spec.eligible ? 1 : 0);

        if (spec.eligible) {
          same('success', record.afterResume, 'succeeded');
          same(
            'retry prompt',
            h.calls.at(-1).prompt,
            spec.classification === 'definitely-not-submitted'
              ? record.turn.prompt
              : 'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
          );
        }
      }

      record.mismatches = mismatches;
      assert.equal(mismatches.length, 0, JSON.stringify(mismatches));
      record.pass = true;
    } catch (error) {
      record.pass = false;
      record.error = error.stack;
      process.exitCode = 1;
    }

    record.calls = h.calls;
    record.injection = { ...injection };
    report.checks.push(record);
    await writeFile(join(out, 'classification-storage.json'), JSON.stringify(report, null, 2));
    progress(
      JSON.stringify({
        name: record.name,
        pass: record.pass,
        mismatches: record.mismatches,
        error: record.error,
      }),
    );
  }
} finally {
  await app.close();
  await c.stop();
  report.closed = true;
  await writeFile(join(out, 'classification-storage.json'), JSON.stringify(report, null, 2));
  progress('Retained ' + store);
}
