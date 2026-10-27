import { expect, it } from 'vitest';
import { RunManager } from '../run-manager.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';
import { FakeHarness } from '../testing/fakes.js';
import {
  expectedFailure,
  failureCases,
  failureHarness,
  failureLoop,
  failureSources,
  recordingModes,
} from '../testing/inference-failures.js';

const matrix = (['codex', 'claude'] as const).flatMap((family) =>
  failureCases.flatMap((spec) =>
    failureSources.flatMap((source) =>
      [false, true].flatMap((retriable) =>
        recordingModes.map((storage) => ({ family, spec, source, retriable, storage })),
      ),
    ),
  ),
);

it.each(matrix)(
  'folds $family $spec.code at $source retry=$retriable storage=$storage',
  async ({ family, spec, source, retriable, storage }) => {
    const e = await createTestEngine();
    e.manager.stop();
    e.ports.modelCatalog.entries.push({
      harness: 'claude',
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Opus',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const h = failureHarness(family, spec, source, retriable);
    const expected = expectedFailure(spec, source, family, retriable);
    e.ports.harnesses[family] = h.port;
    const events = e.ports.events;
    let fired = false;
    const manager = new RunManager(
      {
        ...e.ports,
        events: {
          async append(id, drafts, options) {
            if (
              storage !== 'ok' &&
              !fired &&
              h.calls.length === 2 &&
              drafts.some(
                (draft) =>
                  draft.type === 'harness.submission' && draft.submission === expected.state,
              )
            ) {
              fired = true;
              if (storage === 'after') await events.append(id, drafts, options);
              throw new Error('Classification recording fault ' + storage);
            }
            return events.append(id, drafts, options);
          },
          recoveryFacts: (...args) => events.recoveryFacts(...args),
          read: (...args) => events.read(...args),
          subscribe: (...args) => events.subscribe(...args),
        },
      },
      e.settings,
    );
    await manager.start();
    try {
      const v = e.publish(failureLoop(family));
      const started = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      if (source === 'cancel') {
        await h.ready;
        await manager.cancel(started.id, { kind: 'user', id: 'owner' });
      }
      await manager.waitForIdle();
      const run = (await e.ports.runs.get(started.id))!;
      if (storage !== 'ok') expect(fired).toBe(true);
      expect(run.status).toBe(expected.cancelled ? 'cancelled' : 'failed');
      if (!expected.cancelled) {
        expect(run.failure).toMatchObject({
          code: expected.code,
          resumable: expected.resumable,
          inference: { promptKind: 'repair', submission: expected.state },
        });
        if (fired) expect(run.failure?.details).toMatchObject({ recording: expect.any(Array) });
        if (expected.resumable) {
          await manager.resume(run.id);
          await manager.waitForIdle();
          expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
          expect(h.calls.at(-1)).toBe(
            expected.state === 'definitely-not-submitted'
              ? 'Repair exactly: "invalid"'
              : 'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
          );
        } else await expect(manager.resume(run.id)).rejects.toThrow();
      } else await expect(manager.resume(run.id)).rejects.toThrow();
      expect(h.calls.length).toBe(!expected.cancelled && expected.resumable ? 3 : 2);
    } finally {
      manager.stop();
    }
  },
);

it.each(
  (['codex', 'claude'] as const).flatMap((family) =>
    [false, true].map((afterCommit) => ({ family, afterCommit })),
  ),
)(
  'reconciles $family repair afterCommit=$afterCommit with a failed read',
  async ({ family, afterCommit }) => {
    const e = await createTestEngine();
    e.manager.stop();
    e.ports.modelCatalog.entries.push({
      harness: 'claude',
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Opus',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const fake = new FakeHarness([{ finalText: 'invalid' }, { finalText: '42' }], family);
    e.ports.harnesses[family] = fake;
    const events = e.ports.events;
    let fired = false;
    let readFailed = false;
    const manager = new RunManager(
      {
        ...e.ports,
        events: {
          async append(id, drafts, options) {
            if (
              !fired &&
              drafts.some((d) => d.type === 'harness.turn' && d.promptKind === 'repair')
            ) {
              fired = true;
              if (afterCommit) await events.append(id, drafts, options);
              throw new Error('Repair intent append failed');
            }
            return events.append(id, drafts, options);
          },
          recoveryFacts: (...args) => events.recoveryFacts(...args),
          read(...args) {
            if (fired && !readFailed) {
              readFailed = true;
              throw new Error('Reconciliation read failed');
            }
            return events.read(...args);
          },
          subscribe: (...args) => events.subscribe(...args),
        },
      },
      e.settings,
    );
    await manager.start();
    try {
      const v = e.publish(failureLoop(family));
      const started = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      const run = (await e.ports.runs.get(started.id))!;
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        inference: { promptKind: 'repair', submission: 'definitely-not-submitted' },
        details: { recording: expect.any(Array) },
      });
      expect(readFailed).toBe(true);
      expect(fake.cancelled).toHaveLength(0);
      expect(fake.resumed).toHaveLength(0);
      await manager.resume(run.id);
      await manager.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
      expect(fake.resumed[0]?.request.turn.prompt).toBe('Repair exactly: "invalid"');
      const turns = e
        .events(run.id)
        .filter((event) => event.type === 'harness.turn')
        .filter((event) => event.promptKind === 'repair');
      expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(1);
    } finally {
      manager.stop();
    }
  },
);

it.each(
  (['codex', 'claude'] as const).flatMap((family) =>
    [false, true].map((afterCommit) => ({ family, afterCommit })),
  ),
)(
  'retains initial $family intent afterCommit=$afterCommit across an unavailable reconciliation read',
  async ({ family, afterCommit }) => {
    const e = await createTestEngine();
    e.manager.stop();
    e.ports.modelCatalog.entries.push({
      harness: 'claude',
      model: 'claude-opus-5-5',
      source: 'harness',
      displayName: 'Opus',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    });
    const fake = new FakeHarness([{ finalText: '42' }], family);
    e.ports.harnesses[family] = fake;
    const events = e.ports.events;
    let fired = false;
    let readFailed = false;
    const manager = new RunManager(
      {
        ...e.ports,
        events: {
          async append(id, drafts, options) {
            if (!fired && drafts.some((d) => d.type === 'harness.turn')) {
              fired = true;
              if (afterCommit) await events.append(id, drafts, options);
              throw new Error('Initial intent append failed');
            }
            return events.append(id, drafts, options);
          },
          recoveryFacts: (...args) => events.recoveryFacts(...args),
          read(...args) {
            if (fired && !readFailed) {
              readFailed = true;
              throw new Error('Initial reconciliation read failed');
            }
            return events.read(...args);
          },
          subscribe: (...args) => events.subscribe(...args),
        },
      },
      e.settings,
    );
    await manager.start();
    try {
      const v = e.publish(
        singleNodeLoop('Initial intent', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            harness: family,
            model: family === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna',
            effort: 'low',
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
            prompt: { template: 'Exact initial task' },
          },
        }),
      );
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      const failed = (await e.ports.runs.get(run.id))!;
      expect(failed.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        inference: { promptKind: 'authored', submission: 'definitely-not-submitted' },
      });
      expect(fake.started).toHaveLength(0);
      await manager.resume(run.id);
      await manager.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
      expect(fake.started[0]?.turn.prompt).toBe('Exact initial task');
      const turns = e.events(run.id).filter((event) => event.type === 'harness.turn');
      expect(new Set(turns.map((turn) => turn.turnId)).size).toBe(1);
    } finally {
      manager.stop();
    }
  },
);
