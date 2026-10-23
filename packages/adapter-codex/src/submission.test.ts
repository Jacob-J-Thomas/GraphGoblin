import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@graphgoblin/engine';
import { CodexHarness, type CodexClientFactory } from './harness.js';

describe('Codex submission markers through the public SDK client seam and fake CLI', () => {
  it.each(['pre-start', 'arguments', 'init', 'accepted', 'accepted-auth', 'missing'] as const)(
    '%s distinguishes initialization from input acceptance',
    async (scenario) => {
      const factory: CodexClientFactory = () => {
        const thread = {
          runStreamed: (input: string) =>
            Promise.resolve({
              events: (async function* () {
                if (scenario === 'pre-start') throw new Error('spawn codex ENOENT');
                const child = spawn(
                  process.execPath,
                  [fileURLToPath(new URL('./fixtures/turn-cli.mjs', import.meta.url)), scenario],
                  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
                );
                const closed = once(child, 'close');
                let diagnostic = '';
                child.stderr.on('data', (chunk: Buffer) => {
                  diagnostic += chunk.toString();
                });
                child.stdin.end(input);
                for await (const line of createInterface({ input: child.stdout }))
                  yield JSON.parse(line) as { type: string };
                await closed;
                throw new Error(diagnostic || 'fake CLI died');
              })(),
            }),
        };
        return { startThread: () => thread, resumeThread: () => thread };
      };
      const harness = new CodexHarness({ clientFactory: factory });
      const request = {
        workingDirectory: tmpdir(),
        options: { sandbox: 'read-only' as const, approval: 'never' as const },
        turn: { prompt: 'synthetic authored task' },
      };
      const session =
        scenario === 'missing'
          ? harness.resume('prior-session', request, new AbortController().signal)
          : harness.start(request, new AbortController().signal);
      const events: HarnessEvent[] = [];
      for await (const event of session.events) events.push(event);
      await expect(session.result).rejects.toThrow();
      expect(events.filter((x) => x.type === 'submitted')).toEqual(
        scenario.startsWith('accepted')
          ? [{ type: 'submitted', marker: 'codex.turn.started' }]
          : [],
      );
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        submission:
          scenario === 'missing'
            ? 'session-missing'
            : ['pre-start', 'arguments'].includes(scenario)
              ? 'definitely-not-submitted'
              : 'delivery-uncertain',
      });
    },
    60000,
  );
});
