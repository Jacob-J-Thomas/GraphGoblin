import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { HarnessEvent } from '@graphgoblin/engine';
import { ClaudeHarness } from './harness.js';
import { runClaudeProcess } from './process.js';

const id = '11111111-1111-4111-8111-111111111111';
describe('Claude submission evidence through a fake CLI process', () => {
  it.each(['pre-start', 'arguments', 'auth', 'init', 'assistant', 'missing'] as const)(
    '%s reports only truthful delivery evidence',
    async (scenario) => {
      const harness = new ClaudeHarness({
        platform: 'win32',
        runner: (request, onStdout) =>
          runClaudeProcess(
            {
              ...request,
              binary:
                scenario === 'pre-start' && request.stdin !== undefined
                  ? 'gg-wp-f4-nonexistent.exe'
                  : process.execPath,
              args: [
                fileURLToPath(new URL('./fixtures/turn-cli.mjs', import.meta.url)),
                scenario,
                ...request.args,
              ],
            },
            onStdout,
          ),
      });
      const request = {
        workingDirectory: tmpdir(),
        model: 'claude-opus-5-5',
        effort: 'high' as const,
        options: { sandbox: 'read-only' as const, approval: 'never' as const },
        turn: { prompt: 'synthetic authored task' },
      };
      const session =
        scenario === 'missing'
          ? harness.resume(id, request, new AbortController().signal)
          : harness.start(request, new AbortController().signal);
      const events: HarnessEvent[] = [];
      for await (const event of session.events) events.push(event);
      await expect(session.result).rejects.toThrow();
      expect(events.filter((x) => x.type === 'submitted')).toEqual(
        scenario === 'assistant' ? [{ type: 'submitted', marker: 'claude.assistant' }] : [],
      );
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        submission:
          scenario === 'missing'
            ? 'session-missing'
            : ['pre-start', 'arguments', 'auth'].includes(scenario)
              ? 'definitely-not-submitted'
              : 'delivery-uncertain',
      });
      if (scenario === 'missing') {
        expect(events.at(-1)).toMatchObject({ code: 'HARNESS_SESSION_MISSING' });
        expect(events.some((x) => x.type === 'session')).toBe(false);
      }
      if (scenario === 'auth')
        expect(events.at(-1)).toMatchObject({ code: 'HARNESS_NOT_AUTHENTICATED' });
      if (['init', 'assistant'].includes(scenario))
        expect(events.some((x) => x.type === 'session')).toBe(true);
    },
    60000,
  );

  // The Codex defect of F2 LP-5 (#243): a generic process-exit error replaced the failure the
  // stream had reported. The Claude adapter stops at the first typed stream failure and reports it
  // ahead of the exit code, so the same shape cannot arise here.
  it('keeps a provider failure the stream reported ahead of the non-zero exit that follows it', async () => {
    const harness = new ClaudeHarness({
      platform: 'win32',
      runner: (request, onStdout) =>
        runClaudeProcess(
          {
            ...request,
            binary: process.execPath,
            args: [
              fileURLToPath(new URL('./fixtures/turn-cli.mjs', import.meta.url)),
              'provider-failure',
              ...request.args,
            ],
          },
          onStdout,
        ),
    });
    const session = harness.start(
      {
        workingDirectory: tmpdir(),
        model: 'claude-opus-5-5',
        effort: 'high',
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'synthetic authored task' },
      },
      new AbortController().signal,
    );
    const events: HarnessEvent[] = [];
    for await (const event of session.events) events.push(event);
    const failure = {
      code: 'HARNESS_QUOTA_EXHAUSTED',
      message: 'Claude account rate limit reached',
      retriable: true,
    };
    expect(events.at(-1)).toEqual({ type: 'error', ...failure, submission: 'delivery-uncertain' });
    await expect(session.result).rejects.toMatchObject(failure);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  }, 60000);
});
