import { afterEach, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  type LoopDefinitionInput,
  type RunEvent,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { RunManager } from './run-manager.js';
import { RunFailureError } from './errors.js';
import type { EventDraft } from './ports.js';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  InMemoryEventStore,
  InMemoryTriggerAdmission,
} from './testing/fakes.js';
import { singleNodeLoop } from './testing/scenario.js';

const managers: RunManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) {
    manager.stop();
    await manager.waitForIdle();
  }
});

async function fixture(
  def: LoopDefinitionInput,
  decorate?: (ports: ReturnType<typeof createFakePorts>) => InMemoryEventStore,
) {
  const ports = createFakePorts();
  if (decorate) ports.events = decorate(ports);
  ports.admission = new InMemoryTriggerAdmission(ports.runs, ports.events, ports.loops);
  const loopId = fakeUlid('hot-path-loop');
  ports.loops.add({
    id: fakeUlid('hot-path-version'),
    loopId,
    version: 1,
    status: 'published',
    createdAt: FIXTURE_TS,
    definition: LoopDefinitionSchema.parse(def),
  });
  const restart = async () => {
    const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS);
    managers.push(manager);
    await manager.start();
    return manager;
  };
  return { ports, loopId, manager: await restart(), restart };
}

it('finalization reads bounded pages and yields, preserving the entire return-producing log', async () => {
  const reads: (number | undefined)[] = [];
  let terminal = false;
  let timerRan = false;
  const f = await fixture(
    singleNodeLoop(
      'paged finalization',
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'go' }, output: { toMessages: 'none' } },
      },
      { returns: '{"value": 7}', destinations: [{ kind: 'caller' }, { kind: 'log' }] },
    ),
    (ports) => {
      return new (class extends InMemoryEventStore {
        override async append(
          id: string,
          drafts: readonly EventDraft[],
          options?: { expectedLastSeq?: number; requireRun?: boolean },
        ): Promise<RunEvent[]> {
          const stored = await super.append(id, drafts, options);
          if (stored.some((event) => event.type === 'run.finished')) terminal = true;
          return stored;
        }
        override read(id: string, after?: number, limit?: number): Promise<RunEvent[]> {
          if (terminal) {
            if (!reads.length)
              setTimeout(() => {
                timerRan = true;
              }, 0);
            reads.push(limit);
          }
          return super.read(id, after, limit);
        }
      })(ports.clock);
    },
  );
  f.ports.harness.script([
    {
      items: Array.from({ length: 600 }, (_, i) => ({
        id: String(i),
        type: 'message',
        summary: 'exact',
      })),
      finalText: 'OK',
    },
  ]);
  const run = await f.manager.startRun({
    ownerId: 'local',
    loopId: f.loopId,
    source: 'manual.api',
  });
  await f.manager.waitForIdle();
  expect(reads.length).toBeGreaterThan(2);
  expect(reads.every((limit) => limit !== undefined && limit <= 256)).toBe(true);
  expect(timerRan).toBe(true);
  const events = f.ports.events.all(run.id);
  expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i + 1));
  expect(events.filter((event) => event.type === 'node.progress')).toHaveLength(600);
  expect(events.filter((event) => event.type === 'return.delivered')).toHaveLength(2);
  expect((await f.ports.runs.get(run.id))?.result).toEqual({ value: 7 });
  expect(await f.ports.runs.listRecoveryCandidates()).toEqual([]);
  await f.ports.runs.clearFinalized(run.id);
  f.manager.stop();
  const recovered = await f.restart();
  await recovered.waitForIdle();
  expect(f.ports.events.all(run.id)).toEqual(events);
  expect(await f.ports.runs.listRecoveryCandidates()).toEqual([]);
});

it('a failed finalization page leaves delivery pending and recovery delivers exactly once', async () => {
  let terminal = false;
  let refusePage = true;
  const f = await fixture(
    singleNodeLoop(
      'failed finalization page',
      { id: 'work', kind: 'inference', label: 'Work', config: { prompt: { template: 'go' } } },
      { returns: '7', destinations: [{ kind: 'caller' }, { kind: 'log' }] },
    ),
    (ports) =>
      new (class extends InMemoryEventStore {
        override async append(
          id: string,
          drafts: readonly EventDraft[],
          options?: { expectedLastSeq?: number; requireRun?: boolean },
        ): Promise<RunEvent[]> {
          const stored = await super.append(id, drafts, options);
          if (stored.some((event) => event.type === 'run.finished')) terminal = true;
          return stored;
        }
        override read(id: string, after = 0, limit?: number): Promise<RunEvent[]> {
          if (terminal && after > 0 && refusePage)
            return Promise.reject(new Error('controlled page read failure'));
          return super.read(id, after, limit);
        }
      })(ports.clock),
  );
  f.ports.harness.script([
    {
      items: Array.from({ length: 600 }, (_, i) => ({
        id: String(i),
        type: 'message',
        summary: 'exact',
      })),
      finalText: 'OK',
    },
  ]);
  const run = await f.manager.startRun({
    ownerId: 'local',
    loopId: f.loopId,
    source: 'manual.api',
  });
  await f.manager.waitForIdle();
  expect((await f.ports.runs.get(run.id))?.status).toBe('succeeded');
  expect(f.ports.events.all(run.id).filter((event) => event.type === 'return.delivered')).toEqual(
    [],
  );
  expect(await f.ports.runs.listRecoveryCandidates()).toContainEqual({
    id: run.id,
    terminal: true,
  });
  refusePage = false;
  f.manager.stop();
  const recovered = await f.restart();
  await recovered.waitForIdle();
  expect(
    f.ports.events.all(run.id).filter((event) => event.type === 'return.delivered'),
  ).toHaveLength(2);
  expect(await f.ports.runs.listRecoveryCandidates()).toEqual([]);
  const history = f.ports.events.all(run.id);
  recovered.stop();
  await (await f.restart()).waitForIdle();
  expect(f.ports.events.all(run.id)).toEqual(history);
});

function waitCycle(cap: number | null): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'fresh visit controls',
    settings: { maxNodeVisits: cap },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'signal', name: 'next' } },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          routes: [
            { id: 'again', label: 'Again' },
            { id: 'stop', label: 'Stop' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
      { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'again' }, to: { node: 'wait' } },
      { id: 'd', from: { node: 'gate', port: 'stop' }, to: { node: 'done' } },
    ],
  };
}

it.each([2, null])(
  'rebuilds fresh visits across wakes, paused resume and restart at cap %s',
  async (cap) => {
    const f = await fixture(waitCycle(cap));
    const run = await f.manager.startRun({
      ownerId: 'local',
      loopId: f.loopId,
      source: 'manual.api',
    });
    await f.manager.waitForIdle();
    await f.manager.pause(run.id);
    await f.manager.resume(run.id);
    f.manager.stop();
    const manager = await f.restart();
    for (let visit = 1; visit <= 2; visit++) {
      const waiting = await f.ports.runs.get(run.id);
      if (!waiting?.waiting) throw new Error('fixture did not park');
      await manager.signal(run.id, 'next', waiting.waiting.waitId, { visit });
      await manager.waitForIdle();
    }
    const record = await f.ports.runs.get(run.id);
    expect(record?.status).toBe(cap === null ? 'waiting' : 'failed');
    expect(record?.failure?.code).toBe(cap === null ? undefined : 'MAX_NODE_VISITS');
    expect(
      f.ports.events
        .all(run.id)
        .flatMap((event) =>
          event.type === 'node.started' && event.nodeId === 'wait' ? [event.attempt] : [],
        ),
    ).toEqual(cap === null ? [1, 2, 1, 2, 1] : [1, 2, 1, 2]);
    expect((await manager.getThread(run.id))?.counters.nodeVisits.wait).toBe(cap === null ? 5 : 4);
    if (cap === null) await manager.cancel(run.id);
  },
);

it.each(['before', 'after'] as const)(
  'a fresh-start append rejected %s commit retains the durable visit count',
  async (when) => {
    let rejected = false;
    const f = await fixture(
      waitCycle(2),
      (ports) =>
        new (class extends InMemoryEventStore {
          override async append(
            id: string,
            drafts: readonly EventDraft[],
            options?: { expectedLastSeq?: number; requireRun?: boolean },
          ): Promise<RunEvent[]> {
            if (
              !rejected &&
              drafts.some(
                (event) =>
                  event.type === 'node.started' && event.nodeId === 'wait' && event.attempt === 1,
              ) &&
              this.all(id).some(
                (event) => event.type === 'node.finished' && event.nodeId === 'wait',
              )
            ) {
              rejected = true;
              if (when === 'after') await super.append(id, drafts, options);
              throw new RunFailureError('SECRET_MISSING', 'controlled append refusal', {
                resumable: true,
              });
            }
            return super.append(id, drafts, options);
          }
        })(ports.clock),
    );
    const run = await f.manager.startRun({
      ownerId: 'local',
      loopId: f.loopId,
      source: 'manual.api',
    });
    await f.manager.waitForIdle();
    const first = await f.ports.runs.get(run.id);
    if (!first?.waiting) throw new Error('fixture did not park');
    await f.manager.signal(run.id, 'next', first.waiting.waitId, {});
    await f.manager.waitForIdle();
    expect((await f.ports.runs.get(run.id))?.failure?.code).toBe('SECRET_MISSING');
    await f.manager.resume(run.id);
    await f.manager.waitForIdle();
    expect((await f.ports.runs.get(run.id))?.status).toBe('waiting');
    const second = await f.ports.runs.get(run.id);
    if (!second?.waiting) throw new Error('fixture did not park');
    await f.manager.signal(run.id, 'next', second.waiting.waitId, {});
    await f.manager.waitForIdle();
    expect((await f.ports.runs.get(run.id))?.failure?.code).toBe('MAX_NODE_VISITS');
    expect(
      f.ports.events
        .all(run.id)
        .flatMap((event) =>
          event.type === 'node.started' && event.nodeId === 'wait' ? [event.attempt] : [],
        ),
    ).toEqual(when === 'before' ? [1, 2, 1, 2] : [1, 2, 1, 2, 3]);
  },
);

it('counts each committed fresh entry within one executor at the exact finite cap', async () => {
  const def = waitCycle(3);
  def.nodes[1] = {
    id: 'wait',
    kind: 'mutate',
    label: 'Work',
    config: {
      operations: [{ op: 'set', path: '/vars/value', value: { kind: 'literal', value: 7 } }],
    },
  };
  const f = await fixture(def);
  const run = await f.manager.startRun({
    ownerId: 'local',
    loopId: f.loopId,
    source: 'manual.api',
  });
  await f.manager.waitForIdle();
  expect((await f.ports.runs.get(run.id))?.failure).toMatchObject({
    code: 'MAX_NODE_VISITS',
    nodeId: 'wait',
    details: { maxNodeVisits: 3 },
    resumable: false,
  });
  expect(
    f.ports.events
      .all(run.id)
      .flatMap((event) =>
        event.type === 'node.started' && event.nodeId === 'wait' ? [event.attempt] : [],
      ),
  ).toEqual([1, 1, 1]);
  expect((await f.manager.getThread(run.id))?.vars.value).toBe(7);
});
