/**
 * Awaited subloops across real process death (#242). The built API (`dist/main.js`) runs in a
 * disposable data directory; it is killed with SIGKILL around child completion and started again
 * on the same store, and every parent must continue exactly once. Two interruptions are also
 * constructed durably (a child finished while nothing was running, and a parent whose wake is
 * durable but whose status write never happened) and recovered by the built API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { RunManager } from '@graphgoblin/engine';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from '@graphgoblin/engine/testing';
import {
  openDatabase,
  SqliteEventStore,
  SqliteLoopRepository,
  SqliteRunRepository,
  SqliteTriggerAdmission,
} from '@graphgoblin/infrastructure/sqlite';
import { createApiProcessFixture, eventually } from './testing/api-subprocess.js';

const fixtures: Awaited<ReturnType<typeof createApiProcessFixture>>[] = [];
afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.dispose();
}, 60_000);

const leafLoop: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Restart leaf',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'leaf?' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.ask.value' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
    { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
  ],
};

/** start -> sub (awaits `childLoopId`) -> after -> done. */
function parentLoop(name: string, childLoopId: string): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: childLoopId } } },
      {
        id: 'after',
        kind: 'mutate',
        label: 'After',
        config: {
          operations: [{ op: 'set', path: '/vars/after', value: { kind: 'literal', value: true } }],
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { returns: '{ "child": outputs.sub.value.result, "after": vars.after }' },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'after' } },
      { id: 'e3', from: { node: 'after', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

type Api = ReturnType<Awaited<ReturnType<typeof createApiProcessFixture>>['run']>;

async function boot() {
  const f = await createApiProcessFixture();
  fixtures.push(f);
  const token = await f.createKey();
  const origin = `http://127.0.0.1:${f.port}`;
  const authorization = `Bearer ${token}`;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(origin + path, {
      method,
      ...(body !== undefined
        ? {
            headers: { authorization, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : { headers: { authorization } }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const api = {
    f,
    token,
    call,
    async start(): Promise<Api> {
      const child = f.run();
      await f.ready(child, token);
      return child;
    },
    run: (id: string) => call<RunRecord>('GET', `/runs/${id}`),
    async events(id: string): Promise<RunEvent[]> {
      return (await call<{ items: RunEvent[] }>('GET', `/runs/${id}/events?limit=500`)).items;
    },
    async children(id: string): Promise<RunRecord[]> {
      return (await call<{ items: RunRecord[] }>('GET', `/runs?parent=${id}`)).items;
    },
  };
  return api;
}

/** One continuation of a parent: one wake, one child completion, its own work and exit once. */
async function expectOneContinuation(
  api: Awaited<ReturnType<typeof boot>>,
  runId: string,
): Promise<RunEvent[]> {
  const events = await api.events(runId);
  const count = (match: (event: RunEvent) => boolean) => events.filter(match).length;
  expect(count((event) => event.type === 'child_run.started')).toBe(1);
  expect(count((event) => event.type === 'run.woken')).toBe(1);
  expect(count((event) => event.type === 'child_run.finished')).toBe(1);
  expect(count((event) => event.type === 'node.finished' && event.nodeId === 'after')).toBe(1);
  expect(count((event) => event.type === 'run.finished')).toBe(1);
  return events;
}

const recoveredStarts = (events: RunEvent[]) =>
  events.filter((event) => event.type === 'run.started' && event.attempt > 1).length;

describe('awaited subloops across process death (#242)', () => {
  it('a hard kill around child completion leaves every parent one continuation after restart', async () => {
    const api = await boot();
    let server = await api.start();
    const publish = async (definition: LoopDefinitionInput) => {
      const { loop } = await api.call<{ loop: { id: string } }>('POST', '/loops', { definition });
      await api.call('POST', `/loops/${loop.id}/publish`);
      return loop.id;
    };
    const leaf = await publish(leafLoop);
    const middle = await publish(parentLoop('Restart middle', leaf));
    const top = await publish(parentLoop('Restart top', middle));
    const landings: string[] = [];
    // Delays after the leaf's input was accepted; `undefined` kills without awaiting the answer.
    for (const delay of [undefined, 0, 10, 30, 60, 100, 150, 250]) {
      const { run } = await api.call<{ run: RunRecord }>('POST', `/loops/${top}/runs`, {});
      let bottom: RunRecord | undefined;
      let mid: RunRecord | undefined;
      await eventually(async () => {
        [mid] = await api.children(run.id);
        [bottom] = mid ? await api.children(mid.id) : [];
        return bottom?.status === 'waiting';
      });
      const answer = api.call('POST', `/runs/${bottom!.id}/input`, {
        waitId: bottom!.waiting!.waitId,
        input: `trial-${String(delay)}`,
      });
      if (delay === undefined) void answer.catch(() => undefined);
      else {
        await answer;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      server.child.kill('SIGKILL');
      await server.waitForExit();
      server = await api.start();
      // An answer lost with the process is given again, as an operator would.
      const leafAfter = await api.run(bottom!.id);
      if (leafAfter.status === 'waiting')
        await api.call('POST', `/runs/${bottom!.id}/input`, {
          waitId: leafAfter.waiting!.waitId,
          input: `trial-${String(delay)}`,
        });
      await eventually(async () => (await api.run(run.id)).status === 'succeeded');
      expect(await api.run(bottom!.id)).toMatchObject({ status: 'succeeded' });
      expect(await api.run(run.id)).toMatchObject({
        result: { child: { child: `trial-${String(delay)}`, after: true }, after: true },
      });
      const topEvents = await expectOneContinuation(api, run.id);
      const midEvents = await expectOneContinuation(api, mid!.id);
      landings.push(
        `delay ${String(delay)}: leaf ${leafAfter.status} at restart; recovery restarts top ${recoveredStarts(topEvents)}, middle ${recoveredStarts(midEvents)}, leaf ${recoveredStarts(await api.events(bottom!.id))}`,
      );
    }
    // Where each kill landed, as evidence of the windows covered.
    process.stdout.write(`subloop kill landings:\n${landings.join('\n')}\n`);
    await server.dispose();
  }, 180_000);

  it.each(['child finished while down', 'parent interrupted mid-wake'] as const)(
    'the built API recovers a %s with one continuation per parent',
    async (state) => {
      const api = await boot();
      // A process over the same store that dies at a constructed point: its durable writes stay.
      const handle = openDatabase({ url: api.f.env.GG_DB_URL! });
      await handle.migrate();
      const fake = createFakePorts();
      const events = new SqliteEventStore(handle.db, fake.clock);
      const runs = new SqliteRunRepository(handle.db);
      const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
      const manager = new RunManager(
        { ...fake, events, runs, loops, admission: new SqliteTriggerAdmission(handle.db, events) },
        DEFAULT_TEST_SETTINGS,
      );
      await manager.start();
      const publish = async (definition: LoopDefinitionInput) => {
        const { loop } = await loops.create('local', LoopDefinitionSchema.parse(definition));
        await loops.publish(loop.id);
        return loop.id;
      };
      const leaf = await publish(leafLoop);
      const middle = await publish(parentLoop('Constructed middle', leaf));
      const top = await publish(parentLoop('Constructed top', middle));
      const run = await manager.startRun({ ownerId: 'local', loopId: top, source: 'manual.api' });
      let mid: RunRecord | undefined;
      let bottom: RunRecord | undefined;
      await vi.waitFor(async () => {
        [mid] = await runs.listChildren(run.id);
        [bottom] = mid ? await runs.listChildren(mid.id) : [];
        expect(bottom?.status).toBe('waiting');
      });
      let stranded = false;
      const hang = () => {
        stranded = true;
        return new Promise<never>(() => undefined);
      };
      if (state === 'child finished while down') {
        // The leaf's terminal status is written; finalization (which tells its parent) never runs.
        const cancel = fake.timers.cancel.bind(fake.timers);
        vi.spyOn(fake.timers, 'cancel').mockImplementation(async (runId, key) =>
          runId === bottom!.id && (await runs.get(runId))?.status === 'succeeded'
            ? hang()
            : cancel(runId, key),
        );
      } else {
        // The middle run's wake is durable; its waiting-to-running status write never happens.
        const transition = runs.transition.bind(runs);
        vi.spyOn(runs, 'transition').mockImplementation((id, from, changes, ...rest) =>
          id === mid!.id && changes.status === 'running' && from.includes('waiting')
            ? hang()
            : transition(id, from, changes, ...rest),
        );
      }
      await manager.provideInput(bottom!.id, bottom!.waiting!.waitId, state);
      await vi.waitFor(() => expect(stranded).toBe(true));
      manager.stop();
      expect((await runs.get(mid!.id))?.status).toBe('waiting');
      const durableWakes = (await events.read(mid!.id)).filter((e) => e.type === 'run.woken');
      expect(durableWakes).toHaveLength(state === 'child finished while down' ? 0 : 1);
      handle.close();
      vi.restoreAllMocks();

      const server = await api.start();
      await eventually(async () => (await api.run(run.id)).status === 'succeeded');
      expect(await api.run(run.id)).toMatchObject({
        result: { child: { child: state, after: true }, after: true },
      });
      await expectOneContinuation(api, run.id);
      await expectOneContinuation(api, mid!.id);
      // A second restart finds nothing left to continue.
      server.child.kill('SIGKILL');
      await server.waitForExit();
      const again = await api.start();
      await expectOneContinuation(api, run.id);
      await expectOneContinuation(api, mid!.id);
      await again.dispose();
    },
    120_000,
  );
});
