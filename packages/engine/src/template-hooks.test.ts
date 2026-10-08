import { describe, expect, it } from 'vitest';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { RunFailureError } from './errors.js';
import { EngineRequestError } from './run-manager.js';
describe('composition-owned execution policy', () => {
  it('records a safe typed pre-execution refusal before any node or script and preserves details', async () => {
    const engine = await createTestEngine({
      beforeExecute: () =>
        Promise.reject(
          new RunFailureError(
            'TEMPLATE_PREREQUISITE_UNAVAILABLE',
            'Repair the selected prerequisite.',
            { details: { prerequisite: 'support-key', kind: 'secret' } },
          ),
        ),
    });
    const version = engine.publish(
      singleNodeLoop('guard', {
        id: 'script',
        kind: 'script',
        label: 'Script',
        config: { command: 'unused' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({
      code: 'TEMPLATE_PREREQUISITE_UNAVAILABLE',
      resumable: true,
      details: { prerequisite: 'support-key', kind: 'secret' },
    });
    expect(engine.ports.scripts.calls).toHaveLength(0);
    expect(engine.events(run.id).some((event) => event.type === 'node.started')).toBe(false);
    engine.settings.beforeResume = () =>
      Promise.reject(new EngineRequestError('INVALID_STATE', 'No resume authority.'));
    await expect(engine.manager.resume(run.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(engine.events(run.id).some((event) => event.type === 'run.resumed')).toBe(false);
  });
  it('does not record raw exceptions thrown by pre-execution policy', async () => {
    const engine = await createTestEngine({
      beforeExecute: () => Promise.reject(new Error('private-marker')),
    });
    const version = engine.publish(
      singleNodeLoop('safe-error', {
        id: 'script',
        kind: 'script',
        label: 'Script',
        config: { command: 'unused' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.failure).toMatchObject({ code: 'INTERNAL_ERROR', resumable: false });
    expect(JSON.stringify(engine.events(run.id)).includes('private-marker')).toBe(false);
    expect(engine.ports.scripts.calls).toHaveLength(0);
  });
  it('supplies script identity from the actual durable started event', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('identity', {
        id: 'script',
        kind: 'script',
        label: 'Script',
        config: { command: 'unused' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    const started = engine
      .events(run.id)
      .find((event) => event.type === 'node.started' && event.nodeId === 'script');
    expect(engine.ports.scripts.calls[0]?.executionIdentity).toEqual({
      kind: 'node',
      ownerId: run.ownerId,
      loopId: run.loopId,
      versionId: run.versionId,
      nodeId: 'script',
      runId: run.id,
      startedSeq: started?.seq,
    });
  });
});
