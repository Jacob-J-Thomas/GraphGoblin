import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { ArtifactStoreError } from './errors.js';
import { RunManager } from './run-manager.js';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from './testing/fakes.js';
import { singleNodeLoop } from './testing/scenario.js';

describe('inference artifact failures through the store port', () => {
  it.each(['ARTIFACT_CORRUPT', 'ARTIFACT_WRITE_FAILED'] as const)(
    'records %s as a typed node failure without publishing a transcript patch',
    async (code) => {
      const ports = createFakePorts();
      const ref = `artifact:transcript/${'a'.repeat(64)}`;
      const manager = new RunManager(
        {
          ...ports,
          artifacts: {
            put: () => Promise.reject(new ArtifactStoreError(code, ref)),
            get: () => Promise.resolve(undefined),
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
        code,
        nodeId: 'infer',
        details: { ref },
        resumable: false,
      });
      expect((await manager.getThread(run.id))?.artifacts).toEqual([]);
      expect(ports.sessions.rows[0]?.status).toBe('failed');
      expect(
        ports.events
          .all(run.id)
          .filter((event) => event.type === 'node.finished' && event.nodeId === 'infer'),
      ).toEqual([]);
      manager.stop();
    },
  );
});
