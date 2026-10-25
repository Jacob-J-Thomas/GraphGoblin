import { describe, expect, it, vi } from 'vitest';
import { RunManager } from './run-manager.js';
import type { HarnessId, SessionPolicy } from '@graphgoblin/contracts';
import type { HarnessStartRequest } from './ports.js';
import { FakeHarness, type ScriptedTurn } from './testing/fakes.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

/** Supported port fixture: fresh sessions exist; every selected old handle was removed. */
class RemovedSessions extends FakeHarness {
  private removed: string | undefined;
  override resume(id: string, request: HarnessStartRequest, signal: AbortSignal) {
    this.removed ??= id;
    if (id === this.removed)
      this.script([
        {
          announceSession: true,
          accepted: false,
          items: [],
          submission: 'session-missing',
          error: { code: 'HARNESS_SESSION_MISSING', message: `Session ${id} not found` },
        },
      ]);
    return super.resume(id, request, signal);
  }
}

async function scenario(harness: HarnessId, policy: SessionPolicy, initial: ScriptedTurn[] = []) {
  const e = await createTestEngine();
  const fake = new RemovedSessions(initial, harness);
  e.ports.harnesses[harness] = fake;
  if (harness === 'claude')
    e.ports.modelCatalog.entries.push({
      harness,
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Claude',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
  const def = singleNodeLoop('removed provider session', {
    id: 'worker',
    kind: 'inference',
    label: 'Worker',
    config: {
      harness,
      model: harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
      effort: 'low',
      session: policy,
      prompt: { template: 'Task with selected loop context' },
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
    },
  });
  def.nodes.push({
    id: 'again',
    kind: 'decision',
    label: 'Again',
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
  def.edges = def.edges.filter((edge) => edge.from.node !== 'worker');
  def.edges.push(
    { id: 'gate', from: { node: 'worker', port: 'out' }, to: { node: 'again' } },
    { id: 'repeat', from: { node: 'again', port: 'repeat' }, to: { node: 'worker' } },
    { id: 'limit', from: { node: 'again', port: 'limit-reached' }, to: { node: 'done' } },
    { id: 'finish', from: { node: 'again', port: 'finish' }, to: { node: 'done' } },
  );
  if (policy.policy === 'resume-previous' || policy.policy === 'resume-named') {
    def.nodes.push({
      id: 'upstream',
      kind: 'inference',
      label: 'Upstream',
      config: {
        harness,
        model: harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
        effort: 'low',
        session: policy.policy === 'resume-named' ? policy : { policy: 'fresh' },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
        prompt: { template: 'Upstream task' },
      },
    });
    def.edges[0] = { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'upstream' } };
    def.edges.push({
      id: 'upstream-worker',
      from: { node: 'upstream', port: 'out' },
      to: { node: 'worker' },
    });
  }
  const v = e.publish(def);
  return { e, fake, run: await e.runToIdle(v.loopId) };
}

describe.each(['codex', 'claude'] as const)('%s removed sessions through RunManager', (harness) => {
  it.each([
    { policy: 'fresh' },
    { policy: 'resume-own', resetAfterVisits: 1 },
  ] satisfies SessionPolicy[])('starts fresh at the configured boundary: %j', async (policy) => {
    const { e, fake, run } = await scenario(harness, policy);
    expect(run.status).toBe('succeeded');
    expect(fake.started).toHaveLength(2);
    expect(fake.resumed).toHaveLength(0);
    e.manager.stop();
  });

  it.each([
    { policy: 'resume-previous' },
    { policy: 'resume-named', key: 'shared' },
    { policy: 'resume-own' },
  ] satisfies SessionPolicy[])('names the missing handle and origin: %j', async (policy) => {
    const { e, fake, run } = await scenario(harness, policy);
    expect(run.failure).toMatchObject({ code: 'HARNESS_SESSION_MISSING', resumable: false });
    await expect(e.manager.resume(run.id)).rejects.toThrow();
    expect(fake.started).toHaveLength(1);
    expect(fake.resumed).toHaveLength(1);
    expect(e.events(run.id).filter((event) => event.type === 'harness.session')).toHaveLength(1);
    expect(run.failure?.message).toContain(fake.resumed[0]!.sessionId);
    expect(run.failure?.message).toContain(policy.policy);
    const failureSeq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
    await e.manager.recoverSession(run.id, 'worker', failureSeq, {
      kind: 'user',
      id: 'operator',
    });
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(fake.started.at(-1)).toMatchObject({
      model: harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5',
      effort: 'low',
      turn: { prompt: 'Task with selected loop context' },
    });
    expect(e.events(run.id).find((event) => event.type === 'run.resumed')).toMatchObject({
      actor: { kind: 'user', id: 'operator' },
      freshSession: { nodeId: 'worker', failureSeq, priorContextCarried: false },
    });
    e.manager.stop();
  });
});

it('retains a declined missing session across manager reconstruction and resumes only after a choice', async () => {
  const { e, fake, run } = await scenario('codex', { policy: 'resume-own' });
  e.manager.stop();
  const restarted = new RunManager(e.ports, e.settings);
  await restarted.start();
  await restarted.waitForIdle();
  expect((await e.ports.runs.get(run.id))?.failure).toEqual(run.failure);
  await expect(restarted.resume(run.id)).rejects.toThrow();
  expect(fake.started).toHaveLength(1);
  const failureSeq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
  await restarted.recoverSession(run.id, 'worker', failureSeq);
  await restarted.waitForIdle();
  expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
  restarted.stop();
});

for (const harness of ['codex', 'claude'] as const) {
  it(`${harness}: a fresh visit's lost continuation requires a new explicit choice`, async () => {
    const { e, fake, run } = await scenario(harness, { policy: 'fresh' }, [
      {
        accepted: true,
        submission: 'delivery-uncertain',
        error: {
          code: 'HARNESS_TRANSPORT_FAILED',
          message: 'accepted stream lost',
          retriable: true,
        },
      },
    ]);
    expect(run.failure?.resumable).toBe(true);
    await e.manager.resume(run.id);
    const missing = await e.settle(run.id);
    expect(missing.failure).toMatchObject({
      code: 'HARNESS_SESSION_MISSING',
      resumable: false,
      missingSession: { origin: 'current-visit' },
    });
    const failureSeq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
    await e.manager.recoverSession(run.id, 'worker', failureSeq);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(fake.started[1]?.turn.prompt).toBe(fake.started[0]?.turn.prompt);
    expect(fake.started[1]?.turn.prompt).not.toContain('previous turn was interrupted');
    e.manager.stop();
  });

  it(`${harness}: an explicitly recovered fresh turn can be cancelled without another start`, async () => {
    const { e, fake, run } = await scenario(harness, { policy: 'resume-own' });
    fake.script([{ accepted: true, delayMs: 60000 }]);
    const failureSeq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
    await e.manager.recoverSession(run.id, 'worker', failureSeq);
    await vi.waitFor(() => expect(fake.started).toHaveLength(2));
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
    expect(fake.started).toHaveLength(2);
    expect(e.events(run.id).filter((event) => event.type === 'run.resumed')).toHaveLength(1);
    e.manager.stop();
  });
}

for (const harness of ['codex', 'claude'] as const) {
  it(`${harness}: fresh recovery after a missing repair session restarts the saved authored task`, async () => {
    const e = await createTestEngine();
    const model = harness === 'codex' ? 'gpt-6-luna' : 'claude-opus-5-5';
    const fake = new FakeHarness(
      [
        { finalText: 'invalid number' },
        {
          announceSession: true,
          accepted: false,
          items: [],
          submission: 'session-missing',
          error: { code: 'HARNESS_SESSION_MISSING', message: 'repair session removed' },
        },
      ],
      harness,
    );
    e.ports.harnesses[harness] = fake;
    if (harness === 'claude')
      e.ports.modelCatalog.entries.push({
        harness,
        model,
        source: 'harness',
        displayName: 'Claude',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      });
    const version = e.publish(
      singleNodeLoop('missing repair conversation', {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: {
          harness,
          model,
          effort: 'low',
          session: { policy: 'fresh' },
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: 'Original authored schema task' },
          output: {
            schema: {
              jsonSchema: { type: 'number' },
              repair: { enabled: true, maxAttempts: 1, prompt: 'Repair this number' },
            },
          },
        },
      }),
    );
    const run = await e.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({
      code: 'HARNESS_SESSION_MISSING',
      missingSession: { origin: 'current-visit' },
      inference: { promptKind: 'repair' },
    });
    const failureSeq = e.events(run.id).findLast((event) => event.type === 'run.failed')!.seq;
    fake.script([{ finalText: '42' }]);
    await e.manager.recoverSession(run.id, 'worker', failureSeq);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(fake.started.map((request) => request.turn.prompt)).toEqual([
      'Original authored schema task',
      'Original authored schema task',
    ]);
    expect(fake.resumed).toHaveLength(1);
    expect(fake.resumed[0]?.request.turn.prompt).toBe('Repair this number');
    expect(
      e
        .events(run.id)
        .filter((event) => event.type === 'harness.turn')
        .map((event) => event.promptKind),
    ).toEqual(['authored', 'repair', 'authored']);
    expect(
      e
        .events(run.id)
        .filter((event) => event.type === 'harness.session')
        .map((event) => event.mode),
    ).toEqual(['fresh', 'fresh']);
    expect(fake.started[1]).toMatchObject({ model, effort: 'low' });
    e.manager.stop();
  });
}
