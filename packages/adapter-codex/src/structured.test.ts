import { existsSync } from 'node:fs';
import { FakeHarness } from '@graphgoblin/engine/testing';
import { describe, expect, it, vi } from 'vitest';
import { ReplayCodex } from './__fixtures__/replay.js';
import { CodexHarness } from './harness.js';
import { createCodexStructured } from './structured.js';

const schema = { type: 'object' };

describe('CodexStructured', () => {
  it('runs one read-only thread with the schema and returns the parsed value', async () => {
    const harness = new FakeHarness([
      { structured: { route: 'a' }, finalText: '{"route":"a"}', usage: { inputTokens: 7 } },
    ]);
    const structured = createCodexStructured(harness, { workingDirectory: '/repo' });
    const out = await structured.complete(
      { prompt: 'p', schema, model: 'gpt-6-luna', effort: 'low' },
      new AbortController().signal,
    );
    expect(out.value).toEqual({ route: 'a' });
    expect(out.usage?.inputTokens).toBe(7);
    expect(harness.started[0]).toEqual({
      workingDirectory: '/repo',
      model: 'gpt-6-luna',
      effort: 'low',
      options: { sandbox: 'read-only', approval: 'never', networkAccess: false, webSearch: false },
      turn: { prompt: 'p', outputSchema: schema },
    });
  });

  it('prefers the request working directory and falls back to the raw text', async () => {
    const harness = new FakeHarness([{ finalText: 'not json' }, { finalText: '[1,2]' }]);
    const structured = createCodexStructured(harness, { workingDirectory: '/default' });
    const a = await structured.complete(
      { prompt: 'p', schema, workingDirectory: '/req' },
      new AbortController().signal,
    );
    expect(a.value).toBe('not json');
    expect(harness.started[0]?.workingDirectory).toBe('/req');
    expect(harness.started[0]?.model).toBeUndefined();
    const b = await structured.complete({ prompt: 'p', schema }, new AbortController().signal);
    expect(b.value).toEqual([1, 2]);
  });

  it('uses a fresh temporary directory per call and removes it afterwards', async () => {
    const harness = new FakeHarness([{ finalText: '{}' }]);
    const structured = createCodexStructured(harness);
    await structured.complete({ prompt: 'p', schema }, new AbortController().signal);
    const dir = harness.started[0]?.workingDirectory ?? '';
    expect(dir).toMatch(/graphgoblin-structured-/);
    expect(existsSync(dir)).toBe(false);
  });

  it('cleans up and rethrows when the turn fails, even if cleanup fails', async () => {
    const harness = new FakeHarness([{ error: { code: 'HARNESS_QUOTA_EXHAUSTED', message: 'q' } }]);
    const cleanup = vi.fn(() => Promise.reject(new Error('busy')));
    const structured = createCodexStructured(harness, {
      tempDir: () => Promise.resolve({ path: '/tmp/x', cleanup }),
    });
    await expect(
      structured.complete({ prompt: 'p', schema }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'HARNESS_QUOTA_EXHAUSTED' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('works end to end over the Codex harness with the structured fixture', async () => {
    const codex = ReplayCodex.fromFixtures('structured');
    const structured = createCodexStructured(new CodexHarness({ clientFactory: codex.factory }), {
      workingDirectory: '/w',
    });
    const out = await structured.complete({ prompt: 'p', schema }, new AbortController().signal);
    expect(out.value).toMatchObject({ route: 'approve' });
    expect(codex.runs[0]?.threadOptions).toMatchObject({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
    });
  });
});
