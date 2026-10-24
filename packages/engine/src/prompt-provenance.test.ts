import { describe, expect, it } from 'vitest';
import type { PromptSubmission } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { RunManager } from './run-manager.js';

const authored = 'Keep the entire authored task: {{ run.id }}';
const continuation =
  'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.';
const policies = ['fresh', 'resume-previous', 'resume-named'] as const;

async function scenario(
  policy: (typeof policies)[number],
  classification: PromptSubmission,
  options: { announce?: boolean; accepted?: boolean } = {},
) {
  const e = await createTestEngine();
  const v = e.publish(
    singleNodeLoop('provenance-' + policy, {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        prompt: { template: authored },
        session: policy === 'resume-named' ? { policy, key: 'shared' } : { policy },
      },
    }),
  );
  e.ports.harness.script([
    {
      items: [],
      announceSession: options.announce ?? false,
      accepted: options.accepted ?? false,
      submission: classification,
      error: {
        code:
          classification === 'session-missing' ? 'HARNESS_SESSION_MISSING' : 'HARNESS_TURN_FAILED',
        message: 'controlled failure',
        retriable: false,
      },
    },
  ]);
  const run = await e.start(v.loopId);
  // Public repository port seeds the selected prior conversation before the executor's first yield.
  await e.ports.sessions.upsert({
    runId: run.id,
    nodeId: 'prior',
    attempt: 1,
    harness: 'codex',
    sessionId: 'prior-session',
    status: 'finished',
    updatedAt: '2026-10-20T00:00:00.000Z',
    scopeKey: v.loopId + ':shared',
  });
  return { e, v, run: await e.settle(run.id) };
}

describe('prompt provenance through RunManager and the fake harness', () => {
  it('records observed submission truthfully on a successful turn', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('successful submission', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'task' } },
      }),
    );
    const run = await e.runToIdle(v.loopId);
    expect(e.events(run.id).filter((x) => x.type === 'harness.submission')).toEqual([
      expect.objectContaining({ submission: 'submitted', marker: 'fake.accepted' }),
    ]);
    e.manager.stop();
  });
  it.each(policies)(
    'resends the exact authored task after proven refusal under %s',
    async (policy) => {
      const { e, run } = await scenario(policy, 'definitely-not-submitted', { announce: true });
      expect(run.failure?.inference).toMatchObject({
        submission: 'definitely-not-submitted',
        promptKind: 'authored',
      });
      const original =
        policy === 'fresh' ? e.ports.harness.started[0]! : e.ports.harness.resumed[0]!.request;
      const originalTurn = e.events(run.id).find((x) => x.type === 'harness.turn');
      await e.manager.resume(run.id);
      expect((await e.settle(run.id)).status).toBe('succeeded');
      const retried =
        policy === 'fresh' ? e.ports.harness.started[1]! : e.ports.harness.resumed[1]!.request;
      expect(retried.turn.prompt).toBe(original.turn.prompt);
      expect(retried.turn.prompt).not.toBe(continuation);
      if (policy !== 'fresh') expect(e.ports.harness.resumed[1]!.sessionId).toBe('prior-session');
      const intents = e.events(run.id).filter((x) => x.type === 'harness.turn');
      expect(intents).toHaveLength(2);
      expect(intents[1]!.turnId).toBe(originalTurn!.turnId);
      e.manager.stop();
    },
  );
  it.each(policies)(
    'continues uncertain accepted work under %s without resending the task',
    async (policy) => {
      const { e, run } = await scenario(policy, 'delivery-uncertain', {
        announce: true,
        accepted: true,
      });
      expect(run.failure).toMatchObject({
        code: 'HARNESS_DELIVERY_UNCERTAIN',
        resumable: true,
        inference: { submission: 'delivery-uncertain' },
      });
      await e.manager.resume(run.id);
      expect((await e.settle(run.id)).status).toBe('succeeded');
      expect(e.ports.harness.resumed.at(-1)!.request.turn.prompt).toBe(continuation);
      const turns = e.events(run.id).filter((x) => x.type === 'harness.turn');
      expect(turns).toHaveLength(2);
      expect(turns[1]!.visitId).toBe(turns[0]!.visitId);
      e.manager.stop();
    },
  );
  it.each(policies)(
    'classifies missing sessions under %s and refuses resume without a fresh-session choice',
    async (policy) => {
      const { e, run } = await scenario(policy, 'session-missing');
      expect(run.failure).toMatchObject({
        code: 'HARNESS_SESSION_MISSING',
        resumable: false,
        inference: { submission: 'session-missing' },
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(e.ports.harness.started.length + e.ports.harness.resumed.length).toBe(1);
      e.manager.stop();
    },
  );
  it('does not treat init alone as proof of acceptance or proof of non-submission', async () => {
    const { e, run } = await scenario('fresh', 'delivery-uncertain', { announce: true });
    expect(run.failure?.inference?.submission).toBe('delivery-uncertain');
    expect(
      e
        .events(run.id)
        .filter((x) => x.type === 'harness.submission')
        .every((x) => !x.marker),
    ).toBe(true);
    await e.manager.resume(run.id);
    await e.settle(run.id);
    expect(e.ports.harness.resumed.at(-1)!.request.turn.prompt).toBe(continuation);
    e.manager.stop();
  });
  it('fails uncertainty with no session explicitly instead of starting fresh', async () => {
    const { e, run } = await scenario('fresh', 'delivery-uncertain');
    expect(run.failure).toMatchObject({ code: 'HARNESS_DELIVERY_UNCERTAIN', resumable: false });
    await expect(e.manager.resume(run.id)).rejects.toThrow();
    expect(e.ports.harness.started).toHaveLength(1);
    e.manager.stop();
  });
  it('never downgrades acceptance to definitely unsubmitted on a later auth refusal', async () => {
    const { e, run } = await scenario('fresh', 'definitely-not-submitted', {
      accepted: true,
      announce: true,
    });
    expect(run.failure?.inference?.submission).toBe('delivery-uncertain');
    await e.manager.resume(run.id);
    await e.settle(run.id);
    expect(e.ports.harness.resumed.at(-1)!.request.turn.prompt).toBe(continuation);
    e.manager.stop();
  });
  it('reconstructs a proven refusal from durable history after manager restart', async () => {
    const { e, run } = await scenario('fresh', 'definitely-not-submitted');
    e.manager.stop();
    const manager = new RunManager(e.ports, e.settings);
    await manager.start();
    await manager.resume(run.id);
    await manager.waitForIdle();
    expect(e.ports.harness.started[1]!.turn.prompt).toBe(e.ports.harness.started[0]!.turn.prompt);
    manager.stop();
  });
  it('gives replay forks and subloop children their own visit and submission state', async () => {
    const { e, v, run } = await scenario('fresh', 'definitely-not-submitted');
    const fork = await e.manager.replay({ runId: run.id, nodeId: 'infer' });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    const parent = e.publish(
      singleNodeLoop('parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Child',
        config: { loopRef: { loopId: v.loopId } },
      }),
    );
    const parentRun = await e.runToIdle(parent.loopId);
    expect(parentRun.status).toBe('succeeded');
    const child = (await e.ports.runs.listChildren(parentRun.id))[0]!;
    const sourceTurn = e.events(run.id).find((x) => x.type === 'harness.turn')!;
    for (const id of [fork.id, child.id]) {
      const turn = e.events(id).find((x) => x.type === 'harness.turn')!;
      expect(turn.visitId).not.toBe(sourceTurn.visitId);
      expect(turn.turnId).not.toBe(sourceTurn.turnId);
      expect(turn.promptKind).toBe('authored');
    }
    e.manager.stop();
  });
  it('keeps repeated visits independent even when the same node failed on an earlier visit', async () => {
    const e = await createTestEngine();
    const def = singleNodeLoop('repeat', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: { prompt: { template: 'visit {{ gates.again.passes }}' } },
    });
    def.nodes.push({
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
    });
    def.edges = def.edges.filter((x) => x.from.node !== 'infer');
    def.edges.push(
      { id: 'work', from: { node: 'infer', port: 'out' }, to: { node: 'again' } },
      { id: 'repeat', from: { node: 'again', port: 'repeat' }, to: { node: 'infer' } },
      { id: 'finish', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
      { id: 'limit', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
    );
    const v = e.publish(def);
    e.ports.harness.script([
      {
        submission: 'definitely-not-submitted',
        error: { code: 'HARNESS_TURN_FAILED', message: 'refused', retriable: false },
      },
      { finalText: 'first visit' },
      {
        submission: 'definitely-not-submitted',
        error: { code: 'HARNESS_TURN_FAILED', message: 'second refusal', retriable: false },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('failed');
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    const turns = e.events(run.id).filter((x) => x.type === 'harness.turn');
    expect(turns).toHaveLength(4);
    expect(turns[0]!.visitId).not.toBe(turns[2]!.visitId);
    expect(e.ports.harness.started.map((x) => x.turn.prompt)).toEqual([
      'visit 1',
      'visit 1',
      'visit 2',
      'visit 2',
    ]);
    e.manager.stop();
  });
  it('retains the exact repair task after a refused repair instead of resending the original task', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('repair provenance', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'original task' },
          output: {
            schema: { jsonSchema: { type: 'number' }, repair: { enabled: true, maxAttempts: 1 } },
          },
        },
      }),
    );
    e.ports.harness.script([
      { finalText: 'invalid' },
      {
        submission: 'definitely-not-submitted',
        error: { code: 'HARNESS_TURN_FAILED', message: 'repair refused', retriable: false },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure?.inference).toMatchObject({
      promptKind: 'repair',
      submission: 'definitely-not-submitted',
    });
    const repair = e.ports.harness.resumed[0]!.request.turn.prompt;
    e.ports.harness.script([{ finalText: '42' }]);
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(e.ports.harness.resumed[1]!.request.turn.prompt).toBe(repair);
    e.manager.stop();
  });
  it('does not carry an init-only ID into an uncertain fresh retry', async () => {
    const { e, run } = await scenario('fresh', 'definitely-not-submitted', { announce: true });
    e.ports.harness.script([
      {
        announceSession: false,
        items: [],
        submission: 'delivery-uncertain',
        error: { code: 'HARNESS_TURN_FAILED', message: 'lost fresh retry' },
      },
    ]);
    await e.manager.resume(run.id);
    const failed = await e.settle(run.id);
    expect(failed.failure).toMatchObject({ code: 'HARNESS_DELIVERY_UNCERTAIN', resumable: false });
    expect(failed.failure?.inference?.sessionId).toBeUndefined();
    expect(e.ports.harness.started).toHaveLength(2);
    e.manager.stop();
  });
  it('retains the task when session bookkeeping fails before invoking the harness', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const sessions = e.ports.sessions;
    let unavailable = true;
    const manager = new RunManager(
      {
        ...e.ports,
        sessions: {
          upsert: (row) => {
            if (row.status === 'starting' && unavailable) {
              unavailable = false;
              return Promise.reject(new Error('storage unavailable before launch'));
            }
            return sessions.upsert(row);
          },
          forNode: (runId, nodeId) => sessions.forNode(runId, nodeId),
          forNodeAttempt: (runId, nodeId, attempt, harness) =>
            sessions.forNodeAttempt(runId, nodeId, attempt, harness),
          latestWithSession: (runId, harness) => sessions.latestWithSession(runId, harness),
          byScopeKey: (key, harness) => sessions.byScopeKey(key, harness),
        },
      },
      e.settings,
    );
    await manager.start();
    const v = e.publish(
      singleNodeLoop('prelaunch bookkeeping', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'preserve exactly' } },
      }),
    );
    const run = await manager.startRun({
      ownerId: 'local',
      loopId: v.loopId,
      source: 'manual.api',
    });
    await manager.waitForIdle();
    expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      inference: { submission: 'definitely-not-submitted' },
      details: {
        name: 'Error',
        stack: expect.stringContaining('storage unavailable before launch'),
      },
    });
    expect(e.ports.harness.started).toHaveLength(0);
    await manager.resume(run.id);
    await manager.waitForIdle();
    expect(e.ports.harness.started[0]!.turn.prompt).toBe('preserve exactly');
    manager.stop();
  });
});
