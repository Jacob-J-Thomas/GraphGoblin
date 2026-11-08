import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessStartRequest, Logger } from '@graphgoblin/engine';
import { openMemoryDatabase } from '../sqlite/db.js';
import { SqliteOllamaRepository } from '../sqlite/ollama.js';
import { SqliteModelCatalog } from '../sqlite/settings.js';
import { discoveredModel } from './discovery.js';
import { createOllamaServices } from './services.js';
import type { OllamaFetch } from './http.js';
import type { OllamaRepository } from './types.js';
const at = '2026-11-07T00:00:00.000Z';
const defaults = { enabled: true, baseUrl: 'http://localhost:11434' };
const clock = { now: () => new Date(at) };
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const json = (value: unknown) => new Response(JSON.stringify(value));
const tags = { models: [{ model: 'namespace/qwen:tag', digest: 'd' }] };
function fixture(): OllamaFetch {
  return (url) =>
    Promise.resolve(
      requestUrl(url).endsWith('/api/tags') ? json(tags) : json({ capabilities: ['completion'] }),
    );
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('Ollama discovery services', () => {
  it('coalesces concurrent refreshes before metadata resolves and retains snapshot on a later failure', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    let release: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let offline = false;
    const fetcher = vi.fn<OllamaFetch>(async (url) => {
      await Promise.resolve();
      if (offline) throw new Error('secret provider details');
      return requestUrl(url).endsWith('/api/tags') ? first : json({ capabilities: ['completion'] });
    });
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      const pending = Promise.all([service.refresh(), service.refresh(), service.refresh()]);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      release?.(json(tags));
      expect((await pending).map((status) => status.state)).toEqual(['ready', 'ready', 'ready']);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const catalog = new SqliteModelCatalog(handle.db);
      await catalog.setEnabled('ollama', 'namespace/qwen:tag', false);
      offline = true;
      expect(await service.refresh()).toMatchObject({ state: 'error', lastSuccessAt: at });
      expect(await catalog.findOne('ollama', 'namespace/qwen:tag')).toMatchObject({
        enabled: false,
        availability: { state: 'available' },
      });
      expect((await service.view()).discovery.error?.message).not.toContain('secret');
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('schedules immediate startup discovery and the five-minute cadence without generating inference', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const fetcher = vi.fn<OllamaFetch>(fixture());
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      service.start();
      service.start();
      await vi.waitFor(async () => expect((await service.view()).discovery.state).toBe('ready'));
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      expect(fetcher.mock.calls.every((call) => !requestUrl(call[0]).endsWith('/api/chat'))).toBe(
        true,
      );
      await service.stop();
      await service.stop();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('saves canonical connection and reports failed discovery as a saved error, never a false failed save', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const fetcher = vi.fn<OllamaFetch>(() => {
      return Promise.reject(new Error('offline'));
    });
    const service = createOllamaServices({
      repository,
      defaults: { ...defaults, enabled: false },
      clock,
      logger,
      fetcher,
    });
    try {
      service.start();
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetcher).not.toHaveBeenCalled();
      expect((await service.refresh()).state).toBe('idle');
      const saved = await service.configure({
        enabled: true,
        baseUrl: 'HTTPS://MODELS.EXAMPLE:443/',
      });
      expect(saved).toMatchObject({
        connection: { enabled: true, baseUrl: 'https://models.example', revision: 2 },
        discovery: { state: 'error' },
      });
      const disabled = await service.configure({
        enabled: false,
        baseUrl: 'https://models.example',
      });
      expect(disabled).toMatchObject({
        connection: { enabled: false, revision: 3 },
        discovery: { state: 'idle' },
      });
      expect(fetcher).toHaveBeenCalledOnce();
      await expect(
        service.configure({ enabled: true, baseUrl: 'http://user:password@host/api' }),
      ).rejects.toBeDefined();
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('prevents late old-origin responses from overwriting a newly configured revision', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    let release: ((response: Response) => void) | undefined;
    const old = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn<OllamaFetch>((url) =>
      Promise.resolve(
        requestUrl(url).startsWith(defaults.baseUrl)
          ? old
          : requestUrl(url).endsWith('/api/tags')
            ? json({ models: [{ model: 'new:tag', digest: 'new' }] })
            : json({ capabilities: ['completion'] }),
      ),
    );
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      const previous = service.refresh();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      const current = await service.configure({ enabled: true, baseUrl: 'https://new.example' });
      expect(current.connection.revision).toBe(2);
      expect(current.discovery.state).toBe('ready');
      release?.(json({ models: [{ model: 'old:tag', digest: 'old' }] }));
      await previous;
      expect((await repository.cached(2)).map((entry) => entry.model)).toEqual(['new:tag']);
      expect((await new SqliteModelCatalog(handle.db).list()).map((entry) => entry.model)).toEqual([
        'new:tag',
      ]);
    } finally {
      release?.(json({ models: [] }));
      await service.stop();
      handle.close();
    }
  });
  it('waits for startup storage reads and prevents dispatch when stopped before the first read finishes', async () => {
    const handle = await openMemoryDatabase();
    const real = new SqliteOllamaRepository(handle.db);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository: OllamaRepository = {
      read: async (input) => {
        await gate;
        return real.read(input);
      },
      configure: real.configure.bind(real),
      cached: real.cached.bind(real),
      markRefreshing: real.markRefreshing.bind(real),
      reconcile: real.reconcile.bind(real),
      fail: real.fail.bind(real),
    };
    const fetcher = vi.fn<OllamaFetch>(fixture());
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      service.start();
      let stopped = false;
      const pending = service.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
      release?.();
      await pending;
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      release?.();
      await service.stop();
      handle.close();
    }
  });
  it('aborts an active scan on stop and does not overwrite state after cancellation', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    const fetcher = vi.fn<OllamaFetch>((_url, init) =>
      Promise.resolve(
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      ),
    );
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      const pending = service.refresh();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      await service.stop();
      await pending;
      expect((await service.view()).discovery.state).toBe('refreshing');
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('off cancels open inference, preflight and discovery, then prohibits all new HTTP', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    await repository.read(defaults);
    await repository.reconcile(1, at, [
      discoveredModel('namespace/qwen:tag', 'd', 1, at, { capabilities: ['completion'] }),
    ]);
    const fetcher = vi.fn<OllamaFetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    const request: HarnessStartRequest = {
      model: 'namespace/qwen:tag',
      effort: 'none',
      workingDirectory: '/ignored',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: 'harmless fixture' },
    };
    try {
      const turn = service.harness.start(request, new AbortController().signal);
      const preflight = service.harness.preflight();
      const refresh = service.refresh();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      await service.configure({ ...defaults, enabled: false });
      await expect(turn.result).rejects.toMatchObject({
        code: 'HARNESS_TURN_FAILED',
        submission: 'delivery-uncertain',
        retriable: false,
      });
      expect(await preflight).toEqual({
        state: 'unknown',
        ok: false,
        problems: ['Ollama is off in Settings'],
      });
      await refresh;
      expect(await service.harness.preflight()).toEqual({
        state: 'unknown',
        ok: false,
        problems: ['Ollama is off in Settings'],
      });
      await service.refresh();
      await expect(
        service.harness.start(request, new AbortController().signal).result,
      ).rejects.toMatchObject({
        submission: 'definitely-not-submitted',
        message: 'Ollama is off in Settings',
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('rejects a captured enabled snapshot if disable or address change wins before dispatch', async () => {
    for (const disable of [true, false]) {
      const handle = await openMemoryDatabase();
      const real = new SqliteOllamaRepository(handle.db);
      await real.read(defaults);
      await real.reconcile(1, at, [
        discoveredModel('namespace/qwen:tag', 'd', 1, at, { capabilities: ['completion'] }),
      ]);
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let captured = false;
      const repository: OllamaRepository = {
        read: real.read.bind(real),
        configure: real.configure.bind(real),
        cached: async (revision) => {
          const models = await real.cached(revision);
          if (revision === 1) {
            captured = true;
            await gate;
          }
          return models;
        },
        markRefreshing: real.markRefreshing.bind(real),
        reconcile: real.reconcile.bind(real),
        fail: real.fail.bind(real),
      };
      const fetcher = vi.fn<OllamaFetch>(fixture());
      const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
      try {
        const turn = service.harness.start(
          {
            model: 'namespace/qwen:tag',
            effort: 'none',
            workingDirectory: '/ignored',
            options: { sandbox: 'read-only', approval: 'never' },
            turn: { prompt: 'harmless' },
          },
          new AbortController().signal,
        );
        await vi.waitFor(() => expect(captured).toBe(true));
        await service.configure({ enabled: !disable, baseUrl: 'https://new.example' });
        release?.();
        await expect(turn.result).rejects.toMatchObject({
          submission: 'definitely-not-submitted',
          message: disable ? 'Ollama is off in Settings' : 'Not yet listed at the new address',
        });
        expect(fetcher.mock.calls.every((call) => !requestUrl(call[0]).endsWith('/api/chat'))).toBe(
          true,
        );
      } finally {
        release?.();
        await service.stop();
        handle.close();
      }
    }
  });
  it('keeps an already dispatched turn bound to its old address when the enabled address changes', async () => {
    const handle = await openMemoryDatabase();
    const repository = new SqliteOllamaRepository(handle.db);
    await repository.read(defaults);
    await repository.reconcile(1, at, [
      discoveredModel('namespace/qwen:tag', 'd', 1, at, { capabilities: ['completion'] }),
    ]);
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let requestSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn<OllamaFetch>((url, init) => {
      if (requestUrl(url).endsWith('/api/chat')) {
        requestSignal = init?.signal;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
            }),
          ),
        );
      }
      return fixture()(url, init);
    });
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      const turn = service.harness.start(
        {
          model: 'namespace/qwen:tag',
          effort: 'none',
          workingDirectory: '/ignored',
          options: { sandbox: 'read-only', approval: 'never' },
          turn: { prompt: 'harmless' },
        },
        new AbortController().signal,
      );
      await vi.waitFor(() => expect(stream).toBeDefined());
      await service.configure({ enabled: true, baseUrl: 'https://new.example' });
      expect(requestSignal?.aborted).toBe(false);
      stream?.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            model: 'namespace/qwen:tag',
            done: true,
            message: { role: 'assistant', content: 'completed at old address' },
          }) + '\n',
        ),
      );
      stream?.close();
      expect((await turn.result).finalText).toBe('completed at old address');
      const dispatches = fetcher.mock.calls.filter((call) =>
        requestUrl(call[0]).endsWith('/api/chat'),
      );
      expect(dispatches).toHaveLength(1);
      expect(requestUrl(dispatches[0]![0])).toBe('http://localhost:11434/api/chat');
    } finally {
      await service.stop();
      handle.close();
    }
  });
  it('logs storage startup failures safely and returns the current status for a rejected refresh CAS', async () => {
    const handle = await openMemoryDatabase();
    const real = new SqliteOllamaRepository(handle.db);
    const repository: OllamaRepository = {
      read: real.read.bind(real),
      configure: real.configure.bind(real),
      cached: real.cached.bind(real),
      markRefreshing: () => Promise.resolve(false),
      reconcile: real.reconcile.bind(real),
      fail: real.fail.bind(real),
    };
    const fetcher = vi.fn<OllamaFetch>(fixture());
    const service = createOllamaServices({ repository, defaults, clock, logger, fetcher });
    try {
      expect(await service.refresh()).toEqual({ state: 'idle' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await service.stop();
      handle.close();
    }
    const failing = createOllamaServices({
      repository: {
        ...repository,
        read: () => {
          return Promise.reject(new Error('secret storage detail'));
        },
      },
      defaults,
      clock,
      logger,
      fetcher,
    });
    failing.start();
    await failing.stop();
    expect(logger.warn).toHaveBeenCalledWith(
      {},
      'Ollama discovery could not update its persisted status',
    );
  });
});

function requestUrl(value: Parameters<OllamaFetch>[0]): string {
  return typeof value === 'string' ? value : 'url' in value ? value.url : value.href;
}
