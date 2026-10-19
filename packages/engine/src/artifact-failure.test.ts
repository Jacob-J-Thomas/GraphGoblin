import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { ArtifactStoreError } from './errors.js';
import { RunManager } from './run-manager.js';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from './testing/fakes.js';
import { singleNodeLoop } from './testing/scenario.js';

describe('inference artifact failures through the store port', () => {
  it('records resumable ARTIFACT_WRITE_FAILED without a transcript patch and continues the same session on explicit resume', async () => {
    const ports = createFakePorts();
    const ref = `artifact:transcript/${'a'.repeat(64)}`;
    let storageUnavailable = true;
    const manager = new RunManager(
      {
        ...ports,
        artifacts: {
          put: (kind, content) =>
            storageUnavailable
              ? Promise.reject(new ArtifactStoreError('ARTIFACT_WRITE_FAILED', ref))
              : ports.artifacts.put(kind, content),
          get: (reference) => ports.artifacts.get(reference),
        },
      },
      DEFAULT_TEST_SETTINGS,
    );
    const loopId = fakeUlid('artifacts');
    ports.loops.add({
      id: fakeUlid('version'),
      loopId,
      version: 1,
      status: 'published',
      createdAt: FIXTURE_TS,
      definition: LoopDefinitionSchema.parse(
        singleNodeLoop('Artifact failure', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { prompt: { template: 'Hello' }, output: { captureTranscript: 'artifact' } },
        }),
      ),
    });
    ports.harness.script([{ finalText: 'completed provider work' }]);
    await manager.start();
    const run = await manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' });
    await manager.waitForIdle();
    expect((await ports.runs.get(run.id))?.failure).toMatchObject({
      code: 'ARTIFACT_WRITE_FAILED',
      nodeId: 'infer',
      details: { ref },
      resumable: true,
    });
    expect((await manager.getThread(run.id))?.artifacts).toEqual([]);
    expect(ports.sessions.rows[0]?.status).toBe('failed');
    expect(
      ports.events
        .all(run.id)
        .filter((event) => event.type === 'node.finished' && event.nodeId === 'infer'),
    ).toEqual([]);
    const sessionId = ports.sessions.rows[0]?.sessionId;
    expect(sessionId).toBeDefined();
    storageUnavailable = false;
    ports.harness.script([{ finalText: 'continued provider work' }]);
    await manager.resume(run.id);
    await manager.waitForIdle();
    expect((await ports.runs.get(run.id))?.status).toBe('succeeded');
    expect(ports.harness.started).toHaveLength(1);
    expect(ports.harness.resumed).toHaveLength(1);
    expect(ports.harness.resumed[0]).toMatchObject({
      sessionId,
      request: {
        turn: {
          prompt:
            'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
        },
      },
    });
    expect((await manager.getThread(run.id))?.artifacts).toHaveLength(1);
    manager.stop();
  });
});
