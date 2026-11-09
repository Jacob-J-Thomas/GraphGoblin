import { describe, expect, it, vi } from 'vitest';
import { qwenContextDetail } from './context-fixture.js';
import { OLLAMA_CONTEXT_PROFILE } from './context.js';
import { discoverOllama, discoveredModel } from './discovery.js';
import { requestJson, type OllamaFetch } from './http.js';
const at = '2026-11-07T00:00:00.000Z';
const connection = { enabled: true, baseUrl: 'http://localhost:11434', revision: 1 };
const signal = new AbortController().signal;
const detail = { ...qwenContextDetail, capabilities: ['completion'] };
const runtime = { version: '0.32.15' };
const json = (value: unknown) => new Response(JSON.stringify(value));
function scan(fetcher: OllamaFetch) {
  return discoverOllama({ connection, cached: [], at, signal, fetcher });
}
describe('Ollama model discovery', () => {
  it('maps only truthful false or exact canonical named thinking controls', () => {
    expect(discoveredModel('a', 'd', 1, at, detail)).toMatchObject({
      efforts: ['none'],
      thinkingByEffort: {},
      defaultEffort: 'none',
      availability: { state: 'available' },
    });
    for (const metadata of [undefined, null, {}, { values: [true, 'extreme'] }])
      expect(
        discoveredModel('a', 'd', 1, at, {
          capabilities: ['completion', 'thinking'],
          thinking: metadata,
        }),
      ).toMatchObject({
        efforts: [],
        defaultEffort: 'none',
        availability: { state: 'unsupported' },
      });
    const full = discoveredModel('a', 'd', 1, at, {
      capabilities: ['completion', 'thinking'],
      thinking: {
        values: [false, true, 'low', 'medium', 'high', 'xhigh', 'max', 'unknown'],
        default: 'high',
      },
    });
    expect(full.efforts).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(full.defaultEffort).toBe('none');
    expect(full.thinkingByEffort).toEqual({
      none: false,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    });
    expect(
      discoveredModel('a', 'd', 1, at, {
        capabilities: ['completion', 'thinking'],
        thinking: { values: ['low', 'high'], default: 'high' },
      }).defaultEffort,
    ).toBe('high');
    expect(
      discoveredModel('a', 'd', 1, at, {
        capabilities: ['completion', 'thinking'],
        thinking: { values: ['low', 'high'], default: 'unknown' },
      }).defaultEffort,
    ).toBe('low');
    expect(
      discoveredModel('a', 'd', 1, at, { capabilities: ['embedding'] }).availability,
    ).toMatchObject({ state: 'unsupported', reason: expect.stringContaining('text completion') });
    for (const invalid of [null, {}, { capabilities: [3] }])
      expect(() => discoveredModel('a', 'd', 1, at, invalid)).toThrow();
  });
  it('supports the verified Qwen3.5 false profile only when explicit metadata is absent/null', () => {
    for (const thinking of [undefined, null])
      for (const family of [{ details: { family: 'qwen35' } }, { renderer: 'qwen3.5' }])
        expect(
          discoveredModel('unrelated-exact-id:tag', 'd', 1, at, {
            ...family,
            capabilities: ['completion', 'thinking'],
            thinking,
          }),
        ).toMatchObject({
          efforts: ['none'],
          thinkingByEffort: { none: false },
          availability: { state: 'available' },
        });
    for (const value of [
      { details: { family: 'qwen3' } },
      { details: { family: 'qwen35' }, thinking: { values: [true] } },
      { renderer: 'qwen3.5', thinking: { values: ['high'] } },
    ]) {
      const found = discoveredModel('qwen3.5:tag', 'd', 1, at, {
        capabilities: ['completion', 'thinking'],
        ...value,
      });
      expect(found.thinkingByEffort.none).toBeUndefined();
    }
  });
  it('preserves exact identities, uses fixed bounded endpoints and reuses unchanged details', async () => {
    const fetcher = vi.fn<OllamaFetch>(async (url, init) => {
      await Promise.resolve();
      expect(init?.redirect).toBe('error');
      return requestUrl(url).endsWith('/api/tags')
        ? json({
            models: [
              { model: 'namespace/qwen:tag', digest: 'sha256:a' },
              { model: 'a:latest', digest: 'sha256:b' },
            ],
          })
        : requestUrl(url).endsWith('/api/version')
          ? json(runtime)
          : json(detail);
    });
    const first = await scan(fetcher);
    expect(first.map((entry) => entry.model)).toEqual(['a:latest', 'namespace/qwen:tag']);
    expect(
      fetcher.mock.calls
        .filter((call) => requestUrl(call[0]).endsWith('/api/show'))
        .map((call) => JSON.parse(bodyText(call[1]?.body)) as unknown),
    ).toEqual([{ model: 'namespace/qwen:tag' }, { model: 'a:latest' }]);
    fetcher.mockClear();
    expect(await discoverOllama({ connection, cached: first, at, signal, fetcher })).toHaveLength(
      2,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockClear();
    await discoverOllama({
      connection: { ...connection, revision: 2 },
      cached: first,
      at,
      signal,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockClear();
    await discoverOllama({
      connection,
      cached: first.map((entry) => ({ ...entry, digest: 'changed' })),
      at,
      signal,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rechecks missing models on reappearance so unsupported metadata is not lost', async () => {
    const base = discoveredModel('a', 'd', 1, at, detail);
    for (const capabilities of [['completion'], ['embedding']]) {
      const fetcher: OllamaFetch = (url) =>
        Promise.resolve(
          requestUrl(url).endsWith('/api/tags')
            ? json({ models: [{ model: 'a', digest: 'd' }] })
            : requestUrl(url).endsWith('/api/version')
              ? json(runtime)
              : json({ ...qwenContextDetail, capabilities }),
        );
      const result = await discoverOllama({
        connection,
        at,
        signal,
        fetcher,
        cached: [
          {
            ...base,
            availability: { state: 'missing', checkedAt: at, reason: 'Previously missing' },
          },
        ],
      });
      expect(result[0]?.availability.state).toBe(
        capabilities[0] === 'completion' ? 'available' : 'unsupported',
      );
      expect(result[0]?.availability.reason).not.toBe('Previously missing');
    }
  });
  it('requalifies old snapshots and runtime upgrades, preserving visible unsupported models', async () => {
    let version = runtime.version;
    const fetcher = vi.fn<OllamaFetch>((url) =>
      Promise.resolve(
        json(
          requestUrl(url).endsWith('/api/tags')
            ? { models: [{ model: 'a', digest: 'd' }] }
            : requestUrl(url).endsWith('/api/version')
              ? { version }
              : detail,
        ),
      ),
    );
    const old = discoveredModel('a', 'd', 1, at, detail);
    const first = await discoverOllama({ connection, cached: [old], at, signal, fetcher });
    expect(first[0]).toMatchObject({
      contextProfile: OLLAMA_CONTEXT_PROFILE,
      efforts: ['none'],
      availability: { state: 'available' },
    });
    expect(
      fetcher.mock.calls.filter((call) => requestUrl(call[0]).endsWith('/api/show')),
    ).toHaveLength(1);
    version = 'future-runtime';
    const changed = await discoverOllama({ connection, cached: first, at, signal, fetcher });
    expect(changed[0]).toMatchObject({
      efforts: [],
      availability: {
        state: 'unsupported',
        reason: expect.stringContaining('no supported context-admission profile'),
      },
    });
    expect(changed[0]?.contextProfile).toBeUndefined();
    expect(
      fetcher.mock.calls.filter((call) => requestUrl(call[0]).endsWith('/api/show')),
    ).toHaveLength(2);
  });
  it('does not advertise named thinking controls that have no supported context profile', async () => {
    const fetcher: OllamaFetch = (url) =>
      Promise.resolve(
        json(
          requestUrl(url).endsWith('/api/tags')
            ? { models: [{ model: 'a', digest: 'd' }] }
            : requestUrl(url).endsWith('/api/version')
              ? runtime
              : {
                  ...detail,
                  capabilities: ['completion', 'thinking'],
                  thinking: { values: ['high'] },
                },
        ),
      );
    const [model] = await scan(fetcher);
    expect(model).toMatchObject({
      efforts: [],
      availability: { state: 'unsupported', reason: expect.stringContaining('no-thinking') },
    });
  });

  it('bounds detail concurrency to four', async () => {
    let active = 0;
    let peak = 0;
    const models = Array.from({ length: 12 }, (_, index) => ({
      model: `exact:${index}`,
      digest: String(index),
    }));
    const fetcher: OllamaFetch = async (url) => {
      if (requestUrl(url).endsWith('/api/tags')) return json({ models });
      if (requestUrl(url).endsWith('/api/version')) return json(runtime);
      active += 1;
      peak = Math.max(active, peak);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return json(detail);
    };
    expect(await scan(fetcher)).toHaveLength(12);
    expect(peak).toBe(4);
  });
  it('rejects incomplete, oversized, malformed and duplicate scans', async () => {
    for (const tags of [
      {},
      { models: 'bad' },
      { models: Array(257).fill({ model: 'a', digest: 'd' }) },
      { models: [{}] },
      { models: [{ model: 'a' }] },
      { models: [{ model: 'a', digest: '' }] },
      {
        models: [
          { model: 'a', digest: 'd' },
          { model: 'a', digest: 'e' },
        ],
      },
    ])
      await expect(scan(() => Promise.resolve(json(tags)))).rejects.toBeDefined();
    await expect(
      scan((url) =>
        Promise.resolve(
          requestUrl(url).endsWith('/api/tags')
            ? json({ models: [{ model: 'a', digest: 'd' }] })
            : new Response('', { status: 500 }),
        ),
      ),
    ).rejects.toBeDefined();
    expect(await scan(() => Promise.resolve(json({ models: [] })))).toEqual([]);
  });
  it('cancels stalled metadata readers on external abort and on the per-request deadline', async () => {
    for (const external of [true, false]) {
      const deadline = new AbortController();
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
      const caller = new AbortController();
      let cancelled = false;
      const fetcher: OllamaFetch = () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          ),
        );
      const pending = requestJson(fetcher, connection.baseUrl, '/api/tags', caller.signal);
      await new Promise((resolve) => setImmediate(resolve));
      if (external) caller.abort();
      else deadline.abort();
      await expect(pending).rejects.toMatchObject(
        external ? { name: 'AbortError' } : { code: 'OLLAMA_DISCOVERY_UNAVAILABLE' },
      );
      expect(cancelled).toBe(true);
      vi.restoreAllMocks();
    }
  });
  it('discards metadata returned after cancellation even if a transport ignores its signal', async () => {
    const controller = new AbortController();
    const fetcher: OllamaFetch = () => {
      controller.abort();
      return Promise.resolve(json({ models: [] }));
    };
    await expect(
      requestJson(fetcher, connection.baseUrl, '/api/tags', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    await expect(
      requestJson(
        () => {
          deadline.abort();
          return Promise.resolve(json({ models: [] }));
        },
        connection.baseUrl,
        '/api/tags',
        signal,
      ),
    ).rejects.toMatchObject({ code: 'OLLAMA_DISCOVERY_UNAVAILABLE' });
    vi.restoreAllMocks();
  });
  it('bounds metadata bodies, redacts failed bodies and rejects partial JSON', async () => {
    for (const fetcher of [
      () => Promise.resolve(new Response('x'.repeat(2 * 1024 * 1024 + 1))),
      () => Promise.resolve(new Response(null)),
      () => Promise.resolve(new Response('{bad')),
      () => Promise.resolve(new Response('', { status: 401 })),
      () => {
        return Promise.reject(new Error('secret'));
      },
    ])
      await expect(
        requestJson(fetcher, connection.baseUrl, '/api/tags', signal),
      ).rejects.toBeDefined();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      requestJson(
        () => {
          return Promise.reject(new Error('aborted'));
        },
        connection.baseUrl,
        '/api/tags',
        cancelled.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      requestJson(
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('secret'));
                },
              }),
            ),
          ),
        connection.baseUrl,
        '/api/tags',
        signal,
      ),
    ).rejects.toMatchObject({ code: 'OLLAMA_DISCOVERY_INVALID' });
  });
});

function requestUrl(value: Parameters<OllamaFetch>[0]): string {
  return typeof value === 'string' ? value : 'url' in value ? value.url : value.href;
}
function bodyText(value: RequestInit['body']): string {
  return typeof value === 'string' ? value : '';
}
