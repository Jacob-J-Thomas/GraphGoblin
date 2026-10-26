import { describe, expect, it, vi } from 'vitest';
import { FakeHarness } from './testing/fakes.js';
import type { SessionPolicy } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/scenario.js';

function cycle(worker: SessionPolicy, reviewer: SessionPolicy = { policy: 'fresh' }, visits = 2) {
  const def = singleNodeLoop('session cycle', {
    id: 'worker',
    kind: 'inference',
    label: 'Worker',
    config: {
      session: worker,
      prompt: { template: 'worker {{ run.id }}: {{ messages.last.content }}' },
    },
  });
  def.nodes.push(
    {
      id: 'reviewer',
      kind: 'inference',
      label: 'Reviewer',
      config: { session: reviewer, prompt: { template: 'reviewer' } },
    },
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
        maxPasses: visits,
      },
    },
  );
  def.edges = def.edges.filter((e) => e.from.node !== 'worker');
  def.edges.push(
    { id: 'review', from: { node: 'worker', port: 'out' }, to: { node: 'reviewer' } },
    { id: 'gate', from: { node: 'reviewer', port: 'out' }, to: { node: 'again' } },
    { id: 'repeat', from: { node: 'again', port: 'repeat' }, to: { node: 'worker' } },
    { id: 'limit', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
    { id: 'finish', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
  );
  return def;
}

function handles(e: TestEngine, runId: string) {
  return e
    .events(runId)
    .filter((event) => event.type === 'harness.session')
    .map(({ nodeId, sessionId, mode }) => ({ nodeId, sessionId, mode }));
}

describe('node conversations through the public RunManager', () => {
  it('resumes only the worker conversation after reviewer feedback', async () => {
    const e = await createTestEngine();
    const v = e.publish(cycle({ policy: 'resume-own' }));
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('succeeded');
    expect(handles(e, run.id)).toEqual([
      { nodeId: 'worker', sessionId: 'fake-session-1', mode: 'fresh' },
      { nodeId: 'reviewer', sessionId: 'fake-session-2', mode: 'fresh' },
      { nodeId: 'worker', sessionId: 'fake-session-1', mode: 'resumed' },
      { nodeId: 'reviewer', sessionId: 'fake-session-3', mode: 'fresh' },
    ]);
    expect(e.ports.harness.resumed[0]?.request.turn.prompt).toBe(`worker ${run.id}: OK`);
    e.manager.stop();
  });
  it('reproduces resume-previous selecting the reviewer on worker revisit', async () => {
    const e = await createTestEngine();
    const v = e.publish(cycle({ policy: 'resume-previous' }));
    const run = await e.runToIdle(v.loopId);
    expect(run.status).toBe('succeeded');
    expect(handles(e, run.id)).toEqual([
      { nodeId: 'worker', sessionId: 'fake-session-1', mode: 'fresh' },
      { nodeId: 'reviewer', sessionId: 'fake-session-2', mode: 'fresh' },
      { nodeId: 'worker', sessionId: 'fake-session-2', mode: 'resumed' },
      { nodeId: 'reviewer', sessionId: 'fake-session-3', mode: 'fresh' },
    ]);
    e.manager.stop();
  });

  it('reproduces resume-named sharing a conversation with the reviewer and another run', async () => {
    const e = await createTestEngine();
    const policy = { policy: 'resume-named', key: 'shared' } as const;
    const v = e.publish(cycle(policy, policy));
    const first = await e.runToIdle(v.loopId);
    const second = await e.runToIdle(v.loopId);
    for (const run of [first, second]) {
      expect(run.status).toBe('succeeded');
      expect(handles(e, run.id).map((x) => x.sessionId)).toEqual([
        'fake-session-1',
        'fake-session-1',
        'fake-session-1',
        'fake-session-1',
      ]);
    }
    expect(e.ports.harness.started).toHaveLength(1);
    e.manager.stop();
  });
});

describe.each(['codex', 'claude'] as const)('%s own-session isolation', (harness) => {
  async function setup(visits = 2, resetAfterVisits?: number) {
    const e = await createTestEngine();
    const fake = harness === 'codex' ? e.ports.harness : new FakeHarness([], 'claude');
    e.ports.harnesses[harness] = fake;
    if (harness === 'claude')
      e.ports.modelCatalog.entries.push({
        harness: 'claude',
        model: 'claude-opus-5-5',
        source: 'harness',
        displayName: 'Claude',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      });
    const def = cycle(
      { policy: 'resume-own', ...(resetAfterVisits === undefined ? {} : { resetAfterVisits }) },
      { policy: 'resume-own' },
      visits,
    );
    def.settings = { maxNodeVisits: null };
    for (const node of def.nodes)
      if (node.kind === 'inference')
        node.config = {
          ...node.config,
          harness,
          model: harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
          effort: 'low',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
        };
    return { e, fake, v: e.publish(def) };
  }

  it('keeps two parallel runs and both nodes separate', async () => {
    const { e, v } = await setup();
    const runs = await Promise.all([e.start(v.loopId), e.start(v.loopId)]);
    const firstIds: string[] = [];
    for (const run of runs) {
      expect((await e.settle(run.id)).status).toBe('succeeded');
      const events = handles(e, run.id);
      for (const nodeId of ['worker', 'reviewer']) {
        const visits = events.filter((x) => x.nodeId === nodeId);
        expect(visits.map((x) => x.mode)).toEqual(['fresh', 'resumed']);
        expect(visits[1]?.sessionId).toBe(visits[0]?.sessionId);
        firstIds.push(visits[0]!.sessionId);
      }
    }
    expect(new Set(firstIds).size).toBe(4);
    e.manager.stop();
  });

  it('does not inherit the private handle or reset count in a replay fork or child run', async () => {
    const { e, v } = await setup();
    const source = await e.runToIdle(v.loopId);
    const fork = await e.manager.replay({ runId: source.id, nodeId: 'done' });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    const parent = e.publish(
      singleNodeLoop('own-session parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Child',
        config: { loopRef: { loopId: v.loopId } },
      }),
    );
    const parentRun = await e.runToIdle(parent.loopId);
    expect(parentRun.status).toBe('succeeded');
    const child = (await e.ports.runs.listChildren(parentRun.id))[0]!;
    expect(handles(e, fork.id)).toEqual([]);
    const firstIds = [source.id, child.id].map((id) => {
      const first = handles(e, id)[0]!;
      expect(first).toMatchObject({ nodeId: 'worker', mode: 'fresh' });
      const turns = e.events(id).filter((x) => x.type === 'harness.turn');
      expect(turns[0]?.resumeSessionId).toBeUndefined();
      expect(turns[0]?.visitId.startsWith(id + ':')).toBe(true);
      return first.sessionId;
    });
    expect(new Set(firstIds).size).toBe(2);
    e.manager.stop();
  });

  it.each([1, 2, undefined])(
    'honors only the authored reset boundary %s and keeps loop context',
    async (reset) => {
      const count = reset === undefined ? 12 : 5;
      const { e, v } = await setup(count, reset);
      const run = await e.runToIdle(v.loopId);
      expect(run.status).toBe('succeeded');
      const events = handles(e, run.id);
      const worker = events.filter((x) => x.nodeId === 'worker');
      const reviewer = events.filter((x) => x.nodeId === 'reviewer');
      for (let i = 0; i < count; i++) {
        const fresh = i === 0 || (reset !== undefined && i % reset === 0);
        expect(worker[i]?.mode).toBe(fresh ? 'fresh' : 'resumed');
        if (i > 0) expect(worker[i]?.sessionId === worker[i - 1]?.sessionId).toBe(!fresh);
      }
      expect(new Set(reviewer.map((x) => x.sessionId)).size).toBe(1);
      const thread = await e.manager.getThread(run.id);
      expect(thread?.messages.filter((x) => x.nodeId === 'worker')).toHaveLength(count);
      expect(thread?.messages.filter((x) => x.nodeId === 'reviewer')).toHaveLength(count);
      expect(thread?.outputs['worker']?.value).toBe('OK');
      expect(thread?.outputs['reviewer']?.value).toBe('OK');
      e.manager.stop();
    },
  );

  it('classifies a missing own conversation without silently starting another', async () => {
    const { e, fake, v } = await setup();
    fake.script([
      {},
      {},
      {
        announceSession: false,
        accepted: false,
        submission: 'session-missing',
        error: { code: 'HARNESS_SESSION_MISSING', message: 'removed session' },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({
      code: 'HARNESS_SESSION_MISSING',
      resumable: false,
      inference: { submission: 'session-missing', promptKind: 'authored' },
    });
    expect(run.failure?.inference?.sessionId).toBe(handles(e, run.id)[0]?.sessionId);
    await expect(e.manager.resume(run.id)).rejects.toThrow();
    expect(fake.started).toHaveLength(2);
    expect(fake.resumed).toHaveLength(1);
    e.manager.stop();
  });

  it('does not continue unaccepted new work using only the prior visit handle', async () => {
    const { e, fake, v } = await setup();
    fake.script([
      {},
      {},
      {
        announceSession: true,
        accepted: false,
        submission: 'delivery-uncertain',
        error: { code: 'HARNESS_TURN_FAILED', message: 'stream lost', retriable: true },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({
      code: 'HARNESS_DELIVERY_UNCERTAIN',
      resumable: false,
      inference: { submission: 'delivery-uncertain', promptKind: 'authored' },
    });
    await expect(e.manager.resume(run.id)).rejects.toThrow();
    expect(fake.started.length + fake.resumed.length).toBe(3);
    e.manager.stop();
  });

  it('retains the exact task on proven refusal at a reset boundary', async () => {
    const { e, fake, v } = await setup(2, 1);
    fake.script([
      {},
      {},
      {
        announceSession: false,
        accepted: false,
        submission: 'definitely-not-submitted',
        error: { code: 'HARNESS_TURN_FAILED', message: 'refused', retriable: true },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure?.inference?.submission).toBe('definitely-not-submitted');
    const before = e
      .events(run.id)
      .filter((x) => x.type === 'harness.turn')
      .at(-1)!;
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    const retried = e
      .events(run.id)
      .filter((x) => x.type === 'harness.turn')
      .filter((x) => x.visitId === before.visitId);
    expect(retried).toHaveLength(2);
    expect(retried[1]).toMatchObject({ turnId: before.turnId, prompt: before.prompt });
    expect(retried[1]?.resumeSessionId).toBeUndefined();
    expect(fake.started.at(-1)?.turn.prompt).toBe(before.prompt);
    e.manager.stop();
  });
  it('continues accepted uncertain own work without resending authored feedback', async () => {
    const { e, fake, v } = await setup();
    fake.script([
      {},
      {},
      {
        accepted: true,
        submission: 'delivery-uncertain',
        error: { code: 'HARNESS_TURN_FAILED', message: 'accepted stream lost', retriable: true },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({
      resumable: true,
      inference: { submission: 'delivery-uncertain' },
    });
    const prior = e
      .events(run.id)
      .filter((x) => x.type === 'harness.turn')
      .at(-1)!;
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    const continued = e
      .events(run.id)
      .filter((x) => x.type === 'harness.turn')
      .filter((x) => x.visitId === prior.visitId);
    expect(continued).toHaveLength(2);
    expect(continued[1]).toMatchObject({
      promptKind: 'continuation',
      resumeSessionId: prior.resumeSessionId,
    });
    expect(continued[1]?.prompt).toContain('previous turn was interrupted');
    expect(continued[1]?.prompt).not.toBe(prior.prompt);
    e.manager.stop();
  });

  it('cancels a revisited own turn without starting another conversation', async () => {
    const { e, fake, v } = await setup();
    fake.script([{}, {}, { accepted: true, delayMs: 500 }]);
    const run = await e.start(v.loopId);
    await vi.waitFor(() => expect(fake.resumed).toHaveLength(1));
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
    expect(fake.started.length + fake.resumed.length).toBe(3);
    expect(fake.cancelled).toContain(fake.resumed[0]?.sessionId);
    e.manager.stop();
  });
});

it('uses the final attempt of the latest completed visit rather than a stale higher attempt', async () => {
  const e = await createTestEngine();
  const v = e.publish(
    cycle({ policy: 'resume-own', resetAfterVisits: 2 }, { policy: 'resume-own' }, 4),
  );
  e.ports.harness.script([
    {
      announceSession: false,
      accepted: false,
      submission: 'definitely-not-submitted',
      error: { code: 'HARNESS_TURN_FAILED', message: 'first visit refused' },
    },
  ]);
  const run = await e.runToIdle(v.loopId);
  await e.manager.resume(run.id);
  expect((await e.settle(run.id)).status).toBe('succeeded');
  const worker = handles(e, run.id).filter((x) => x.nodeId === 'worker');
  expect(worker.map((x) => x.mode)).toEqual(['fresh', 'resumed', 'fresh', 'resumed']);
  expect(worker[1]?.sessionId).toBe(worker[0]?.sessionId);
  expect(worker[2]?.sessionId).not.toBe(worker[0]?.sessionId);
  expect(worker[3]?.sessionId).toBe(worker[2]?.sessionId);
  const old = await e.ports.sessions.forNodeAttempt(run.id, 'worker', 2, 'codex');
  expect(old?.sessionId).toBe(worker[0]?.sessionId);
  e.manager.stop();
});

it('keeps fresh sessions isolated while deliberately supplying selected main-loop context', async () => {
  const e = await createTestEngine();
  const v = e.publish(
    singleNodeLoop('fresh input view', {
      id: 'worker',
      kind: 'inference',
      label: 'Worker',
      config: {
        session: { policy: 'fresh' },
        input: [{ op: 'set', path: '/vars/selected', value: { kind: 'literal', value: 'chosen' } }],
        prompt: {
          template:
            'Authored task: {{ vars.selected }} / {{ invocation.trigger.payload.feedback }}',
        },
      },
    }),
  );
  const first = await e.runToIdle(v.loopId, { feedback: 'review findings' });
  const second = await e.runToIdle(v.loopId, { feedback: 'new findings' });
  expect(first.status).toBe('succeeded');
  expect(second.status).toBe('succeeded');
  expect(e.ports.harness.started.map((x) => x.turn.prompt)).toEqual([
    'Authored task: chosen / review findings',
    'Authored task: chosen / new findings',
  ]);
  expect(e.ports.harness.resumed).toHaveLength(0);
  expect((await e.manager.getThread(first.id))?.vars['selected']).toBeUndefined();
  e.manager.stop();
});

it('keeps schema repairs within a visit and resets only after completed visits', async () => {
  const e = await createTestEngine();
  const def = cycle({ policy: 'resume-own', resetAfterVisits: 2 }, { policy: 'resume-own' }, 3);
  const worker = def.nodes.find((x) => x.id === 'worker');
  if (worker?.kind !== 'inference') throw new Error('worker fixture missing');
  worker.config.output = {
    schema: { jsonSchema: { type: 'number' }, repair: { enabled: true, maxAttempts: 1 } },
  };
  const v = e.publish(def);
  e.ports.harness.script([
    { finalText: 'invalid' },
    { finalText: '42' },
    { finalText: 'review' },
    { finalText: '42' },
    { finalText: 'review' },
    { finalText: '42' },
    { finalText: 'review' },
  ]);
  const run = await e.runToIdle(v.loopId);
  expect(run.status).toBe('succeeded');
  const workerSessions = handles(e, run.id).filter((x) => x.nodeId === 'worker');
  expect(workerSessions.map((x) => x.mode)).toEqual(['fresh', 'resumed', 'resumed', 'fresh']);
  expect(workerSessions[2]?.sessionId).toBe(workerSessions[0]?.sessionId);
  expect(workerSessions[3]?.sessionId).not.toBe(workerSessions[0]?.sessionId);
  const turns = e
    .events(run.id)
    .filter((x) => x.type === 'harness.turn')
    .filter((x) => x.nodeId === 'worker');
  expect(turns[1]).toMatchObject({ promptKind: 'repair', visitId: turns[0]?.visitId });
  expect(turns[2]?.visitId).not.toBe(turns[0]?.visitId);
  e.manager.stop();
});
