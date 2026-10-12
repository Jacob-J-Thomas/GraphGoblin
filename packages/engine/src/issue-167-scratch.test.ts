/**
 * Issue #167 research only. Real RunManager + production handlers + fake ports.
 * No servers, subprocesses, provider calls, product edits, or live data.
 * Durable research output: root issue-167-observations.json.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  ContextThreadSchema,
  LoopDefinitionSchema,
  LoopVersionRecordSchema,
  RunEventSchema,
  RunRecordSchema,
  type LoopDefinition,
  type LoopVersionRecord,
  type RunRecord,
  type RunEvent,
  type ContextThread,
  type ExitConfig,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { replayThread, validateLoop } from '@graphgoblin/domain';
import {
  RunManager,
  defaultHandlers,
  mutateHandler,
  countEntries,
  type NodeContext,
  type EngineSettings,
} from '@graphgoblin/engine';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  type FakePorts,
} from '@graphgoblin/engine/testing';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const managers: RunManager[] = [];
const observations: Record<string, unknown>[] = [];
type Design = 'A' | 'B';
type WorkHook = (ctx: NodeContext<'mutate'>, ports: FakePorts) => Promise<void>;
interface Rig {
  ports: FakePorts;
  manager: RunManager;
  settings: EngineSettings;
  version: LoopVersionRecord;
}
const never = () => new Promise<never>(() => undefined);
const input = (k = 3, failAt = 999) => ({ k, failAt });

async function definition(design: Design): Promise<LoopDefinition> {
  const def = LoopDefinitionSchema.parse(
    JSON.parse(
      await readFile(join(root, 'issue-167-loop-' + design.toLowerCase() + '.json'), 'utf8'),
    ),
  );
  expect(validateLoop(def)).toEqual([]);
  return def;
}
function decisionExpression(def: LoopDefinition, expression: string): void {
  const node = def.nodes.find((n) => n.kind === 'decision');
  if (!node || node.kind !== 'decision') throw new Error('missing decision');
  node.config.evaluation = { kind: 'expression', jsonata: expression };
}
function exitConfig(def: LoopDefinition, id: string): ExitConfig {
  const node = def.nodes.find((n) => n.id === id);
  if (!node || node.kind !== 'exit') throw new Error('missing exit ' + id);
  return node.config;
}
async function createRig(def: LoopDefinition, onWork?: WorkHook): Promise<Rig> {
  // Validate every variant, then store a parsed immutable published version.
  const parsed = LoopDefinitionSchema.parse(def);
  expect(validateLoop(parsed)).toEqual([]);
  const ports = createFakePorts();
  const settings = { ...DEFAULT_TEST_SETTINGS };
  const handlers = defaultHandlers();
  if (onWork)
    handlers.mutate = {
      kind: 'mutate',
      async execute(ctx) {
        const result = await mutateHandler.execute(ctx);
        await onWork(ctx, ports);
        return result;
      },
    };
  const manager = new RunManager(ports, settings, handlers);
  managers.push(manager);
  await manager.start();
  const version = LoopVersionRecordSchema.parse({
    id: fakeUlid('167-version-' + parsed.name),
    loopId: fakeUlid('167-loop-' + parsed.name),
    version: 1,
    status: 'published',
    definition: parsed,
    createdAt: ports.clock.now().toISOString(),
    publishedAt: ports.clock.now().toISOString(),
  });
  ports.loops.add(version);
  return { ports, manager, settings, version };
}
async function start(r: Rig, payload = input()) {
  return r.manager.startRun({
    ownerId: 'local',
    loopId: r.version.loopId,
    source: 'manual.api',
    payload,
  });
}
async function mustRun(r: Rig, id: string) {
  const record = await r.ports.runs.get(id);
  if (!record) throw new Error('missing run');
  return record;
}
async function capture(r: Rig, id: string, scenario: string, design: string) {
  await r.manager.waitForIdle();
  const run = RunRecordSchema.parse(await mustRun(r, id));
  const events = r.ports.events.all(id).map((e) => RunEventSchema.parse(e));
  const readThread = await r.manager.getThread(id);
  const initial = await r.ports.runs.getInitialThread(id);
  if (!readThread || !initial) throw new Error('missing thread');
  const thread = replayThread(initial, events);
  if (run.failure?.code === 'EVALUATION_EXPRESSION_FAILED') {
    // The public read serves the last saved snapshot, before the failed node.started.
    // Record this observed read/replay difference; do not mislabel it a recovery failure.
    expect(readThread.vars).toEqual(thread.vars);
    expect(readThread.counters.nodeVisits[run.failure.nodeId!]).toBe(
      thread.counters.nodeVisits[run.failure.nodeId!]! - 1,
    );
  } else expect(readThread).toEqual(thread);
  expect(r.ports.harness.started).toHaveLength(0);
  expect(r.ports.jev.choices).toHaveLength(0);
  expect(r.ports.jev.classifierNouls).toHaveLength(0);
  expect(r.ports.jev.scores).toHaveLength(0);
  expect(r.ports.codexDecider.choices).toHaveLength(0);
  expect(r.ports.codexDecider.nouls).toHaveLength(0);
  expect(r.ports.structuredFake.requests).toHaveLength(0);
  expect(r.ports.scripts.calls).toHaveLength(0);
  const starts = events.filter(
    (e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started',
  );
  const visits = Object.fromEntries(
    r.version.definition.nodes.map((n) => [n.id, countEntries(events, n.id)]),
  );
  const attempts = Object.fromEntries(
    r.version.definition.nodes.map((n) => [
      n.id,
      starts.filter((e) => e.nodeId === n.id).map((e) => e.attempt),
    ]),
  );
  const eventCounts = Object.fromEntries(
    [...new Set(events.map((e) => e.type))].map((type) => [
      type,
      events.filter((e) => e.type === type).length,
    ]),
  );
  observations.push({
    scenario,
    design,
    definition: r.version.definition,
    run,
    thread,
    readThread,
    freshVisits: visits,
    attempts,
    eventCounts,
    deliveries: {
      webhooks: r.ports.delivery.webhooks,
      events: r.ports.delivery.events,
      logged: r.ports.delivery.logged,
      files: [...r.ports.workspace.files],
    },
    events,
  });
  return { run, thread, events, visits, attempts };
}
function addExhaustedRoute(def: LoopDefinition, expression: string) {
  const node = def.nodes.find((n) => n.kind === 'decision');
  if (!node || node.kind !== 'decision' || node.config.answer.type !== 'choice')
    throw new Error('expected Choice decision');
  node.config.answer.options.push({
    id: 'exhausted',
    label: 'Exhausted',
    criteria: 'Budget reached',
  });
  decisionExpression(def, expression);
  def.nodes.push({
    id: 'exhausted-exit',
    kind: 'exit',
    label: 'Return exhausted',
    ui: { x: 0, y: 0 },
    config: {
      criteria: [{ when: 'max-iterations', value: 1, outcome: 'exhausted' }],
      default: 'success',
      return: structuredClone(exitConfig(def, 'success-exit').return),
    },
  });
  def.edges.push({
    id: 'decide-exhausted',
    from: { node: 'decide', port: 'exhausted' },
    to: { node: 'exhausted-exit', port: 'in' },
  });
}
/** Disk-persist the fake store, then build brand-new fakes with no thread snapshot.
 * Stored timestamps, run.startedAt, event sequences and delivery side effects are preserved.
 * The old executor stays frozen to model process loss; no second executor shares its stores.
 */
async function rebuild(r: Rig, id: string, label: string): Promise<Rig> {
  r.manager.stop();
  const path = join(root, 'issue-167-restart-' + label + '-' + randomUUID() + '.tmp.json');
  const snapshot = {
    version: r.version,
    run: await mustRun(r, id),
    initial: await r.ports.runs.getInitialThread(id),
    events: r.ports.events.all(id),
    clock: r.ports.clock.now().toISOString(),
    effects: {
      webhooks: r.ports.delivery.webhooks,
      events: r.ports.delivery.events,
      logged: r.ports.delivery.logged,
      files: [...r.ports.workspace.files],
    },
  };
  try {
    await writeFile(path, JSON.stringify(snapshot), 'utf8');
    const raw = JSON.parse(await readFile(path, 'utf8')) as typeof snapshot;
    const ports = createFakePorts();
    const version = LoopVersionRecordSchema.parse(raw.version);
    const run = RunRecordSchema.parse(raw.run);
    const initial = ContextThreadSchema.parse(raw.initial);
    ports.loops.add(version);
    await ports.runs.create(run, initial);
    ports.runs.dropThreadSnapshot(id);
    for (const rawEvent of raw.events) {
      const event = RunEventSchema.parse(rawEvent);
      const { runId: _id, seq: _seq, ts, ...draft } = event;
      ports.clock.set(ts);
      await ports.events.append(id, [draft]);
    }
    ports.clock.set(raw.clock);
    ports.delivery.webhooks.push(...raw.effects.webhooks);
    ports.delivery.events.push(...raw.effects.events);
    ports.delivery.logged.push(...raw.effects.logged);
    for (const [key, value] of raw.effects.files) ports.workspace.files.set(key, value);
    expect(ports.events.all(id)).toEqual(raw.events);
    const manager = new RunManager(ports, r.settings);
    managers.push(manager);
    await manager.start();
    return { ports, manager, version, settings: r.settings };
  } finally {
    await unlink(path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
afterEach(() => {
  for (const manager of managers) manager.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(async () => {
  await writeFile(
    join(root, 'issue-167-observations.json'),
    JSON.stringify(
      {
        baseCommit: 'c379f806ba8a04433779d98ded7e4196c9d4b663',
        engine: 'production RunManager and node handlers, all fake ports',
        records: observations,
      },
      null,
      2,
    ),
    'utf8',
  );
});

describe('issue 167 comparison: actual runs', () => {
  for (const design of ['A', 'B'] as const) {
    it.each([
      { name: 'first-pass success', k: 1, failAt: 999, count: 1, outcome: 'success' },
      { name: 'success after continuations', k: 3, failAt: 999, count: 3, outcome: 'success' },
      {
        name: 'ceiling exhaustion',
        k: 99,
        failAt: 999,
        count: 4,
        outcome: design === 'A' ? 'exhausted' : 'failure',
      },
      { name: 'explicit failure', k: 99, failAt: 2, count: 2, outcome: 'failure' },
      { name: 'success at ceiling', k: 4, failAt: 999, count: 4, outcome: 'success' },
      { name: 'simultaneous success and failure', k: 2, failAt: 2, count: 2, outcome: 'success' },
    ])(design + ': $name', async (scenario) => {
      const r = await createRig(await definition(design));
      const run = await start(r, input(scenario.k, scenario.failAt));
      const out = await capture(r, run.id, scenario.name, design);
      expect(out.run.outcome).toBe(scenario.outcome);
      expect(out.run.status).toBe(
        scenario.outcome === 'success'
          ? 'succeeded'
          : scenario.outcome === 'exhausted'
            ? 'exhausted'
            : 'failed',
      );
      expect(out.run.failure).toBeUndefined(); // authored failure is run.finished, not run.failed
      expect(out.thread.vars.count).toBe(scenario.count);
      expect(out.run.iteration).toBe(design === 'A' ? scenario.count : 1);
      expect(out.visits.work).toBe(scenario.count);
      expect(out.attempts.work).toEqual(Array(scenario.count).fill(1));
      expect(out.events.filter((e) => e.type === 'iteration.incremented')).toHaveLength(
        design === 'A' ? scenario.count - 1 : 0,
      );
      expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(5);
      expect(r.ports.delivery.webhooks[0]?.payload).toMatchObject({
        outcome: scenario.outcome,
        result: { count: scenario.count },
      });
      if (design === 'A') {
        const terminal = out.events.filter((e) => e.type === 'exit.evaluated').at(-1);
        expect(terminal?.type).toBe('exit.evaluated');
        if (terminal?.type === 'exit.evaluated') {
          expect(terminal.criteria.map((c) => c.status)).toEqual(
            scenario.outcome === 'success'
              ? ['matched', 'skipped', 'skipped']
              : scenario.outcome === 'failure'
                ? ['not-matched', 'matched', 'skipped']
                : ['not-matched', 'not-matched', 'not-matched'],
          );
        }
      } else {
        const chosen = out.events.filter((e) => e.type === 'decision.made').at(-1);
        expect(chosen).toMatchObject({
          portId: scenario.outcome === 'success' ? 'success' : 'failure',
          answer: { type: 'choice', confidence: null, probabilities: null },
          provenance: {
            kind: 'expression',
            provider: null,
            classifierId: null,
            model: null,
            effort: null,
          },
          diagnostics: [],
        });
      }
    });
    it(design + ': elapsed duration using authoritative run fields', async () => {
      const def = await definition(design);
      if (design === 'B')
        decisionExpression(
          def,
          'vars.done ? "success" : (vars.fail or vars.count >= 4 or ' +
            '($exists(run.elapsedMs) and run.elapsedMs >= 5000)) ? "failure" : "continue"',
        );
      const r = await createRig(def, async (_ctx, ports) => {
        ports.clock.advance(3000);
      });
      const run = await start(r, input(3));
      const out = await capture(r, run.id, 'elapsed duration (5s, +3s per work)', design);
      expect(out.run.outcome).toBe(design === 'A' ? 'exhausted' : 'success');
      expect(out.thread.vars.count).toBe(design === 'A' ? 2 : 3);
      expect('startedAt' in out.thread.run).toBe(false);
      expect('elapsedMs' in out.thread.run).toBe(false);
      if (design === 'A')
        expect(out.events.filter((e) => e.type === 'exit.evaluated').at(-1)).toMatchObject({
          result: { kind: 'limit-reached', limit: 'max-duration', value: 5, criterionIndex: 2 },
        });
    });
    for (const phase of [
      'between iterations',
      'during work',
      'terminal append',
      'return mid-delivery',
      'pause and resume',
    ] as const) {
      it(design + ': restart ' + phase, async () => {
        let blocked = false;
        const r = await createRig(
          await definition(design),
          phase === 'during work'
            ? async (ctx) => {
                if (ctx.thread.vars.count === 1 && ctx.attempt === 1) {
                  blocked = true;
                  await never(); // production handler computed patch, but it is not durable
                }
              }
            : undefined,
        );
        const append = r.ports.events.append.bind(r.ports.events);
        if (phase === 'between iterations' || phase === 'terminal append')
          vi.spyOn(r.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
            const stored = await append(id, drafts, options);
            const cut =
              phase === 'terminal append'
                ? drafts.some((d) => d.type === 'run.finished')
                : drafts.some(
                    (d) =>
                      d.type === 'node.finished' &&
                      (design === 'A'
                        ? d.nodeId === 'exit' && d.route === 'loopBack'
                        : d.nodeId === 'decide' && d.route === 'continue'),
                  );
            if (!blocked && cut) {
              blocked = true;
              await never();
            }
            return stored;
          });
        if (phase === 'return mid-delivery')
          vi.spyOn(r.ports.delivery, 'webhook').mockImplementation(async (url, payload, secret) => {
            r.ports.delivery.webhooks.push({ url, payload, ...(secret ? { secret } : {}) });
            blocked = true;
            await never(); // external delivery succeeded; return.delivered was not recorded
          });
        if (phase === 'pause and resume')
          vi.spyOn(r.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
            const stored = await append(id, drafts, options);
            if (
              !blocked &&
              drafts.some(
                (d) =>
                  d.type === 'iteration.incremented' ||
                  (d.type === 'node.finished' && d.nodeId === 'decide' && d.route === 'continue'),
              )
            ) {
              blocked = true;
              await r.manager.pause(id);
            }
            return stored;
          });
        const run = await start(r);
        await vi.waitFor(() => expect(blocked).toBe(true));
        if (phase === 'pause and resume') {
          await r.manager.waitForIdle();
          expect((await mustRun(r, run.id)).status).toBe('paused');
        }
        const beforeEvents = r.ports.events.all(run.id);
        const beforeRun = await mustRun(r, run.id);
        const beforeThread = replayThread(
          (await r.ports.runs.getInitialThread(run.id))!,
          beforeEvents,
        );
        let recovered = await rebuild(r, run.id, design + '-' + phase.replaceAll(' ', '-'));
        if (phase === 'pause and resume') {
          expect((await mustRun(recovered, run.id)).status).toBe('paused');
          await recovered.manager.resume(run.id);
        }
        await recovered.manager.waitForIdle();
        // Repeat recovery to check no duplicated completions, increments or acknowledged returns.
        recovered = await rebuild(recovered, run.id, design + '-second-recovery');
        const out = await capture(recovered, run.id, 'restart ' + phase, design);
        observations[observations.length - 1]!['restartCut'] = {
          run: beforeRun,
          thread: beforeThread,
          eventCount: beforeEvents.length,
          lastEvents: beforeEvents.slice(-4),
        };
        expect(out.run.status).toBe('succeeded');
        expect(out.thread.vars.count).toBe(3);
        expect(out.run.iteration).toBe(design === 'A' ? 3 : 1);
        expect(out.visits.work).toBe(3);
        expect(out.thread.counters.nodeVisits.work).toBe(phase === 'during work' ? 4 : 3);
        expect(out.attempts.work).toEqual(phase === 'during work' ? [1, 1, 2, 1] : [1, 1, 1]);
        expect(out.events.filter((e) => e.type === 'run.finished')).toHaveLength(1);
        expect(out.events.filter((e) => e.type === 'iteration.incremented')).toHaveLength(
          design === 'A' ? 2 : 0,
        );
        expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(5);
        expect(recovered.ports.delivery.webhooks).toHaveLength(
          phase === 'return mid-delivery' ? 2 : 1,
        );
        expect(recovered.ports.delivery.logged).toHaveLength(1);
        expect(
          out.events.filter((e) => e.type === 'node.finished' && e.nodeId === 'work'),
        ).toHaveLength(3);
      });
    }
    it(design + ': failed return delivery and invocation channel defaults', async () => {
      const r = await createRig(await definition(design));
      r.ports.delivery.failWebhooks = true;
      const run = await r.manager.startRun({
        ownerId: 'local',
        loopId: r.version.loopId,
        source: 'manual.api',
        payload: input(1),
        returnDefaults: [
          { kind: 'caller' },
          { kind: 'log' },
          { kind: 'event', eventType: 'extra-result' },
        ],
      });
      const out = await capture(r, run.id, 'delivery failure and caller defaults', design);
      expect(out.run.status).toBe('succeeded');
      expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(5);
      expect(out.events.filter((e) => e.type === 'return.failed')).toHaveLength(1);
      expect(r.ports.delivery.events).toHaveLength(2);
    });
    it(design + ': lastOutput return mapping', async () => {
      const def = await definition(design);
      for (const node of def.nodes)
        if (node.kind === 'exit') node.config.return.mapping = 'lastOutput.value';
      const r = await createRig(def);
      const run = await start(r, input(1));
      const out = await capture(r, run.id, 'lastOutput return mapping', design);
      expect(out.run.result).toEqual(
        design === 'A'
          ? input(1)
          : expect.objectContaining({
              portId: 'success',
              answer: expect.objectContaining({ type: 'choice', optionId: 'success' }),
            }),
      );
    });
    it(design + ': expression evaluation error at ceiling', async () => {
      const def = await definition(design);
      const source = 'vars.count >= 4 ? $error("research criterion failure") : ';
      if (design === 'A') {
        const criterion = exitConfig(def, 'exit').criteria[0]!;
        if (criterion.when !== 'predicate') throw new Error('expected predicate');
        criterion.evaluation = { kind: 'expression', jsonata: source + 'vars.done' };
      } else
        decisionExpression(
          def,
          source + '(vars.done ? "success" : vars.fail ? "failure" : "continue")',
        );
      const r = await createRig(def);
      const run = await start(r, input(99));
      const out = await capture(r, run.id, 'expression error at ceiling', design);
      expect(out.run.status).toBe('failed');
      expect(out.run.outcome).toBeUndefined();
      expect(out.run.failure?.code).toBe('EVALUATION_EXPRESSION_FAILED');
      expect(out.run.failure?.resumable).toBe(false);
      expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(0);
      if (design === 'A')
        expect(out.events.filter((e) => e.type === 'exit.evaluated').at(-1)).toMatchObject({
          criteria: [{ status: 'error' }, { status: 'skipped' }, { status: 'skipped' }],
          result: { kind: 'failed' },
        });
    });
  }
  it.each([
    {
      name: 'no explicit ceiling',
      source: 'vars.done ? "success" : vars.fail ? "failure" : "continue"',
    },
    {
      name: 'ceiling incorrectly uses run.iteration',
      source: 'vars.done ? "success" : (vars.fail or run.iteration >= 4) ? "failure" : "continue"',
    },
  ])('B: $name hits ordinary cycle safety cap', async ({ name, source }) => {
    const def = await definition('B');
    decisionExpression(def, source);
    const r = await createRig(def);
    const run = await start(r, input(99));
    const out = await capture(r, run.id, name, 'B');
    expect(out.run.iteration).toBe(1);
    expect(out.run.outcome).toBeUndefined();
    expect(out.run.failure).toMatchObject({
      code: 'MAX_ITERATIONS',
      nodeId: 'work',
      resumable: false,
      details: { maxIterations: 4 },
    });
    expect(out.visits.work).toBe(4);
    expect(out.events.filter((e) => e.type === 'node.started' && e.nodeId === 'work')).toHaveLength(
      4,
    );
    expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(0);
  });
  it('B4: an explicit fourth route can produce exhausted today', async () => {
    const def = await definition('B');
    addExhaustedRoute(
      def,
      'vars.done ? "success" : vars.fail ? "failure" : vars.count >= 4 ? "exhausted" : "continue"',
    );
    const r = await createRig(def);
    const run = await start(r, input(99));
    const out = await capture(r, run.id, 'fourth route exhausted exit', 'B4');
    expect(out.run.status).toBe('exhausted');
    expect(out.run.outcome).toBe('exhausted');
    expect(out.run.iteration).toBe(1);
    expect(out.thread.vars.count).toBe(4);
    expect(out.events.filter((e) => e.type === 'exit.evaluated').at(-1)).toMatchObject({
      iteration: 1,
      result: { kind: 'limit-reached', limit: 'max-iterations', value: 1 },
    });
    expect(out.events.filter((e) => e.type === 'return.delivered')).toHaveLength(5);
  });
  it('B: invocation time and JSONata clock can approximate a duration guard', async () => {
    const def = await definition('B');
    decisionExpression(
      def,
      'vars.done ? "success" : (vars.fail or vars.count >= 4 or ' +
        '$millis() - $toMillis(trigger.receivedAt) >= 5000) ? "failure" : "continue"',
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-10-02T12:00:00.000Z');
    const r = await createRig(def, async (_ctx, ports) => {
      ports.clock.advance(3000);
      vi.setSystemTime(ports.clock.now());
    });
    const run = await start(r, input(3));
    const out = await capture(r, run.id, 'duration approximation from trigger.receivedAt', 'B');
    expect(out.thread.vars.count).toBe(2);
    expect(out.run.outcome).toBe('failure');
    expect(out.run.iteration).toBe(1);
  });
  it.each(['A', 'B'] as const)(
    '%s: duration approximation includes queue delay',
    async (design) => {
      const def = await definition(design);
      if (design === 'B')
        decisionExpression(
          def,
          'vars.done ? "success" : (vars.fail or vars.count >= 4 or ' +
            '$millis() - $toMillis(trigger.receivedAt) >= 5000) ? "failure" : "continue"',
        );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime('2026-10-02T12:00:00.000Z');
      const r = await createRig(def);
      r.manager.stop(); // admit queued, then delay starting it
      const run = await start(r, input(2));
      r.ports.clock.advance(6000);
      vi.setSystemTime(r.ports.clock.now());
      await r.manager.start();
      const out = await capture(r, run.id, 'queued 6s then no work delay', design);
      expect(out.thread.vars.count).toBe(design === 'A' ? 2 : 1);
      expect(out.run.outcome).toBe(design === 'A' ? 'success' : 'failure');
    },
  );
});

describe('issue 167 additional recovery semantics', () => {
  it('A: retry during work at the ceiling counts as an attempt, not another fresh visit', async () => {
    let blocked = false;
    const r = await createRig(await definition('A'), async (ctx) => {
      if (ctx.thread.vars.count === 1 && ctx.attempt === 1) {
        blocked = true;
        await never();
      }
    });
    const run = await start(r, input(4));
    await vi.waitFor(() => expect(blocked).toBe(true));
    const recovered = await rebuild(r, run.id, 'A-retry-cap');
    const out = await capture(recovered, run.id, 'retry work then success at ceiling', 'A');
    expect(out.run.outcome).toBe('success');
    expect(out.run.iteration).toBe(4);
    expect(out.thread.vars.count).toBe(4);
    expect(out.thread.counters.nodeVisits.work).toBe(5);
    expect(out.visits.work).toBe(4);
    expect(out.attempts.work).toEqual([1, 1, 2, 1, 1]);
  });
  it('B: a ceiling based on counters.nodeVisits includes a recovered attempt', async () => {
    const def = await definition('B');
    decisionExpression(
      def,
      'vars.done ? "success" : (vars.fail or counters.nodeVisits.work >= 4) ? "failure" : "continue"',
    );
    let blocked = false;
    const r = await createRig(def, async (ctx) => {
      if (ctx.thread.vars.count === 1 && ctx.attempt === 1) {
        blocked = true;
        await never();
      }
    });
    const run = await start(r, input(4));
    await vi.waitFor(() => expect(blocked).toBe(true));
    const recovered = await rebuild(r, run.id, 'B-retry-cap');
    const out = await capture(recovered, run.id, 'nodeVisits ceiling after recovered work', 'B');
    expect(out.run.outcome).toBe('failure');
    expect(out.thread.vars.count).toBe(3);
    expect(out.thread.counters.nodeVisits.work).toBe(4);
    expect(out.visits.work).toBe(3);
    expect(out.attempts.work).toEqual([1, 1, 2, 1]);
  });
  it.each(['A', 'B'] as const)(
    '%s: evaluation evidence durable before node completion',
    async (design) => {
      const r = await createRig(await definition(design));
      let blocked = false;
      const append = r.ports.events.append.bind(r.ports.events);
      vi.spyOn(r.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
        const stored = await append(id, drafts, options);
        const target = design === 'A' ? 'exit.evaluated' : 'decision.made';
        if (!blocked && drafts.some((d) => d.type === target)) {
          blocked = true;
          await never();
        }
        return stored;
      });
      const run = await start(r);
      await vi.waitFor(() => expect(blocked).toBe(true));
      const recovered = await rebuild(r, run.id, design + '-evidence-before-finish');
      const out = await capture(
        recovered,
        run.id,
        'evaluation evidence before completion crash',
        design,
      );
      expect(out.run.status).toBe('succeeded');
      expect(out.thread.vars.count).toBe(3);
      const nodeId = design === 'A' ? 'exit' : 'decide';
      expect(out.attempts[nodeId]).toEqual([1, 2, 1, 1]);
      expect(out.visits[nodeId]).toBe(3);
      expect(out.thread.counters.nodeVisits[nodeId]).toBe(4);
      expect(
        out.events.filter((e) => e.type === (design === 'A' ? 'exit.evaluated' : 'decision.made')),
      ).toHaveLength(4);
      expect(out.events.filter((e) => e.type === 'iteration.incremented')).toHaveLength(
        design === 'A' ? 2 : 0,
      );
      expect(out.events.filter((e) => e.type === 'run.finished')).toHaveLength(1);
    },
  );
});
