import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { CodexHarness, type CodexClientFactory } from './harness.js';

it('continues the recorded session after a CLI dies following durable turn.started acceptance', async () => {
  const e = await createTestEngine();
  const children: { child: ChildProcessWithoutNullStreams; closed: Promise<unknown> }[] = [];
  const calls: { sessionId?: string; prompt: string }[] = [];
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const factory: CodexClientFactory = () => {
    const thread = (sessionId?: string) => ({
      runStreamed: (prompt: string) => {
        calls.push({ ...(sessionId ? { sessionId } : {}), prompt });
        return Promise.resolve({
          events: (async function* () {
            const child = spawn(
              process.execPath,
              [
                fileURLToPath(new URL('./fixtures/turn-cli.mjs', import.meta.url)),
                sessionId ? 'completed' : 'accepted-hold',
              ],
              { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
            );
            const closed = once(child, 'close');
            closed.catch(() => undefined);
            children.push({ child, closed });
            child.stdin.end(prompt);
            for await (const line of createInterface({ input: child.stdout }))
              yield JSON.parse(line) as { type: string };
            const [code, signal] = await closed;
            if (code !== 0)
              throw new Error(`Codex CLI exited with code ${code} (signal ${signal})`);
          })(),
        });
      },
    });
    return { startThread: () => thread(), resumeThread: (id) => thread(id) };
  };
  e.ports.harnesses.codex = new CodexHarness({ clientFactory: factory, logger });
  try {
    const version = e.publish(
      singleNodeLoop('CLI kill recovery', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          session: { policy: 'fresh' },
          prompt: { template: 'The complete authored task' },
        },
      }),
    );
    const started = await e.start(version.loopId);
    await vi.waitFor(
      () =>
        expect(e.events(started.id)).toContainEqual(
          expect.objectContaining({
            type: 'harness.submission',
            submission: 'submitted',
            marker: 'codex.turn.started',
          }),
        ),
      { timeout: 30000 },
    );
    const owned = children[0];
    if (!owned) throw new Error('Controlled CLI was not started');
    expect(owned.child.kill('SIGKILL')).toBe(true);
    await owned.closed;
    const failed = await e.settle(started.id);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HARNESS_TURN_FAILED', retriable: false }),
      expect.any(String),
    );
    expect(failed.failure).toMatchObject({
      code: 'HARNESS_DELIVERY_UNCERTAIN',
      resumable: true,
      inference: { submission: 'delivery-uncertain', sessionId: 'fixture-thread' },
    });
    await e.manager.resume(started.id);
    expect((await e.settle(started.id)).status).toBe('succeeded');
    expect(calls).toEqual([
      { prompt: 'The complete authored task' },
      {
        sessionId: 'fixture-thread',
        prompt:
          'The previous turn was interrupted before GraphGoblin recorded its result. Continue the task from where you left off and finish it.',
      },
    ]);
    expect(children).toHaveLength(2);
    const turns = e.events(started.id).filter((event) => event.type === 'harness.turn');
    expect(turns[1]).toMatchObject({ visitId: turns[0]?.visitId, promptKind: 'continuation' });
  } finally {
    e.manager.stop();
    for (const { child, closed } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  }
}, 60000);
