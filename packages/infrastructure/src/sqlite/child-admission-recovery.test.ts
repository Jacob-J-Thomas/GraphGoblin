/**
 * One durable child per subloop visit across the creation boundary (#320). A run manager over a
 * real SQLite file stops at a constructed point around a child's creation (its admission port or
 * event store never returns, as if the process had died there); the handle is closed, the file is
 * reopened, and a new run manager recovers. Every parent must end with exactly one child per
 * visit, linked from its log, and continue exactly once.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type LoopDefinitionInput,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import {
  RunManager,
  type EventDraft,
  type EventStorePort,
  type RunAdmission,
  type TriggerAdmissionPort,
  type WebhookClaim,
} from '@graphgoblin/engine';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from '@graphgoblin/engine/testing';
import { openDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteTriggerAdmission } from './admission.js';

const never = () => new Promise<never>(() => undefined);

/** The admission port of a process that dies once `dies` matches a committed admission. */
class DyingAdmission implements TriggerAdmissionPort {
  died = false;
  constructor(
    private readonly inner: TriggerAdmissionPort,
    private readonly dies: (input: RunAdmission) => boolean,
    private readonly phase: 'before' | 'after' = 'after',
  ) {}
  get events() {
    return this.inner.events;
  }
  async create(input: RunAdmission, receiptId?: string): Promise<RunRecord> {
    if (this.phase === 'before' && this.dies(input)) {
      this.died = true;
      return never();
    }
    const run = await this.inner.create(input, receiptId);
    if (!this.dies(input)) return run;
    this.died = true;
    return never();
  }
  createPollItem(input: RunAdmission) {
    return this.inner.createPollItem(input);
  }
  claim(input: WebhookClaim, intent: RunAdmission) {
    return this.inner.claim(input, intent);
  }
  get(id: string) {
    return this.inner.get(id);
  }
  due(now: string, limit: number) {
    return this.inner.due(now, limit);
  }
  failed(...args: Parameters<TriggerAdmissionPort['failed']>) {
    return this.inner.failed(...args);
  }
  hasPendingPin(loopId: string) {
    return this.inner.hasPendingPin(loopId);
  }
}

/** The event store of a process that dies before an append matching `dies` is written. */
class DyingEvents implements EventStorePort {
  died = false;
  constructor(
    private readonly inner: EventStorePort,
    private readonly dies: (runId: string, draft: EventDraft) => boolean,
  ) {}
  append(runId: string, drafts: readonly EventDraft[], options?: { expectedLastSeq?: number }) {
    if (drafts.some((draft) => this.dies(runId, draft))) {
      this.died = true;
      return never();
    }
    return this.inner.append(runId, drafts, options);
  }
  read(runId: string, afterSeq?: number, limit?: number) {
    return this.inner.read(runId, afterSeq, limit);
  }
  subscribe(runId: string, listener: (event: RunEvent) => void) {
    return this.inner.subscribe(runId, listener);
  }
}

const childLoop: LoopDefinitionInput = {
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Creation child',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"child output"' } },
  ],
  edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
};

const parentLoop = (childLoopId: string): LoopDefinitionInput => ({
  schemaVersion: CURRENT_DEFINITION_FORMAT,
  name: 'Creation parent',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: childLoopId } } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.sub.value.result' } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
    { id: 'e2', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
  ],
});

const directories: string[] = [];
const open: { handle: DatabaseHandle; manager?: RunManager }[] = [];
afterEach(async () => {
  for (const { handle, manager } of open.splice(0)) {
    manager?.stop();
    handle.close();
  }
  // Windows can retain libsql's file handles briefly after close; retry cleanup as in db tests.
  globalThis.gc?.();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** One "process" over the store file: its own handle, ports and run manager. */
async function processOver(
  url: string,
  wrap: {
    admission?: (inner: TriggerAdmissionPort) => TriggerAdmissionPort;
    events?: (inner: EventStorePort) => EventStorePort;
  } = {},
) {
  const handle = openDatabase({ url });
  await handle.migrate();
  const fake = createFakePorts();
  const stored = new SqliteEventStore(handle.db, fake.clock);
  const events = wrap.events ? wrap.events(stored) : stored;
  const sqliteAdmission = new SqliteTriggerAdmission(handle.db, stored);
  const admission = wrap.admission ? wrap.admission(sqliteAdmission) : sqliteAdmission;
  const runs = new SqliteRunRepository(handle.db);
  const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
  const manager = new RunManager(
    { ...fake, events, runs, loops, admission },
    DEFAULT_TEST_SETTINGS,
  );
  const entry: { handle: DatabaseHandle; manager?: RunManager } = { handle, manager };
  open.push(entry);
  return {
    manager,
    runs,
    events: stored,
    loops,
    /** The process dies: nothing more is scheduled and its connection goes away. */
    die() {
      manager.stop();
      handle.close();
      open.splice(open.indexOf(entry), 1);
    },
  };
}

async function storeUrl(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-d1-sqlite-'));
  directories.push(directory);
  return `file:${join(directory, 'graphgoblin.db').replaceAll('\\', '/')}`;
}

async function publishLoops(loops: SqliteLoopRepository, definition = childLoop) {
  const publish = async (definition: LoopDefinitionInput) => {
    const { loop } = await loops.create('local', LoopDefinitionSchema.parse(definition));
    await loops.publish(loop.id);
    return loop.id;
  };
  const child = await publish(definition);
  return publish(parentLoop(child));
}

/** Recover in a fresh process and return the parent's final state, children and log. */
async function recover(url: string, parentId: string) {
  const next = await processOver(url);
  await next.manager.start();
  await vi.waitFor(async () => expect((await next.runs.get(parentId))?.status).toBe('succeeded'), {
    timeout: 10_000,
  });
  await next.manager.waitForIdle();
  const parent = (await next.runs.get(parentId))!;
  const children = await next.runs.listChildren(parentId);
  const log = await next.events.read(parentId);
  return { parent, children, log };
}

/**
 * Wait until the child's own work in the dying process is over (terminal and finalized), so the
 * only thing interrupted is the parent's constructed point, not an unrelated child write.
 */
async function childSettled(runs: SqliteRunRepository, parentId: string): Promise<RunRecord> {
  let settled: RunRecord | undefined;
  await vi.waitFor(
    async () => {
      [settled] = await runs.listChildren(parentId);
      const pending = (await runs.listRecoveryCandidates()).map((candidate) => candidate.id);
      expect(settled?.status).toBe('succeeded');
      expect(pending).not.toContain(settled!.id);
    },
    { timeout: 10_000 },
  );
  return settled!;
}

const linksIn = (log: RunEvent[]) =>
  log.filter(
    (event): event is Extract<RunEvent, { type: 'child_run.started' }> =>
      event.type === 'child_run.started',
  );

describe('child creation across a process death (#320)', () => {
  it('a death before child admission leaves neither child nor link and recovery admits one', async () => {
    const url = await storeUrl();
    let admission: DyingAdmission | undefined;
    const first = await processOver(url, {
      admission: (inner) =>
        (admission = new DyingAdmission(
          inner,
          (input) => input.run.parentRunId !== undefined,
          'before',
        )),
    });
    await first.manager.start();
    const loopId = await publishLoops(first.loops);
    const parent = await first.manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await vi.waitFor(() => expect(admission?.died).toBe(true), { timeout: 10_000 });
    expect(await first.runs.listChildren(parent.id)).toEqual([]);
    expect(linksIn(await first.events.read(parent.id))).toEqual([]);
    first.die();
    const { children, log } = await recover(url, parent.id);
    expect(children).toHaveLength(1);
    expect(linksIn(log).map((event) => event.childRunId)).toEqual([children[0]!.id]);
  });

  it('re-parks on the admitted child when it still needs input after restart', async () => {
    const url = await storeUrl();
    let admission: DyingAdmission | undefined;
    const first = await processOver(url, {
      admission: (inner) =>
        (admission = new DyingAdmission(inner, (input) => input.run.parentRunId !== undefined)),
    });
    await first.manager.start();
    const inputChild: LoopDefinitionInput = {
      ...childLoop,
      nodes: [
        childLoop.nodes[0]!,
        { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'continue?' } },
        childLoop.nodes[1]!,
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
        { id: 'b', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
      ],
    };
    const loopId = await publishLoops(first.loops, inputChild);
    const parent = await first.manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await vi.waitFor(() => expect(admission?.died).toBe(true), { timeout: 10_000 });
    const [child] = await first.runs.listChildren(parent.id);
    first.die();
    const next = await processOver(url);
    await next.manager.start();
    await next.manager.waitForIdle();
    expect((await next.runs.get(parent.id))?.waiting).toMatchObject({
      kind: 'child',
      childRunId: child!.id,
    });
    const waiting = (await next.runs.get(child!.id))!;
    expect(waiting.status).toBe('waiting');
    await next.manager.provideInput(child!.id, waiting.waiting!.waitId, 'answer');
    await next.manager.waitForIdle();
    expect((await next.runs.get(parent.id))?.status).toBe('succeeded');
    expect((await next.runs.listChildren(parent.id)).map((run) => run.id)).toEqual([child!.id]);
  });

  it('a death right after the child is admitted recovers that child, never a second one', async () => {
    const url = await storeUrl();
    let admission: DyingAdmission | undefined;
    const first = await processOver(url, {
      admission: (inner) => {
        admission = new DyingAdmission(inner, (input) => input.run.parentRunId !== undefined);
        return admission;
      },
    });
    await first.manager.start();
    const parentLoopId = await publishLoops(first.loops);
    const parent = await first.manager.startRun({
      ownerId: 'local',
      loopId: parentLoopId,
      source: 'manual.api',
    });
    await vi.waitFor(() => expect(admission?.died).toBe(true), { timeout: 10_000 });
    const [admitted] = await first.runs.listChildren(parent.id);
    first.die();

    const { parent: done, children, log } = await recover(url, parent.id);
    expect(children.map((child) => child.id)).toEqual([admitted!.id]);
    expect(children[0]).toMatchObject({ status: 'succeeded', parentRunId: parent.id });
    expect(linksIn(log).map((event) => event.childRunId)).toEqual([admitted!.id]);
    expect(done.result).toBe('child output');
  });

  it('a failure to record the link leaves no child, and the resumed visit admits exactly one', async () => {
    const url = await storeUrl();
    const first = await processOver(url);
    await first.manager.start();
    const parentLoopId = await publishLoops(first.loops);
    // A real storage fault inside SQLite: recording the parent's link is refused.
    const handle = open.at(-1)!.handle;
    await handle.client.execute(
      "CREATE TRIGGER refuse_link BEFORE INSERT ON run_events WHEN NEW.type = 'child_run.started' BEGIN SELECT RAISE(ABORT, 'injected link failure'); END",
    );
    const parent = await first.manager.startRun({
      ownerId: 'local',
      loopId: parentLoopId,
      source: 'manual.api',
    });
    await vi.waitFor(async () => expect((await first.runs.get(parent.id))?.status).toBe('failed'), {
      timeout: 10_000,
    });
    expect(await first.runs.listChildren(parent.id)).toEqual([]);
    await handle.client.execute('DROP TRIGGER refuse_link');
    first.die();

    const next = await processOver(url);
    await next.manager.start();
    await next.manager.resume(parent.id);
    await vi.waitFor(
      async () => expect((await next.runs.get(parent.id))?.status).toBe('succeeded'),
      { timeout: 10_000 },
    );
    await next.manager.waitForIdle();
    const children = await next.runs.listChildren(parent.id);
    expect(children).toHaveLength(1);
    expect(linksIn(await next.events.read(parent.id)).map((event) => event.childRunId)).toEqual([
      children[0]!.id,
    ]);
  });

  it('a death after the link and before the park re-parks on the same child', async () => {
    const url = await storeUrl();
    let events: DyingEvents | undefined;
    const first = await processOver(url, {
      events: (inner) => {
        events = new DyingEvents(inner, (_runId, draft) => draft.type === 'run.waiting');
        return events;
      },
    });
    await first.manager.start();
    const parentLoopId = await publishLoops(first.loops);
    const parent = await first.manager.startRun({
      ownerId: 'local',
      loopId: parentLoopId,
      source: 'manual.api',
    });
    await vi.waitFor(() => expect(events?.died).toBe(true), { timeout: 10_000 });
    const admitted = await childSettled(first.runs, parent.id);
    first.die();

    const { children, log } = await recover(url, parent.id);
    expect(children.map((child) => child.id)).toEqual([admitted.id]);
    expect(linksIn(log)).toHaveLength(1);
    expect(log.filter((event) => event.type === 'child_run.finished')).toHaveLength(1);
  });

  it('a death before the atomic child and parent finish stores neither and recovers once', async () => {
    const url = await storeUrl();
    let events: DyingEvents | undefined;
    let parentId = '';
    const first = await processOver(url, {
      events: (inner) => {
        events = new DyingEvents(
          inner,
          (runId, draft) =>
            runId === parentId && draft.type === 'node.finished' && draft.nodeId === 'sub',
        );
        return events;
      },
    });
    await first.manager.start();
    const parentLoopId = await publishLoops(first.loops);
    const parent = await first.manager.startRun({
      ownerId: 'local',
      loopId: parentLoopId,
      source: 'manual.api',
    });
    parentId = parent.id;
    await vi.waitFor(() => expect(events?.died).toBe(true), { timeout: 10_000 });
    await childSettled(first.runs, parent.id);
    const before = await first.events.read(parent.id);
    expect(before.filter((event) => event.type === 'child_run.finished')).toHaveLength(0);
    expect(
      before.filter((event) => event.type === 'node.finished' && event.nodeId === 'sub'),
    ).toHaveLength(0);
    first.die();

    const { log, children } = await recover(url, parent.id);
    expect(children).toHaveLength(1);
    const finishes = log.filter((event) => event.type === 'child_run.finished');
    expect(finishes).toHaveLength(1);
    expect(log.find((event) => event.seq === finishes[0]!.seq + 1)).toMatchObject({
      type: 'node.finished',
      nodeId: 'sub',
    });
    expect(log.filter((event) => event.type === 'run.finished')).toHaveLength(1);
  });
});
