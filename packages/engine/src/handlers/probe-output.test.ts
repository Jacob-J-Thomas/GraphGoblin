import { describe, expect, it } from 'vitest';
import { ProbeBodyOverflowError } from '../errors.js';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

describe('probe and script output contracts', () => {
  it('records heartbeat HTTP overflow as a typed failure without a successful beat or partial output', async () => {
    const engine = await createTestEngine();
    engine.ports.probes.respondWith(() => {
      throw new ProbeBodyOverflowError();
    });
    const version = engine.publish(
      singleNodeLoop('bounded heartbeat', {
        id: 'hb',
        kind: 'heartbeat',
        label: 'Heartbeat',
        config: {
          intervalSeconds: 1,
          probe: { kind: 'http', url: 'https://example.test/status' },
          until: 'true',
          record: 'full',
        },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({
      code: 'HTTP_PROBE_BODY_OVERFLOW',
      nodeId: 'hb',
      resumable: true,
    });
    expect(run.failure?.message).toContain('65536');
    expect(engine.eventTypes(run.id)).not.toContain('heartbeat.beat');
    expect((await engine.manager.getThread(run.id))?.outputs).not.toHaveProperty('hb');
  });

  it('preserves ordinary heartbeat transport errors as internal failures', async () => {
    const engine = await createTestEngine();
    engine.ports.probes.respondWith(() => {
      throw new Error('controlled transport fault');
    });
    const version = engine.publish(
      singleNodeLoop('failed heartbeat', {
        id: 'hb',
        kind: 'heartbeat',
        label: 'Heartbeat',
        config: {
          intervalSeconds: 1,
          probe: { kind: 'http', url: 'https://example.test/status' },
          maxBeats: 1,
        },
      }),
    );
    expect((await engine.runToIdle(version.loopId)).failure?.code).toBe('INTERNAL_ERROR');
  });

  it('reports script progress using raw captured bytes rather than UTF-16 units', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: '\u{1f98e}',
      stderr: '',
      state: 'completed' as const,
      timedOut: false,
      stdoutBytes: 4,
      stderrBytes: 0,
      stdoutOverflow: false,
      stderrOverflow: false,
    }));
    const version = engine.publish(
      singleNodeLoop('script bytes', {
        id: 'script',
        kind: 'script',
        label: 'Script',
        config: { command: 'controlled', args: [], stdin: 'none', stdout: 'last-output' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    expect(engine.events(run.id)).toContainEqual(
      expect.objectContaining({
        type: 'node.progress',
        nodeId: 'script',
        progress: expect.objectContaining({ stdoutBytes: 4 }),
      }),
    );
  });
});
