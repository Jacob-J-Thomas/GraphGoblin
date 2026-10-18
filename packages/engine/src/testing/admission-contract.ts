import type { ContextThread, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
import { type RunAdmission, type TriggerAdmissionPort, type WebhookClaim } from '../admission.js';
import { createInitialThread } from '../thread.js';
import {
  FakeClock,
  FakeIds,
  InMemoryEventStore,
  InMemoryRunRepository,
  InMemoryTriggerAdmission,
  type AdmissionWrite,
} from './fakes.js';

/** The adapter supplies storage and fault injection; assertions and scenarios are shared. */
export interface AdmissionContractFixture {
  admission: TriggerAdmissionPort;
  run(id: string): Promise<RunRecord | undefined>;
  thread(id: string): Promise<ContextThread | undefined>;
  events(id: string): Promise<RunEvent[]>;
  inbound(id: string): Promise<WebhookClaim['inbound'] | undefined>;
  subscribe(id: string, listener: (event: RunEvent) => void): () => void;
  failAt(write: AdmissionWrite | undefined): Promise<void>;
  /** Preserve a historical inbound claim and its endpoint provenance, with no receipt/run. */
  preserveInbound(input: WebhookClaim): Promise<void>;
  close(): void | Promise<void>;
}
export type AdmissionContractFactory = () => Promise<AdmissionContractFixture>;

export function createFakeAdmissionFixture(): Promise<AdmissionContractFixture> {
  const runs = new InMemoryRunRepository();
  const events = new InMemoryEventStore(new FakeClock());
  let failure: AdmissionWrite | undefined;
  const admission = new InMemoryTriggerAdmission(runs, events, (write) => {
    if (write === failure) throw new Error('injected admission write failure');
  });
  return Promise.resolve<AdmissionContractFixture>({
    admission,
    run: (id) => runs.get(id),
    thread: (id) => runs.getInitialThread(id),
    events: (id) => events.read(id),
    inbound: (id) => Promise.resolve(structuredClone(admission.inbound.get(id))),
    subscribe: (id, listener) => events.subscribe(id, listener),
    failAt(write) {
      failure = write;
      return Promise.resolve();
    },
    preserveInbound(input) {
      admission.inbound.set(input.inbound.id, structuredClone(input.inbound));
      admission.inboundScopes.set(input.inbound.id, {
        ownerId: input.ownerId,
        loopId: input.loopId,
        triggerNodeId: input.triggerNodeId,
      });
      return Promise.resolve();
    },
    close() {},
  });
}

function equal(actual: unknown, expected: unknown): void {
  if (stableStringify(actual) !== stableStringify(expected))
    throw new Error(
      `Admission contract mismatch: ${stableStringify(actual)} != ${stableStringify(expected)}`,
    );
}
async function rejects(work: () => unknown): Promise<void> {
  let rejected = false;
  try {
    await work();
  } catch {
    rejected = true;
  }
  equal(rejected, true);
}

function inputs() {
  const ids = new FakeIds();
  const now = new FakeClock().now().toISOString();
  const run: RunRecord = {
    id: ids.next(),
    ownerId: 'owner',
    loopId: ids.next(),
    versionId: ids.next(),
    invocationId: ids.next(),
    status: 'queued',
    iteration: 1,
    createdAt: now,
    lastEventSeq: 0,
  };
  const childId = ids.next();
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'webhook',
      trigger: {
        nodeId: 'hook',
        kind: 'webhook',
        payload: { a: 1, b: 2 },
        receivedAt: now,
        dedupeKey: 'business',
      },
    },
  });
  const intent: RunAdmission = {
    run,
    initialThread,
    queued: { type: 'run.queued', initialThread, subloopVersions: { [childId]: ids.next() } },
    pinnedLoopIds: [run.loopId, childId],
  };
  const claim: WebhookClaim = {
    id: ids.next(),
    ownerId: run.ownerId,
    loopId: run.loopId,
    triggerNodeId: 'hook',
    contentHash: 'a'.repeat(64),
    inbound: {
      id: ids.next(),
      ownerId: run.ownerId,
      type: 'webhook',
      payload: { a: 1, b: 2 },
      dedupeKey: 'business',
      source: 'webhook:endpoint',
      receivedAt: now,
      runIds: [],
    },
  };
  return { intent, claim, ids, childId, now };
}

type Scenario = { name: string; run(fixture: AdmissionContractFixture): Promise<void> };
const scenarios: Scenario[] = [
  {
    name: 'historical inbound-only keys are permanent across versions and isolated by owner/loop/node',
    async run(f) {
      const { claim, intent, ids } = inputs();
      claim.inbound.receivedAt = '2000-01-01T00:00:00.000Z';
      await f.preserveInbound(claim);
      intent.run.versionId = ids.next();
      intent.initialThread.run.versionId = intent.run.versionId;
      const next = {
        ...claim,
        id: ids.next(),
        inbound: { ...claim.inbound, id: ids.next(), receivedAt: '2099-01-01T00:00:00.000Z' },
      };
      equal((await f.admission.claim(next, intent)).receipt.status, 'deduplicated');
      equal(await f.run(intent.run.id), undefined);
      for (const dimension of ['ownerId', 'loopId', 'triggerNodeId'] as const) {
        const other = {
          ...next,
          id: ids.next(),
          inbound: { ...next.inbound, id: ids.next() },
          [dimension]: dimension === 'triggerNodeId' ? 'other-hook' : ids.next(),
        };
        other.inbound.ownerId = other.ownerId;
        const scoped = structuredClone(intent);
        scoped.run.ownerId = other.ownerId;
        scoped.run.loopId = other.loopId;
        scoped.initialThread.run.loopId = other.loopId;
        scoped.initialThread.invocation.trigger.nodeId = other.triggerNodeId;
        scoped.pinnedLoopIds = [other.loopId];
        equal((await f.admission.claim(other, scoped)).receipt.status, 'pending');
      }
    },
  },
  {
    name: 'racing explicit keys have one pending intent and permanent failure does not reopen the key',
    async run(f) {
      const { claim, intent, ids } = inputs();
      const next = { ...claim, id: ids.next(), inbound: { ...claim.inbound, id: ids.next() } };
      const claimed = await Promise.all([
        f.admission.claim(claim, intent),
        f.admission.claim(next, intent),
      ]);
      equal(claimed.map((value) => value.receipt.status).sort(), ['deduplicated', 'pending']);
      const pending = claimed.find((value) => value.receipt.status === 'pending')!;
      await f.admission.failed(pending.receipt.id, 'WEBHOOK_INTENT_CONFLICT');
      intent.run.versionId = ids.next();
      intent.initialThread.run.versionId = intent.run.versionId;
      const repeat = {
        ...claim,
        id: ids.next(),
        inbound: { ...claim.inbound, id: ids.next(), receivedAt: '2099-01-01T00:00:00.000Z' },
      };
      equal((await f.admission.claim(repeat, intent)).receipt.status, 'deduplicated');
    },
  },
  {
    name: 'ordinary create is atomic, canonical and idempotent; notification follows commit',
    async run(f) {
      const { intent } = inputs();
      intent.initialThread.invocation.source = 'manual.api';
      intent.initialThread.invocation.trigger.kind = 'manual';
      const notifications: RunEvent[] = [];
      f.subscribe(intent.run.id, (event) => {
        notifications.push(event);
        throw new Error('listener');
      });
      const run = await f.admission.create(intent);
      equal(run.lastEventSeq, 1);
      equal(await f.thread(run.id), intent.initialThread);
      equal(await f.events(run.id), notifications);
      const reordered = structuredClone(intent);
      reordered.initialThread.invocation.trigger.payload = { b: 2, a: 1 };
      equal(await f.admission.create(reordered), run);
      equal(notifications.length, 1);
      reordered.initialThread.vars = { changed: true };
      await rejects(() => f.admission.create(reordered));
      equal(await f.thread(run.id), intent.initialThread);
    },
  },
  ...(['claim.inbound', 'claim.receipt'] as const).map((write): Scenario => ({
    name: `claim rollback at ${write} leaves no inbound, receipt, pin or key`,
    async run(f) {
      const { intent, claim, childId } = inputs();
      await f.failAt(write);
      await rejects(() => f.admission.claim(claim, intent));
      equal(await f.admission.get(claim.id), undefined);
      equal(await f.inbound(claim.inbound.id), undefined);
      equal(await f.admission.hasPendingPin(childId), false);
      equal(await f.admission.due(claim.inbound.receivedAt, 5), []);
      await f.failAt(undefined);
      equal((await f.admission.claim(claim, intent)).receipt.status, 'pending');
    },
  })),
  ...(['create.run', 'create.event', 'create.receipt', 'create.link'] as const).map(
    (write): Scenario => ({
      name: `create rollback at ${write} preserves the complete pending intent and same-ID recovery`,
      async run(f) {
        const { intent, claim, childId } = inputs();
        const claimed = await f.admission.claim(claim, intent);
        const notifications: RunEvent[] = [];
        const observed: Promise<void>[] = [];
        f.subscribe(intent.run.id, (event) => {
          notifications.push(event);
          observed.push(
            (async () => {
              equal((await f.admission.get(claim.id))?.status, 'admitted');
              equal((await f.inbound(claim.inbound.id))?.runIds, [intent.run.id]);
              equal((await f.run(intent.run.id))?.lastEventSeq, 1);
            })(),
          );
        });
        await f.failAt(write);
        await rejects(() => f.admission.create(intent, claim.id));
        equal(await f.run(intent.run.id), undefined);
        equal(await f.thread(intent.run.id), undefined);
        equal(await f.events(intent.run.id), []);
        equal(await f.admission.get(claim.id), claimed.receipt);
        equal((await f.inbound(claim.inbound.id))?.runIds, []);
        equal(await f.admission.hasPendingPin(childId), true);
        equal(notifications, []);
        await f.failAt(undefined);
        const stored = (await f.admission.get(claim.id))!;
        const admitted = await f.admission.create(stored.intent!, stored.id);
        equal(admitted.id, intent.run.id);
        equal(await f.admission.hasPendingPin(childId), false);
        equal(await f.admission.create(stored.intent!, stored.id), admitted);
        equal(notifications.length, 1);
        await Promise.all(observed);
      },
    }),
  ),
  {
    name: 'claim validates owner, immutable intent, keys and pins before any writes',
    async run(f) {
      const { intent, claim } = inputs();
      const other = structuredClone(claim);
      other.ownerId = 'other';
      await rejects(() => f.admission.claim(other, intent));
      const malformed = structuredClone(intent);
      malformed.pinnedLoopIds = [];
      await rejects(() => f.admission.claim(claim, malformed));
      equal(await f.admission.get(claim.id), undefined);
      equal(await f.inbound(claim.inbound.id), undefined);
      await f.admission.claim(claim, intent);
      const changed = structuredClone(intent);
      changed.initialThread.invocation.trigger.dedupeKey = 'changed';
      await rejects(() => f.admission.create(changed, claim.id));
      equal(await f.run(intent.run.id), undefined);
    },
  },
  {
    name: 'claim freezes caller objects and identical keyed content gets a distinct deduplicated receipt',
    async run(f) {
      const { intent, claim, ids } = inputs();
      const expected = structuredClone(intent);
      const first = await f.admission.claim(claim, intent);
      intent.pinnedLoopIds.push(ids.next());
      intent.initialThread.vars = { changed: true };
      claim.inbound.payload = 'changed';
      equal((await f.admission.get(first.receipt.id))?.intent, expected);
      claim.inbound.payload = { a: 1, b: 2 };
      const duplicate = await f.admission.claim(
        { ...claim, id: ids.next(), inbound: { ...claim.inbound, id: ids.next() } },
        expected,
      );
      equal(duplicate.receipt.status, 'deduplicated');
      equal(duplicate.receipt.id === first.receipt.id, false);
    },
  },
  {
    name: 'pending keys reserve across webhook and poll, permanent failure releases poll pins',
    async run(f) {
      const { intent, claim, ids, childId, now } = inputs();
      await f.admission.claim(claim, intent);
      const poll = structuredClone(intent);
      poll.run.id = ids.next();
      poll.initialThread.run.id = poll.run.id;
      poll.initialThread.invocation.source = 'poll';
      poll.initialThread.invocation.trigger.kind = 'poll';
      equal(await f.admission.createPollItem(poll), undefined);
      await f.admission.failed(claim.id, 'WEBHOOK_ADMISSION_RETRY', now);
      equal((await f.admission.get(claim.id))?.attempts, 1);
      equal(await f.admission.createPollItem(poll), undefined);
      await f.admission.failed(claim.id, 'WEBHOOK_INTENT_CONFLICT');
      equal(await f.admission.hasPendingPin(childId), false);
      equal((await f.admission.createPollItem(poll))?.id, poll.run.id);
      equal(await f.admission.createPollItem(poll), undefined);
      const next = {
        ...claim,
        id: ids.next(),
        contentHash: 'b'.repeat(64),
        inbound: { ...claim.inbound, id: ids.next() },
      };
      equal((await f.admission.claim(next, intent)).receipt.status, 'deduplicated');
      equal((await f.admission.get(next.id))?.intent, undefined);
    },
  },
  {
    name: 'concurrent poll candidates consume one key and webhook sees the committed poll',
    async run(f) {
      const { intent, claim, ids } = inputs();
      const webhook = structuredClone(intent);
      intent.initialThread.invocation.source = 'poll';
      intent.initialThread.invocation.trigger.kind = 'poll';
      const second = structuredClone(intent);
      second.run.id = ids.next();
      second.initialThread.run.id = second.run.id;
      const admitted = await Promise.all([
        f.admission.createPollItem(intent),
        f.admission.createPollItem(second),
      ]);
      equal(admitted.filter(Boolean).length, 1);
      equal((await f.admission.claim(claim, webhook)).receipt.status, 'deduplicated');
    },
  },
  {
    name: 'Allow admits identical unkeyed raw bodies as distinct receipts and runs',
    async run(f) {
      const { intent, claim, ids } = inputs();
      delete claim.inbound.dedupeKey;
      delete intent.initialThread.invocation.trigger.dedupeKey;
      const first = await f.admission.claim(claim, intent);
      const second = structuredClone(intent);
      second.run.id = ids.next();
      second.initialThread.run.id = second.run.id;
      second.queued.initialThread = second.initialThread;
      const next = { ...claim, id: ids.next(), inbound: { ...claim.inbound, id: ids.next() } };
      const repeated = await f.admission.claim(next, second);
      equal(repeated.receipt.status, 'pending');
      await f.admission.create(intent, first.receipt.id);
      await f.admission.create(second, repeated.receipt.id);
      equal((await f.inbound(claim.inbound.id))?.runIds, [intent.run.id]);
      equal((await f.inbound(next.inbound.id))?.runIds, [second.run.id]);
      equal((await f.events(intent.run.id)).length, 1);
      equal((await f.events(second.run.id)).length, 1);
    },
  },
  {
    name: 'due selection is deterministic, nonnegative and bounded at five',
    async run(f) {
      const { intent, claim, ids, now } = inputs();
      delete claim.inbound.dedupeKey;
      delete intent.initialThread.invocation.trigger.dedupeKey;
      for (let index = 0; index < 7; index++)
        await f.admission.claim(
          {
            ...claim,
            id: ids.next(),
            contentHash: String(index).repeat(64),
            inbound: { ...claim.inbound, id: ids.next() },
          },
          intent,
        );
      equal((await f.admission.due(now, 100)).length, 5);
      equal(await f.admission.due(now, -1), []);
      equal(await f.admission.due('2020-01-01T00:00:00.000Z', 5), []);
    },
  },
];

/** Register with any test framework; neither this runner nor the engine imports Vitest. */
export function admissionContractCases(factory: AdmissionContractFactory) {
  return scenarios.map((scenario) => ({
    name: scenario.name,
    async run(): Promise<void> {
      const fixture = await factory();
      try {
        await scenario.run(fixture);
      } finally {
        await fixture.close();
      }
    },
  }));
}

/** Also runnable without a test framework, e.g. by an adapter's conformance command. */
export async function runAdmissionContract(factory: AdmissionContractFactory): Promise<string[]> {
  const passed: string[] = [];
  for (const test of admissionContractCases(factory)) {
    await test.run();
    passed.push(test.name);
  }
  return passed;
}
