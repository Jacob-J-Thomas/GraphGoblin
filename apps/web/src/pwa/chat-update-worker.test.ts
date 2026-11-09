import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_UPDATE_PROTOCOL, chatUpdateLockName } from './chat-update-guard.js';
import { flush, TestChannel, TestLocks, type TestPort } from './__fixtures__/update.js';

const source = readFileSync(resolve('public/chat-update-worker.js'), 'utf8');
afterEach(() => vi.useRealTimers());

interface TestPage {
  id: string;
  url: string;
  dirty: boolean;
  hidden: boolean;
  frozen: boolean;
  messages: string[];
  postMessage(data: Record<string, unknown>, ports?: TestPort[]): void;
  close(): void;
}
interface WorkerEvent {
  data: Record<string, unknown> | null;
  source?: TestPage;
  ports?: TestPort[];
  stopImmediatePropagation?: () => void;
  waitUntil?: (promise: Promise<void>) => void;
}

function harness(withLocks = true) {
  const scope = 'https://example.test/app/';
  const locks = new TestLocks();
  const worker = Object.assign(new EventTarget(), {
    state: 'installed',
    scriptURL: `${scope}sw.js`,
  });
  const clients: TestPage[] = [];
  let listener!: (event: WorkerEvent) => void;
  const skipWaiting = vi.fn(async () => {
    worker.state = 'activating';
    worker.dispatchEvent(new Event('statechange'));
    await Promise.resolve();
    worker.state = 'activated';
    worker.dispatchEvent(new Event('statechange'));
  });
  let onList: (() => void) | undefined;
  let listCalls = 0;
  let capability: Record<string, unknown> | null = {
    protocol: CHAT_UPDATE_PROTOCOL,
    scope,
    generation: 'chat-session-web-lock-v1',
  };
  const active = {
    state: 'activated',
    postMessage: vi.fn((data: Record<string, unknown>, ports: TestPort[]) => {
      if (capability) ports[0]?.postMessage({ ...capability, attempt: data.attempt });
    }),
  };
  runInNewContext(source, {
    self: {
      registration: { scope, waiting: worker, active },
      location: { href: worker.scriptURL },
      skipWaiting,
      clients: {
        matchAll: () => {
          listCalls++;
          onList?.();
          return Promise.resolve([...clients]);
        },
      },
      addEventListener: (_type: string, next: typeof listener) => {
        listener = next;
      },
    },
    navigator: { locks: withLocks ? locks : undefined },
    MessageChannel: TestChannel,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  function page(
    id: string,
    options: { dirty?: boolean; hidden?: boolean; scope?: string; legacy?: boolean } = {},
  ): TestPage {
    const messages: string[] = [];
    let release!: () => void;
    const item = {
      id,
      url: `${options.scope ?? scope}chat`,
      dirty: options.dirty ?? false,
      hidden: options.hidden ?? false,
      frozen: !options.legacy,
      postMessage: (data: Record<string, unknown>, ports?: TestPort[]) => {
        messages.push(String(data.type));
        if (options.legacy) return;
        if (data.type === 'PREPARE' && !item.hidden) {
          item.frozen = true;
          if (!item.dirty) release?.();
          ports?.[0]?.postMessage({
            protocol: CHAT_UPDATE_PROTOCOL,
            attempt: data.attempt,
            safe: !item.dirty,
          });
        } else if (data.type === 'ABORT') {
          // Real pages reacquire shared before unfreezing. Worker tests retain the frozen marker.
        }
      },
      messages,
      close: () => {
        release?.();
        clients.splice(clients.indexOf(item), 1);
      },
    };
    clients.push(item);
    if (!options.legacy)
      void locks.request(chatUpdateLockName(options.scope ?? scope), { mode: 'shared' }, () => {
        item.frozen = false;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    return item;
  }
  const apply = (requester: ReturnType<typeof page>, attempt = 'attempt') => {
    const channel = new TestChannel();
    const replies: Record<string, unknown>[] = [];
    channel.port1.onmessage = (event) => replies.push(event.data as Record<string, unknown>);
    let work: Promise<void> | undefined;
    const stopped = vi.fn();
    listener({
      data: { protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'APPLY', attempt },
      source: requester,
      ports: [channel.port2],
      stopImmediatePropagation: stopped,
      waitUntil: (promise: Promise<void>) => {
        work = promise;
      },
    });
    return { replies, stopped, done: () => work };
  };
  return {
    locks,
    page,
    apply,
    clients,
    skipWaiting,
    worker,
    active,
    scope,
    listener: () => listener,
    setOnList: (callback: () => void) => {
      onList = callback;
    },
    listCalls: () => listCalls,
    setCapability: (value: Record<string, unknown> | null) => {
      capability = value;
    },
  };
}

describe('waiting worker update barrier', () => {
  it('refuses a preguard active shell even when a new legacy tab appears during admission', async () => {
    vi.useFakeTimers();
    const h = harness();
    const one = h.page('one');
    await flush();
    let legacy: TestPage | undefined;
    h.active.postMessage.mockImplementation(() => {
      legacy = h.page('legacy', { dirty: true, legacy: true });
    });
    const update = h.apply(one);
    await vi.advanceTimersByTimeAsync(2_000);
    await update.done();
    expect(update.replies[0]?.accepted).toBe(false);
    expect(update.replies[0]?.reason).toBe(
      'An older version is still running. Close all app windows to finish updating.',
    );
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(one.messages).toEqual([]);
    expect(legacy?.frozen).toBe(false);
  });

  it.each([
    {
      protocol: 'older-protocol',
      scope: 'https://example.test/app/',
      generation: 'chat-session-web-lock-v1',
    },
    {
      protocol: CHAT_UPDATE_PROTOCOL,
      scope: 'https://example.test/goblin/',
      generation: 'chat-session-web-lock-v1',
    },
    {
      protocol: CHAT_UPDATE_PROTOCOL,
      scope: 'https://example.test/app/',
      generation: 'unguarded-generation',
    },
  ])('refuses an incompatible active capability %j', async (capability) => {
    const h = harness();
    const one = h.page('one');
    await flush();
    h.setCapability(capability);
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(update.replies[0]?.accepted).toBe(false);
    expect(update.replies[0]?.reason).toBe(
      'An older version is still running. Close all app windows to finish updating.',
    );
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(one.messages).toEqual([]);
  });

  it('advertises only this production guard generation through the scoped protocol', async () => {
    const h = harness();
    const channel = new TestChannel();
    const reply = vi.fn();
    channel.port1.onmessage = reply;
    h.listener()({
      data: {
        protocol: CHAT_UPDATE_PROTOCOL,
        scope: h.scope,
        type: 'CAPABILITY',
        attempt: 'probe',
      },
      ports: [channel.port2],
    });
    await flush();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          protocol: CHAT_UPDATE_PROTOCOL,
          scope: h.scope,
          attempt: 'probe',
          generation: 'chat-session-web-lock-v1',
        },
      }),
    );
  });

  it('freezes two clean tabs before activation and holds exclusive through fully activated state', async () => {
    const h = harness();
    const one = h.page('one');
    const two = h.page('two');
    await flush();
    h.skipWaiting.mockImplementation(async () => {
      expect(one.frozen).toBe(true);
      expect(two.frozen).toBe(true);
      expect(h.locks.active.some((lock) => lock.mode === 'exclusive')).toBe(true);
      h.worker.state = 'activating';
      h.worker.dispatchEvent(new Event('statechange'));
      await Promise.resolve();
      expect(h.locks.active.some((lock) => lock.mode === 'exclusive')).toBe(true);
      h.worker.state = 'activated';
      h.worker.dispatchEvent(new Event('statechange'));
    });
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
    expect(one.messages).toEqual(['PREPARE', 'COMMIT']);
    expect(two.messages).toEqual(['PREPARE', 'COMMIT']);
    expect(update.replies[0]?.accepted).toBe(true);
  });

  it('a dirty tab vetoes activation and clearing it allows a later explicit attempt', async () => {
    const h = harness();
    const one = h.page('one');
    const two = h.page('two', { dirty: true });
    await flush();
    const blocked = h.apply(one);
    await blocked.done();
    await flush();
    expect(h.skipWaiting).not.toHaveBeenCalled();
    expect(blocked.replies[0]?.accepted).toBe(false);
    expect(one.messages).toEqual(['PREPARE', 'ABORT']);
    two.dirty = false;
    const retry = h.apply(one, 'retry');
    await retry.done();
    await flush();
    expect(retry.replies[0]?.accepted).toBe(true);
    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'an unresponsive hidden tab is never expired as safe (dirty=%s)',
    async (dirty) => {
      vi.useFakeTimers();
      const h = harness();
      const one = h.page('one');
      const hidden = h.page('hidden', { hidden: true, dirty });
      await flush();
      const update = h.apply(one);
      await vi.advanceTimersByTimeAsync(10_000);
      await update.done();
      expect(h.skipWaiting).not.toHaveBeenCalled();
      expect(update.replies[0]?.accepted).toBe(false);
      expect(h.locks.active.some((lock) => lock.mode === 'shared')).toBe(true);
      expect(hidden.messages).toContain('ABORT');
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
      expect(h.skipWaiting).not.toHaveBeenCalled();
    },
  );

  it('new tabs are gated behind the worker exclusive lock during the final client-list race', async () => {
    const h = harness();
    const one = h.page('one');
    await flush();
    let late: ReturnType<typeof h.page> | undefined;
    h.setOnList(() => {
      if (h.listCalls() === 2) late = h.page('late');
    });
    h.skipWaiting.mockImplementation(() => {
      expect(late?.frozen).toBe(true);
      expect(h.locks.active.some((lock) => lock.mode === 'exclusive')).toBe(true);
      h.worker.state = 'activated';
      h.worker.dispatchEvent(new Event('statechange'));
      return Promise.resolve();
    });
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(late?.messages).toEqual(['PREPARE', 'COMMIT']);
    expect(update.replies[0]?.accepted).toBe(true);
  });

  it('a page opened after the final snapshot cannot enable dirty actions before activation', async () => {
    const h = harness();
    const one = h.page('one');
    await flush();
    let late: ReturnType<typeof h.page> | undefined;
    h.skipWaiting.mockImplementation(async () => {
      late = h.page('after-snapshot');
      await flush();
      expect(late.frozen).toBe(true);
      h.worker.state = 'activated';
      h.worker.dispatchEvent(new Event('statechange'));
    });
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(update.replies[0]?.accepted).toBe(true);
    expect(late?.frozen).toBe(false);
    expect(late?.messages).toEqual([]);
    late?.close();
  });

  it('fails closed without worker Web Locks and blocks the generic Workbox bypass', async () => {
    const h = harness(false);
    const one = h.page('one');
    await flush();
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(update.replies[0]?.accepted).toBe(false);
    expect(update.replies[0]?.reason).toBe(
      'This browser cannot safely update open voice sessions. Close all app windows to finish updating.',
    );
    const stopped = vi.fn();
    h.listener()({ data: { type: 'SKIP_WAITING' }, stopImmediatePropagation: stopped });
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });

  it('isolates app and Goblin scopes, ignores malformed messages, and refuses unknown requesters', async () => {
    const h = harness();
    const one = h.page('one');
    const goblin = h.page('goblin', { scope: 'https://example.test/goblin/', dirty: true });
    await flush();
    h.listener()({
      data: {
        protocol: CHAT_UPDATE_PROTOCOL,
        scope: 'https://example.test/goblin/',
        type: 'APPLY',
        attempt: 'x',
      },
    });
    h.listener()({ data: null });
    const update = h.apply(one);
    await update.done();
    await flush();
    expect(update.replies[0]?.accepted).toBe(true);
    expect(goblin.messages).toEqual([]);
    goblin.close();
  });
});
