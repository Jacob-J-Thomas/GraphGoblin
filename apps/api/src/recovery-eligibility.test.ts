import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ContextThread,
  RunRecord,
  RunRecovery,
  RunStatus,
  RunFailure,
} from '@graphgoblin/contracts';
import { SqliteRunRepository } from '@graphgoblin/infrastructure/sqlite';
import { RunManager } from '@graphgoblin/engine';
import type { EventStorePort, ScriptRunResult } from '@graphgoblin/engine';
import { FakeScripts } from '@graphgoblin/engine/testing';
import { buildApp } from './app.js';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  t.container.manager.stop();
});
afterEach(async () => {
  await t.container.manager.start();
  await t.idle();
  await t.close();
});
type Snapshot = RunRecord & { recovery: RunRecovery };
async function seeded(status: RunStatus, failure?: RunFailure): Promise<Snapshot> {
  const loopId = await t.publishLoop({
    ...minimalLoop(),
    name: 'recovery-' + t.container.ports.ids.next(),
  });
  const run = await t.container.manager.startRun({
    ownerId: 'local',
    loopId,
    source: 'manual.api',
  });
  await t.container.manager.pause(run.id);
  await t.container.repos.events.append(run.id, [
    {
      type: 'node.started',
      nodeId: 'start',
      kind: 'trigger',
      attempt: 1,
      configHash: 'controlled',
    },
  ]);
  await t.container.repos.runs.transition(run.id, ['paused'], {
    status,
    ...(failure ? { failure } : {}),
  });
  if (failure) await t.container.repos.events.append(run.id, [{ type: 'run.failed', failure }]);
  return (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
}
async function refusal(run: Snapshot, action: 'resume' | 'replay', code: string, nodeId = 'start') {
  const response = await t.app.inject({
    method: 'POST',
    url: `/runs/${run.id}/${action}`,
    payload: { observedSeq: run.recovery.observedSeq, ...(action === 'replay' ? { nodeId } : {}) },
  });
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json()).toMatchObject({ code });
}
const transient: RunFailure = {
  code: 'HARNESS_QUOTA_EXHAUSTED',
  message: 'controlled',
  resumable: true,
  nodeId: 'start',
};
describe('server recovery eligibility (#256)', () => {
  it('keeps GET recovery reads bounded as history grows by eleven thousand events', async () => {
    const run = await seeded('paused');
    let decoded = 0;
    let fullReads = 0;
    const store = t.container.ports.events;
    const events: EventStorePort = {
      append: (...args) => store.append(...args),
      subscribe: (...args) => store.subscribe(...args),
      read: (...args) => {
        fullReads++;
        return store.read(...args);
      },
      recoveryFacts: async (...args) => {
        const facts = await store.recoveryFacts(...args);
        decoded += new Set(
          [facts.lifecycle?.seq, facts.failed?.seq, facts.resumed?.seq].filter(
            (seq) => seq !== undefined,
          ),
        ).size;
        return facts;
      },
    };
    const manager = new RunManager(
      { ...t.container.ports, events },
      { maxConcurrentRuns: 1, defaults: t.container.config.defaults },
    );
    const api = await buildApp({ ...t.container, manager }, { logger: false });
    try {
      for (const count of [0, 1000, 10000]) {
        for (let i = 0; i < count; i += 100)
          await store.append(
            run.id,
            Array.from(
              { length: 100 },
              () =>
                ({
                  type: 'signal.received',
                  name: 'unrelated',
                  payload: 'x'.repeat(1024),
                }) as const,
            ),
          );
        decoded = 0;
        fullReads = 0;
        const snapshot = await api.inject(`/runs/${run.id}`);
        expect(snapshot.statusCode, snapshot.body).toBe(200);
        expect(snapshot.json<Snapshot>().recovery.resume.allowed).toBe(true);
        expect(fullReads).toBe(0);
        expect(decoded).toBeLessThanOrEqual(3);
      }
    } finally {
      await api.close();
      manager.stop();
    }
  });
  it('Replay records the canonical source and revokes deletion consent without changing execution history', async () => {
    await t.container.manager.start();
    const loopId = await t.publishLoop(minimalLoop());
    const source = await t.container.manager.startRun({
      ownerId: 'local',
      loopId,
      source: 'manual.api',
    });
    await t.idle();
    const before = await t.container.ports.events.read(source.id);
    const runIds = [source.id];
    const preview = (
      await t.app.inject({
        method: 'POST',
        url: '/runs/deletion-eligibility/preview',
        payload: { runIds },
      })
    ).json<{ token: string }>();
    const marked = await t.app.inject({
      method: 'POST',
      url: '/runs/deletion-eligibility',
      payload: { runIds, token: preview.token, action: 'mark', confirmed: true },
    });
    expect(marked.statusCode, marked.body).toBe(200);
    expect((await t.container.ports.runs.get(source.id))?.deletionApproval).toBeDefined();
    const snapshot = (await t.app.inject(`/runs/${source.id}`)).json<Snapshot>();
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: { nodeId: 'start', observedSeq: snapshot.recovery.observedSeq },
    });
    expect(response.statusCode, response.body).toBe(202);
    const fork = response.json<{ run: RunRecord }>().run;
    expect(fork.id).not.toBe(source.id);
    expect(
      (
        await t.container.handle.client.execute({
          sql: 'SELECT replay_source_run_id,replay_intent_node_id,replay_intent_observed_seq FROM runs WHERE id=?',
          args: [fork.id],
        })
      ).rows,
    ).toEqual([
      {
        replay_source_run_id: source.id,
        replay_intent_node_id: 'start',
        replay_intent_observed_seq: snapshot.recovery.observedSeq,
      },
    ]);
    expect((await t.container.ports.runs.get(source.id))?.deletionApproval).toBeUndefined();
    expect(await t.container.ports.events.read(source.id)).toEqual(before);
  });
  it.each(['queued', 'running', 'waiting', 'paused', 'cancelled', 'succeeded'] as const)(
    'scan1: Replay retains main eligibility for a reached node on a %s source',
    async (status) => {
      const source = await seeded(status);
      const before = await t.container.ports.events.read(source.id);
      const response = await t.app.inject({
        method: 'POST',
        url: `/runs/${source.id}/replay`,
        payload: { nodeId: 'start', observedSeq: source.recovery.observedSeq },
      });
      expect(response.statusCode, response.body).toBe(202);
      expect(response.json<{ run: RunRecord }>().run.id).not.toBe(source.id);
      expect(await t.container.ports.events.read(source.id)).toEqual(before);
    },
  );
  it('scan1: Resume permits a completed resumable script failure after the program is fixed', async () => {
    const source = await seeded('failed', {
      ...transient,
      code: 'SCRIPT_EXIT_CODE',
      script: { visitId: 'v', state: 'completed', exitCode: 7 },
    });
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/resume`,
      payload: { observedSeq: source.recovery.observedSeq },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<RunRecord>().id).toBe(source.id);
  });
  it('scan1: lost fork admission acknowledgement finds the committed fork', async () => {
    const source = await seeded('succeeded');
    const create = t.container.ports.admission.create.bind(t.container.ports.admission);
    let lost = false;
    vi.spyOn(t.container.ports.admission, 'create').mockImplementation(async (...args) => {
      const admitted = await create(...args);
      if (!lost && args[0].initialThread.invocation.replayOf) {
        lost = true;
        throw new Error('controlled lost admission acknowledgement');
      }
      return admitted;
    });
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: { nodeId: 'start', observedSeq: source.recovery.observedSeq },
    });
    expect(response.statusCode, response.body).toBe(202);
    const fork = response.json<{ run: RunRecord }>().run;
    expect((await t.container.ports.runs.get(fork.id))?.id).toBe(fork.id);
    expect((await t.container.ports.events.read(source.id)).at(-1)?.seq).toBe(source.lastEventSeq);
  });
  it.each(['latest', 'captured'] as const)(
    'returns one recovery state with %s history during a concurrent retry',
    async (timing) => {
      const base = minimalLoop();
      const loopId = await t.publishLoop({
        ...base,
        nodes: [
          base.nodes[0]!,
          { id: 'a', kind: 'script', label: 'A', config: { command: 'a' } },
          { id: 'b', kind: 'script', label: 'B', config: { command: 'b' } },
          base.nodes[1]!,
        ],
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
          { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
          { id: 'c', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
        ],
      });
      const scripts = new FakeScripts();
      let calls = 0;
      scripts.respondWith((): ScriptRunResult => ({
        state: ++calls === 1 || calls === 3 ? 'outcome-uncertain' : 'completed',
        exitCode: calls === 2 ? 0 : null,
        stdout: '"effect"',
        stderr: '',
        stdoutBytes: 8,
        stderrBytes: 0,
        stdoutOverflow: false,
        stderrOverflow: false,
        timedOut: false,
      }));
      let armed = false;
      let interleaved = false;
      const events: EventStorePort = {
        append: (...args) => t.container.ports.events.append(...args),
        subscribe: (...args) => t.container.ports.events.subscribe(...args),
        read: (...args) => t.container.ports.events.read(...args),
        recoveryFacts: async (...args) => {
          const captured = await t.container.ports.events.recoveryFacts(...args);
          if (armed && !interleaved) {
            interleaved = true;
            await manager.resume(
              args[0],
              { kind: 'user', id: 'other-tab' },
              { retryUncertainScript: true },
            );
            await manager.waitForIdle();
            return timing === 'latest' ? t.container.ports.events.recoveryFacts(...args) : captured;
          }
          return captured;
        },
      };
      const manager = new RunManager(
        { ...t.container.ports, events, scripts },
        { maxConcurrentRuns: 1, defaults: t.container.config.defaults },
      );
      const api = await buildApp({ ...t.container, manager }, { logger: false });
      try {
        await manager.start();
        const run = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
        await manager.waitForIdle();
        armed = true;
        const snapshot = (await api.inject(`/runs/${run.id}`)).json<Snapshot>();
        expect(snapshot.failure?.nodeId).toBe('b');
        if (timing === 'latest') {
          expect(snapshot.lastEventSeq).toBe(snapshot.recovery.observedSeq);
          expect(snapshot.recovery.scriptConsent?.nodeId).toBe('b');
        } else {
          expect(snapshot.lastEventSeq).toBeGreaterThan(snapshot.recovery.observedSeq);
          expect(snapshot.recovery.resume).toMatchObject({
            allowed: false,
            code: 'RECOVERY_STALE',
          });
          expect(snapshot.recovery.replayDefault).toMatchObject({
            allowed: false,
            code: 'RECOVERY_STALE',
          });
          expect(snapshot.recovery.scriptConsent).toBeUndefined();
          const refused = await api.inject({
            method: 'POST',
            url: `/runs/${run.id}/resume`,
            payload: { observedSeq: snapshot.recovery.observedSeq, retryUncertainScript: true },
          });
          expect(refused.statusCode).toBe(409);
          expect(refused.json()).toMatchObject({ code: 'RECOVERY_STALE' });
          expect(scripts.calls).toHaveLength(3);
        }
      } finally {
        manager.stop();
        await api.close();
      }
    },
  );
  it.each(['queued', 'running', 'waiting'] as const)(
    'refuses active %s runs using the read reason',
    async (status) => {
      const run = await seeded(status);
      expect(run.recovery.resume).toMatchObject({ allowed: false, code: 'RUN_ACTIVE' });
      await refusal(run, 'resume', 'RUN_ACTIVE');
    },
  );
  it.each(['succeeded', 'exhausted'] as const)(
    'explains Resume on finished %s runs',
    async (status) => {
      const run = await seeded(status);
      await refusal(run, 'resume', 'RUN_FINISHED');
    },
  );
  it('explains paused Replay, cancelled recovery and unsupported failures', async () => {
    const paused = await seeded('paused');
    expect(paused.recovery.resume.allowed).toBe(true);
    expect(paused.recovery.replay.find((node) => node.nodeId === 'start')?.action.allowed).toBe(
      true,
    );
    const cancelled = await seeded('cancelled');
    await refusal(cancelled, 'resume', 'RUN_CANCELLED');
    expect(cancelled.recovery.replay.find((node) => node.nodeId === 'start')?.action.allowed).toBe(
      true,
    );
    const completed = await seeded('failed', {
      ...transient,
      code: 'SCRIPT_EXIT_CODE',
      script: { visitId: 'v', state: 'completed' },
    });
    expect(completed.recovery.resume.allowed).toBe(true);
    const knownExit = await seeded('failed', { ...transient, code: 'SCRIPT_EXIT_CODE' });
    expect(knownExit.recovery.resume.allowed).toBe(true);
    const failed = await seeded('failed', { ...transient, resumable: false });
    await refusal(failed, 'resume', 'FAILURE_NOT_RESUMABLE');
    await refusal(failed, 'replay', 'REPLAY_NODE_NOT_REACHED', 'done');
  });
  it('refuses unavailable definitions with the same read and command reason', async () => {
    const run = await seeded('failed', transient);
    // Real malformed storage input, representing a definition removed outside the API.
    await t.container.handle.client.execute({
      sql: 'DELETE FROM loop_versions WHERE id = ?',
      args: [run.versionId],
    });
    const unavailable = (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
    expect(unavailable.recovery.resume).toMatchObject({ code: 'DEFINITION_UNAVAILABLE' });
    await refusal(unavailable, 'resume', 'DEFINITION_UNAVAILABLE');
    await refusal(unavailable, 'replay', 'DEFINITION_UNAVAILABLE');
  });
  it('refuses absent starting state through a public repository dependency', async () => {
    const run = await seeded('failed', transient);
    class MissingInitial extends SqliteRunRepository {
      override getInitialThread(): Promise<ContextThread | undefined> {
        return Promise.resolve(undefined);
      }
    }
    const manager = new RunManager(
      { ...t.container.ports, runs: new MissingInitial(t.container.handle.db) },
      { maxConcurrentRuns: 1, defaults: t.container.config.defaults },
    );
    const api = await buildApp({ ...t.container, manager }, { logger: false });
    try {
      const snapshot = (await api.inject(`/runs/${run.id}`)).json<Snapshot>();
      expect(snapshot.recovery.resume).toMatchObject({ code: 'STATE_UNAVAILABLE' });
      for (const action of ['resume', 'replay']) {
        const response = await api.inject({
          method: 'POST',
          url: `/runs/${run.id}/${action}`,
          payload: {
            observedSeq: snapshot.recovery.observedSeq,
            ...(action === 'replay' ? { nodeId: 'start' } : {}),
          },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'STATE_UNAVAILABLE' });
      }
    } finally {
      await api.close();
    }
  });
  it('keeps a readable run visible while damaged recovery evidence refuses both actions', async () => {
    const run = await seeded('failed', transient);
    await t.container.handle.client.execute({
      sql: "UPDATE run_events SET payload = '{}' WHERE run_id = ? AND type = 'run.failed'",
      args: [run.id],
    });
    const response = await t.app.inject(`/runs/${run.id}`);
    expect(response.statusCode).toBe(200);
    const damaged = response.json<Snapshot>();
    expect(damaged.status).toBe('failed');
    expect(damaged.recovery.resume).toMatchObject({ code: 'STATE_UNAVAILABLE' });
    await refusal(damaged, 'resume', 'STATE_UNAVAILABLE');
    await refusal(damaged, 'replay', 'STATE_UNAVAILABLE');
  });
  it('diagnoses unrelated historical corruption when a command reconstructs history', async () => {
    const run = await seeded('failed', transient);
    await t.container.handle.client.execute({
      sql: "UPDATE run_events SET payload = '{}' WHERE run_id = ? AND type = 'node.started'",
      args: [run.id],
    });
    const snapshot = (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
    expect(snapshot.recovery.resume.allowed).toBe(true);
    await refusal(snapshot, 'resume', 'STATE_UNAVAILABLE');
    await refusal(snapshot, 'replay', 'STATE_UNAVAILABLE');
  });
  it('reports shutdown and refuses both commands without creating work', async () => {
    const run = await seeded('succeeded');
    t.container.manager.closeIndependentAdmission();
    const draining = (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
    expect(draining.recovery.resume).toMatchObject({ code: 'SHUTTING_DOWN' });
    expect(draining.recovery.replayDefault).toMatchObject({ code: 'SHUTTING_DOWN' });
    for (const action of ['resume', 'replay']) {
      const result = await t.app.inject({
        method: 'POST',
        url: `/runs/${run.id}/${action}`,
        payload: {
          observedSeq: draining.recovery.observedSeq,
          ...(action === 'replay' ? { nodeId: 'start' } : {}),
        },
      });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toMatchObject({ code: 'SHUTTING_DOWN' });
    }
  });
  it('requires separate missing-session and uncertain-script choices', async () => {
    const missing = await seeded('failed', {
      ...transient,
      code: 'HARNESS_SESSION_MISSING',
      resumable: false,
    });
    await refusal(missing, 'resume', 'SESSION_RECOVERY_REQUIRED');
    expect(missing.recovery.replay.find((node) => node.nodeId === 'start')?.action.allowed).toBe(
      true,
    );
    const uncertain = await seeded('failed', {
      ...transient,
      code: 'SCRIPT_OUTCOME_UNCERTAIN',
      script: { visitId: 'v', state: 'outcome-uncertain' },
    });
    await refusal(uncertain, 'resume', 'SCRIPT_CONSENT_REQUIRED');
    await refusal(uncertain, 'replay', 'SCRIPT_CONSENT_REQUIRED');
    const resumed = await t.app.inject({
      method: 'POST',
      url: `/runs/${uncertain.id}/resume`,
      payload: { observedSeq: uncertain.recovery.observedSeq, retryUncertainScript: true },
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json<RunRecord>().id).toBe(uncertain.id);
  });
  it('refuses Replay paths into an uncertain script even without a dispatch marker', async () => {
    const base = minimalLoop();
    const loopId = await t.publishLoop({
      ...base,
      nodes: [
        base.nodes[0]!,
        { id: 'effect', kind: 'script', label: 'Effect', config: { command: 'node --version' } },
        base.nodes[1]!,
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'effect' } },
        { id: 'b', from: { node: 'effect', port: 'out' }, to: { node: 'done' } },
      ],
    });
    const run = await t.container.manager.startRun({
      ownerId: 'local',
      loopId,
      source: 'manual.api',
    });
    await t.container.manager.pause(run.id);
    await t.container.repos.events.append(run.id, [
      {
        type: 'node.started',
        nodeId: 'start',
        kind: 'trigger',
        attempt: 1,
        configHash: 'controlled',
      },
      { type: 'node.finished', nodeId: 'start', patch: [], durationMs: 0 },
      {
        type: 'node.started',
        nodeId: 'effect',
        kind: 'script',
        attempt: 1,
        configHash: 'controlled',
      },
    ]);
    // The persisted visit is uncertain after a lost acknowledgement before dispatch (#321).
    const failure: RunFailure = {
      ...transient,
      code: 'SCRIPT_OUTCOME_UNCERTAIN',
      nodeId: 'effect',
      script: { visitId: 'v', state: 'outcome-uncertain' },
    };
    await t.container.repos.runs.transition(run.id, ['paused'], {
      status: 'failed',
      currentNodeId: 'effect',
      failure,
    });
    await t.container.repos.events.append(run.id, [{ type: 'run.failed', failure }]);
    const snapshot = (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
    expect(snapshot.recovery.replay.find((node) => node.nodeId === 'start')?.action).toMatchObject({
      allowed: false,
      code: 'SCRIPT_CONSENT_REQUIRED',
    });
    expect(snapshot.recovery.replay.find((node) => node.nodeId === 'effect')?.action).toMatchObject(
      {
        allowed: false,
        code: 'SCRIPT_CONSENT_REQUIRED',
      },
    );
    await refusal(snapshot, 'replay', 'SCRIPT_CONSENT_REQUIRED');
    await refusal(snapshot, 'replay', 'SCRIPT_CONSENT_REQUIRED', 'effect');
    const broadConsent = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/replay`,
      payload: {
        nodeId: 'start',
        observedSeq: snapshot.recovery.observedSeq,
        retryUncertainScript: true,
      },
    });
    expect(broadConsent.statusCode, broadConsent.body).toBe(202);
    expect(broadConsent.json<{ run: RunRecord }>().run.id).not.toBe(run.id);
  });
  it('serializes two Resume clicks and refuses an old observation after another failure', async () => {
    const run = await seeded('failed', transient);
    const command = () =>
      t.app.inject({
        method: 'POST',
        url: `/runs/${run.id}/resume`,
        payload: { observedSeq: run.recovery.observedSeq },
      });
    const responses = await Promise.all([command(), command()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 200)?.json<RunRecord>().id).toBe(run.id);
    await t.container.repos.runs.transition(run.id, ['running'], {
      status: 'failed',
      failure: transient,
    });
    await t.container.repos.events.append(run.id, [{ type: 'run.failed', failure: transient }]);
    await refusal(run, 'resume', 'RECOVERY_STALE');
  });
  it('refuses a stale repeated replay command after its first fork was returned', async () => {
    const source = await seeded('succeeded');
    const intent = { nodeId: 'start', observedSeq: source.lastEventSeq };
    const first = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: intent,
    });
    expect(first.statusCode, first.body).toBe(202);
    const repeated = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: intent,
    });
    expect(repeated.statusCode, repeated.body).toBe(409);
    expect(repeated.json()).toMatchObject({ code: 'RECOVERY_STALE' });
  });
  it('admits one Replay per observed intent, records exact identities and preserves source history', async () => {
    const run = await seeded('succeeded');
    const thread = await t.container.manager.getThread(run.id);
    const sourceHistory = await t.container.repos.events.read(run.id);
    const command = () =>
      t.app.inject({
        method: 'POST',
        url: `/runs/${run.id}/replay`,
        payload: { observedSeq: run.recovery.observedSeq, nodeId: 'start' },
      });
    const responses = await Promise.all([command(), command()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    const fork = responses.find((r) => r.statusCode === 202)!.json<{ run: RunRecord }>().run;
    expect(fork.id).not.toBe(run.id);
    expect((await t.app.inject(`/runs/${fork.id}`)).json<Snapshot>().recovery.replayOf).toEqual({
      runId: run.id,
      nodeId: 'start',
    });
    expect(await t.container.manager.getThread(run.id)).toEqual(thread);
    await refusal(run, 'replay', 'RECOVERY_STALE');
    expect(await t.container.repos.events.read(run.id)).toEqual(sourceHistory);
  });
  it('allows a deliberate fork over recorded work and refuses deleted runs', async () => {
    let run = await seeded('failed', transient);
    await t.container.repos.events.append(run.id, [
      {
        type: 'script.dispatched',
        nodeId: 'start',
        visitId: 'v',
        dispatchId: t.container.ports.ids.next(),
      },
    ]);
    run = (await t.app.inject(`/runs/${run.id}`)).json<Snapshot>();
    expect(run.recovery.replay.find((node) => node.nodeId === 'start')?.action.allowed).toBe(true);
    await t.container.repos.loops.delete(run.loopId);
    const deleted = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/resume`,
      payload: { observedSeq: run.recovery.observedSeq },
    });
    expect(deleted.statusCode).toBe(404);
    expect(deleted.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});
