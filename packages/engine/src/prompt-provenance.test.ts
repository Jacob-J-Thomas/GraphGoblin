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
    const failure = (await e.ports.runs.get(run.id))?.failure;
    expect(failure).toMatchObject({
      code: 'INTERNAL_ERROR',
      inference: { submission: 'definitely-not-submitted' },
    });
    const diagnostic = 'storage unavailable before launch';
    expect(JSON.stringify([failure, e.events(run.id)])).not.toContain(diagnostic);
    const logged = e.ports.logger.lines.find(
      ({ obj }) =>
        obj.runId === run.id &&
        obj.nodeId === failure?.nodeId &&
        obj.turnId === failure?.inference?.turnId &&
        obj.error,
    );
    expect(logged?.obj.error).toMatchObject({
      name: 'Error',
      message: diagnostic,
      stack: expect.stringContaining(diagnostic),
    });
    expect(e.ports.harness.started).toHaveLength(0);
    await manager.resume(run.id);
    await manager.waitForIdle();
    expect(e.ports.harness.started[0]!.turn.prompt).toBe('preserve exactly');
    manager.stop();
  });
});

it.each(['exact retry', 'continuation', 'explicit fresh'] as const)(
  'rebuilds the transient view but skips authored prompt rendering on %s',
  async (mode) => {
    const e = await createTestEngine();
    let flag = false;
    e.ports.structuredFake.respondWith(() => flag);
    const source = '{% if vars.flag %}{{ "private" | append }}{% else %}Saved task{% endif %}';
    const config = {
      prompt: { template: source },
      input: [
        {
          op: 'coerce',
          source: '/vars/missing',
          target: '/vars/flag',
          jsonSchema: { type: 'boolean' },
          repair: { maxAttempts: 1 },
        },
      ],
      contextFiles: [{ path: 'observation', template: '{{ vars.flag }}' }],
    };
    const v = e.publish(
      singleNodeLoop('saved and fresh prompts', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config,
      }),
    );
    e.ports.harness.script([
      {
        submission:
          mode === 'exact retry'
            ? 'definitely-not-submitted'
            : mode === 'continuation'
              ? 'delivery-uncertain'
              : 'session-missing',
        accepted: mode === 'continuation',
        announceSession: mode !== 'exact retry',
        items: [],
        error: {
          code: mode === 'explicit fresh' ? 'HARNESS_SESSION_MISSING' : 'HARNESS_TURN_FAILED',
          message: 'scripted failure',
        },
      },
      { finalText: 'done' },
    ]);
    const failed = await e.runToIdle(v.loopId);
    flag = true;
    if (mode === 'explicit fresh') {
      const seq = e.events(failed.id).findLast((event) => event.type === 'run.failed')!.seq;
      await e.manager.recoverSession(failed.id, 'infer', seq, { kind: 'user', id: 'operator' });
    } else await e.manager.resume(failed.id);
    expect((await e.settle(failed.id)).status).toBe('succeeded');
    expect(e.ports.structuredFake.requests).toHaveLength(2);
    expect([...e.ports.workspace.files.values()]).toEqual(['true']);
    const turns = e.events(failed.id).filter((event) => event.type === 'harness.turn');
    expect(turns.map((turn) => turn.prompt)).toEqual([
      'Saved task',
      mode === 'continuation' ? continuation : 'Saved task',
    ]);
    expect(turns[0]!.turnId === turns[1]!.turnId).toBe(mode === 'exact retry');
  },
);

it('renders the current transient view on an explicit fresh session with no prior authored prompt', async () => {
  const e = await createTestEngine();
  let flag = false;
  e.ports.structuredFake.respondWith(() => flag);
  const def = singleNodeLoop('fresh with no saved prompt', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: {
      prompt: { template: '{% if vars.flag %}{{ "private" | append }}{% else %}Main{% endif %}' },
      session: { policy: 'resume-own' },
      input: [
        {
          op: 'coerce',
          source: '/vars/missing',
          target: '/vars/flag',
          jsonSchema: { type: 'boolean' },
          repair: { maxAttempts: 1 },
        },
      ],
    },
  });
  def.nodes.push({
    id: 'again',
    label: 'Again',
    kind: 'decision',
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
  def.edges = def.edges.filter((edge) => edge.from.node !== 'infer');
  def.edges.push(
    { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'again' } },
    { id: 'e3', from: { node: 'again', port: 'repeat' }, to: { node: 'infer' } },
    { id: 'e4', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
    { id: 'e5', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
  );
  e.ports.sessions.forNodeAttempt = () => Promise.resolve(undefined);
  const run = await e.runToIdle(e.publish(def).loopId);
  expect(run.failure).toMatchObject({
    code: 'HARNESS_SESSION_MISSING',
    missingSession: { origin: 'resume-own' },
  });
  const seq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
  flag = true;
  await e.manager.recoverSession(run.id, 'infer', seq, { kind: 'user', id: 'operator' });
  const failed = await e.settle(run.id);
  expect(failed.failure).toMatchObject({
    code: 'TEMPLATE_ERROR',
    resumable: false,
    details: { boundary: 'inference.prompt.template' },
  });
  expect(failed.failure?.inference).toBeUndefined();
  expect(e.events(run.id).filter((event) => event.type === 'harness.turn')).toHaveLength(1);
});

it.each(['definitely-not-submitted', 'delivery-uncertain'] as const)(
  'retains %s as information on an authored preparation fault before a retry or continuation',
  async (submission) => {
    const e = await createTestEngine();
    let newInput = false;
    e.ports.structuredFake.respondWith(() => newInput);
    const v = e.publish(
      singleNodeLoop('later failed preparation', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          input: [
            {
              op: 'coerce',
              source: '/vars/missing',
              target: '/vars/flag',
              jsonSchema: { type: 'boolean' },
              repair: { maxAttempts: 1 },
            },
            {
              op: 'set',
              path: '/vars/value',
              value: { kind: 'expression', jsonata: 'vars.flag ? $error("SECRET") : 1' },
            },
          ],
          prompt: { template: 'saved' },
        },
      }),
    );
    e.ports.harness.script([
      {
        accepted: submission === 'delivery-uncertain',
        announceSession: true,
        submission,
        error: { code: 'HARNESS_TURN_FAILED', message: 'prior provider error' },
      },
    ]);
    const prior = await e.runToIdle(v.loopId);
    expect(prior.failure?.resumable).toBe(true);
    const before = e
      .events(prior.id)
      .filter((event) => event.type === 'harness.turn' || event.type === 'harness.submission');
    const rows = structuredClone(e.ports.sessions.rows);
    const cleanup = [...e.ports.harness.cancelled];
    newInput = true;
    await e.manager.resume(prior.id);
    const failed = await e.settle(prior.id);
    expect(failed.failure).toMatchObject({
      code: 'MUTATION_ERROR',
      resumable: false,
      inference: prior.failure!.inference,
      details: { boundary: 'inference.input', operationIndex: 1, operationKind: 'set' },
    });
    expect(failed.failure?.inference?.retry).toBeUndefined();
    expect(
      e
        .events(prior.id)
        .filter((event) => event.type === 'harness.turn' || event.type === 'harness.submission'),
    ).toEqual(before);
    expect(e.ports.sessions.rows).toEqual(rows);
    expect(e.ports.harness.cancelled).toEqual(cleanup);
    expect(e.ports.structuredFake.requests).toHaveLength(2);
    expect(e.ports.harness.started).toHaveLength(1);
    expect(e.ports.harness.resumed).toHaveLength(0);
  },
);
