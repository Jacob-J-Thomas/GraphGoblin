import { describe, expect, it, vi } from 'vitest';
import type { HarnessStartRequest } from '@graphgoblin/engine';
import { OllamaHarness } from './harness.js';
import { discoveredModel } from './discovery.js';
import { qwenContextDetail } from './context-fixture.js';
import type { OllamaFetch } from './http.js';
const connection = { enabled: true, baseUrl: 'http://localhost:11434', revision: 1 };
const model = discoveredModel('qwen:fixture', 'digest-1', 1, '2026-11-07T00:00:00.000Z', {
  capabilities: ['completion'],
});
const request: HarnessStartRequest = {
  model: model.model,
  effort: 'none',
  options: { sandbox: 'read-only', approval: 'never' },
  workingDirectory: '/unused',
  turn: { prompt: 'Hello' },
};
const terminal = { done: true, message: { role: 'assistant', content: 'Hello' } };
const json = (value: unknown) => new Response(JSON.stringify(value));
const urlOf = (url: Parameters<OllamaFetch>[0]) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
function fixture(detail: unknown = qwenContextDetail) {
  const fetcher = vi.fn<OllamaFetch>((url) =>
    Promise.resolve(
      json(
        urlOf(url).endsWith('/api/show')
          ? detail
          : urlOf(url).endsWith('/api/version')
            ? { version: '0.32.15' }
            : terminal,
      ),
    ),
  );
  const native = new OllamaHarness({
    fetcher,
    snapshot: () => Promise.resolve({ connection, models: [model] }),
  });
  return { native, fetcher };
}
describe('Ollama context dispatch boundary', () => {
  it('coalesces metadata, includes the complete exact prompt and sends explicit context/output allocation', async () => {
    const { native, fetcher } = fixture();
    const windows = await Promise.all([
      native.contextWindow(request, new AbortController().signal),
      native.contextWindow(request, new AbortController().signal),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(windows[0]?.profile).toBe(windows[1]?.profile);
    const changed = { ...request, turn: { prompt: '{"answer":"🦎"}' } };
    await native.start(changed, new AbortController().signal).result;
    expect(fetcher).toHaveBeenCalledTimes(5);
    const call = fetcher.mock.calls.at(-1);
    const requestBody = call?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('fixture body missing');
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'user', content: changed.turn.prompt }]);
    expect(body.options).toEqual({ num_ctx: 4096, num_predict: 1024 });
  });
  it('rejects oversized required text and unknown profiles before inference dispatch', async () => {
    for (const detail of [qwenContextDetail, { ...qwenContextDetail, template: 'unknown' }]) {
      const { native, fetcher } = fixture(detail);
      const session = native.start(
        { ...request, turn: { prompt: 'required '.repeat(1000) } },
        new AbortController().signal,
      );
      await expect(session.result).rejects.toMatchObject({
        code:
          detail === qwenContextDetail ? 'HARNESS_CONTEXT_LIMIT' : 'HARNESS_CONTEXT_UNSUPPORTED',
        submission: 'definitely-not-submitted',
      });
      expect(fetcher.mock.calls.every((call) => !urlOf(call[0]).endsWith('/api/chat'))).toBe(true);
    }
  });
  it('respects cancellation while shared metadata is pending and does not dispatch inference', async () => {
    const fetcher = vi.fn<OllamaFetch>(() => new Promise<Response>(() => {}));
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [model] }),
    });
    const controller = new AbortController();
    const pending = native.contextWindow(request, controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls.every((call) => !urlOf(call[0]).endsWith('/api/chat'))).toBe(true);
  });
  it('evicts failed metadata and rechecks changed model digest rather than keeping a false qualification', async () => {
    let digest = model.digest;
    let fail = true;
    const fetcher = vi.fn<OllamaFetch>((url) =>
      Promise.resolve(
        json(
          urlOf(url).endsWith('/api/show')
            ? fail
              ? {}
              : qwenContextDetail
            : { version: '0.32.15' },
        ),
      ),
    );
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [{ ...model, digest }] }),
    });
    await expect(native.contextWindow(request, new AbortController().signal)).rejects.toThrow(
      /no supported/,
    );
    fail = false;
    await native.contextWindow(request, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(4);
    digest = 'digest-2';
    await native.contextWindow(request, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('checks actual runtime version again before reusing a cached model profile', async () => {
    let version = '0.32.15';
    const fetcher = vi.fn<OllamaFetch>((url) =>
      Promise.resolve(json(urlOf(url).endsWith('/api/version') ? { version } : qwenContextDetail)),
    );
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [model] }),
    });
    await native.contextWindow(request, new AbortController().signal);
    version = 'future-runtime';
    await expect(native.start(request, new AbortController().signal).result).rejects.toMatchObject({
      code: 'HARNESS_CONTEXT_UNSUPPORTED',
      submission: 'definitely-not-submitted',
    });
    expect(fetcher.mock.calls.filter((call) => urlOf(call[0]).endsWith('/api/show'))).toHaveLength(
      1,
    );
    expect(fetcher.mock.calls.filter((call) => urlOf(call[0]).endsWith('/api/chat'))).toHaveLength(
      0,
    );
  });

  it('rechecks selected model metadata at final dispatch even when admission cached the old digest', async () => {
    let template = qwenContextDetail.template;
    const fetcher = vi.fn<OllamaFetch>((url) =>
      Promise.resolve(
        json(
          urlOf(url).endsWith('/api/version')
            ? { version: '0.32.15' }
            : { ...qwenContextDetail, template },
        ),
      ),
    );
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [model] }),
    });
    await native.contextWindow(request, new AbortController().signal);
    template = 'changed renderer template';
    await expect(native.start(request, new AbortController().signal).result).rejects.toMatchObject({
      code: 'HARNESS_CONTEXT_UNSUPPORTED',
      submission: 'definitely-not-submitted',
    });
    expect(fetcher.mock.calls.filter((call) => urlOf(call[0]).endsWith('/api/show'))).toHaveLength(
      2,
    );
    expect(fetcher.mock.calls.filter((call) => urlOf(call[0]).endsWith('/api/chat'))).toHaveLength(
      0,
    );
  });

  it('does not accept a partial answer that exhausted the output reserve', async () => {
    const fetcher: OllamaFetch = (url) =>
      Promise.resolve(
        json(
          urlOf(url).endsWith('/api/show')
            ? qwenContextDetail
            : urlOf(url).endsWith('/api/version')
              ? { version: '0.32.15' }
              : { ...terminal, done_reason: 'length' },
        ),
      );
    const native = new OllamaHarness({
      fetcher,
      snapshot: () => Promise.resolve({ connection, models: [model] }),
    });
    await expect(native.start(request, new AbortController().signal).result).rejects.toMatchObject({
      code: 'HARNESS_OUTPUT_LIMIT',
      submission: 'delivery-uncertain',
    });
  });
});
