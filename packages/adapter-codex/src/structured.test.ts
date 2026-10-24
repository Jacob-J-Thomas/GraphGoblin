import { existsSync } from 'node:fs';
import type { HarnessPort } from '@graphgoblin/engine';
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

it('does not create a directory or start provider work for an already aborted request', async () => {
  const harness = new FakeHarness();
  const tempDir = vi.fn();
  const structured = createCodexStructured(harness, { tempDir });
  const controller = new AbortController();
  controller.abort();
  await expect(
    structured.complete({ prompt: 'p', schema }, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(tempDir).not.toHaveBeenCalled();
  expect(harness.started).toHaveLength(0);
});

it('cleans the directory if cancellation occurs while acquiring it', async () => {
  const harness = new FakeHarness();
  const cleanup = vi.fn(() => Promise.resolve());
  const controller = new AbortController();
  const structured = createCodexStructured(harness, {
    tempDir: () => {
      controller.abort();
      return Promise.resolve({ path: '/scratch', cleanup });
    },
  });
  await expect(
    structured.complete({ prompt: 'p', schema }, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(harness.started).toHaveLength(0);
  expect(cleanup).toHaveBeenCalledOnce();
});

it('forwards abort through the Codex harness to the SDK call and cleans its directory', async () => {
  const codex = new ReplayCodex({
    events: [{ type: 'thread.started', thread_id: 'thread' }],
    hangAfter: 0,
  });
  const cleanup = vi.fn(() => Promise.resolve());
  const structured = createCodexStructured(new CodexHarness({ clientFactory: codex.factory }), {
    tempDir: () => Promise.resolve({ path: '/scratch', cleanup }),
  });
  const controller = new AbortController();
  const result = structured.complete({ prompt: 'p', schema }, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await expect.poll(() => codex.runs[0]?.turnOptions?.signal !== undefined).toBe(true);
  controller.abort();
  await rejected;
  expect(codex.runs[0]?.turnOptions?.signal?.aborted).toBe(true);
  expect(cleanup).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'calls harness cancellation once and cleans up when cancellation rejects=%s',
  async (fails) => {
    const cleanup = vi.fn(() => Promise.resolve());
    const failure = new Error('cancel cleanup failure');
    const cancelled = new Error('caller cancelled');
    const cancel = vi.fn(() => (fails ? Promise.reject(failure) : Promise.resolve()));
    const controller = new AbortController();
    const harness: HarnessPort = {
      id: 'codex',
      preflight: () => new FakeHarness().preflight(),
      start: () => {
        controller.abort(cancelled);
        return {
          sessionId: Promise.resolve('controlled'),
          result: new Promise(() => {}),
          events: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) },
          cancel,
        };
      },
      resume: () => {
        throw new Error('not used');
      },
    };
    const structured = createCodexStructured(harness, {
      tempDir: () => Promise.resolve({ path: '/scratch', cleanup }),
    });
    await expect(structured.complete({ prompt: 'p', schema }, controller.signal)).rejects.toBe(
      fails ? failure : cancelled,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  },
);
