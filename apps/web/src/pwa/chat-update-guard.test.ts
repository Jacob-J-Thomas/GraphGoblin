import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_UPDATE_PROTOCOL,
  CHAT_UPDATE_DIRTY_REASON,
  CHAT_UPDATE_UNSUPPORTED_REASON,
  CHAT_UPDATE_UNKNOWN_REASON,
  chatUpdateLockName,
  getChatUpdateLocked,
  isChatUpdateUnsafe,
  lockChatUpdate,
  setChatSubmissionUnresolved,
  startChatUpdateGuard,
  subscribeChatUpdateGuard,
  unlockChatUpdate,
  warnBeforeChatUnload,
} from './chat-update-guard.js';
import {
  fakeWorkerContainer,
  flush,
  setNavigator,
  TestChannel,
  TestLocks,
  type TestPort,
} from './__fixtures__/update.js';

const drafts = vi.hoisted(() => ({ dirty: false, listeners: new Set<() => void>() }));
vi.mock('../chat/recorder.js', () => ({
  anyVoiceDraftDirty: () => drafts.dirty,
  subscribeVoiceDrafts: (listener: () => void) => {
    drafts.listeners.add(listener);
    return () => drafts.listeners.delete(listener);
  },
}));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  drafts.dirty = false;
  setChatSubmissionUnresolved('operation', false);
  setChatSubmissionUnresolved('graphgoblin.owner.chat.v1:turn', false);
  setChatSubmissionUnresolved('graphgoblin.owner.chat.v1.voice-upload:upload', false);
  sessionStorage.clear();
  unlockChatUpdate('test');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(withLocks = true) {
  vi.stubGlobal('MessageChannel', TestChannel);
  const locks = new TestLocks();
  const worker = fakeWorkerContainer();
  cleanup.push(setNavigator('locks', withLocks ? locks : undefined));
  cleanup.push(setNavigator('serviceWorker', worker.container));
  const committed = vi.fn();
  const guard = startChatUpdateGuard('/app/', committed);
  cleanup.push(guard.dispose);
  const scope = new URL('/app/', window.location.origin).href;
  const send = (type: string, attempt = 'attempt') => {
    const channel = new TestChannel();
    const reply = vi.fn();
    channel.port1.onmessage = reply;
    worker.message({ protocol: CHAT_UPDATE_PROTOCOL, scope, type, attempt }, channel.port2);
    return reply;
  };
  return { locks, worker, guard, committed, scope, send };
}

describe('chat update guard', () => {
  it('gates first paint before the registration effect has started a shared lease', async () => {
    cleanup.push(setNavigator('locks', new TestLocks()));
    cleanup.push(setNavigator('serviceWorker', new EventTarget()));
    expect(getChatUpdateLocked()).toBe(true);
    const guard = startChatUpdateGuard('/app/', vi.fn());
    cleanup.push(guard.dispose);
    await flush();
    expect(getChatUpdateLocked()).toBe(false);
  });

  it('restores unresolved metadata before chat mounts and keeps operation content local', async () => {
    sessionStorage.setItem(
      'graphgoblin.owner.chat.v1',
      JSON.stringify({ pending: { request: 'private' } }),
    );
    sessionStorage.setItem(
      'graphgoblin.owner.chat.v1.voice-upload',
      JSON.stringify({ uploadId: 'private-upload' }),
    );
    const { guard, worker, send } = harness();
    expect(isChatUpdateUnsafe()).toBe(true);
    const reply = send('PREPARE');
    await flush();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          protocol: CHAT_UPDATE_PROTOCOL,
          attempt: 'attempt',
          safe: false,
        },
      }),
    );
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_DIRTY_REASON,
    });
    expect(worker.source.postMessage).not.toHaveBeenCalled();
  });

  it('tracks only unresolved identities and voice state; warns on leaving the document', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeChatUpdateGuard(listener);
    expect(isChatUpdateUnsafe()).toBe(false);
    setChatSubmissionUnresolved('operation', true);
    setChatSubmissionUnresolved('operation', true);
    expect(listener).toHaveBeenCalledTimes(1);
    const dirty = new Event('beforeunload', { cancelable: true });
    warnBeforeChatUnload(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    setChatSubmissionUnresolved('operation', false);
    drafts.dirty = true;
    for (const changed of drafts.listeners) changed();
    expect(isChatUpdateUnsafe()).toBe(true);
    expect(lockChatUpdate('test')).toBe(false);
    expect(getChatUpdateLocked()).toBe(true);
    unlockChatUpdate('test');
    drafts.dirty = false;
    const clean = new Event('beforeunload', { cancelable: true });
    warnBeforeChatUnload(clean);
    expect(clean.defaultPrevented).toBe(false);
    unsubscribe();
    expect(drafts.listeners.size).toBe(0);
  });

  it('gates startup until its shared lease is granted and retains it while hidden', async () => {
    const { locks, scope } = harness();
    expect(getChatUpdateLocked()).toBe(true);
    await flush();
    expect(getChatUpdateLocked()).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(locks.active).toHaveLength(1);
    expect(locks.active[0]?.name).toBe(chatUpdateLockName(scope));
    setChatSubmissionUnresolved('operation', true);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('vetoes while dirty, never releases the lease, and unlocks only its own aborted attempt', async () => {
    const { locks, send } = harness();
    await flush();
    drafts.dirty = true;
    const reply = send('PREPARE');
    await flush();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ safe: false }) }),
    );
    expect(locks.active).toHaveLength(1);
    expect(getChatUpdateLocked()).toBe(true);
    send('ABORT', 'unrelated');
    expect(getChatUpdateLocked()).toBe(true);
    send('ABORT');
    expect(getChatUpdateLocked()).toBe(false);
  });

  it('freezes a clean page, releases shared, and reacquires before actions resume after abort', async () => {
    const { locks, send, scope } = harness();
    await flush();
    let releaseExclusive!: () => void;
    const exclusive = locks.request(
      chatUpdateLockName(scope),
      { mode: 'exclusive' },
      () =>
        new Promise<void>((resolve) => {
          releaseExclusive = resolve;
        }),
    );
    const reply = send('PREPARE');
    await flush();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ safe: true }) }),
    );
    expect(getChatUpdateLocked()).toBe(true);
    send('ABORT');
    await flush();
    expect(getChatUpdateLocked()).toBe(true);
    releaseExclusive();
    await exclusive;
    await flush();
    expect(getChatUpdateLocked()).toBe(false);
    expect(locks.active[0]?.mode).toBe('shared');
  });

  it('cancels a startup lease queued behind an updater and only commits a prepared attempt', async () => {
    const locks = new TestLocks();
    const scope = new URL('/app/', window.location.origin).href;
    let release!: () => void;
    const exclusive = locks.request(
      chatUpdateLockName(scope),
      { mode: 'exclusive' },
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await flush();
    cleanup.push(setNavigator('locks', locks));
    const worker = fakeWorkerContainer();
    cleanup.push(setNavigator('serviceWorker', worker.container));
    const committed = vi.fn();
    const guard = startChatUpdateGuard('/app/', committed);
    cleanup.push(guard.dispose);
    worker.message({ protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'COMMIT', attempt: 'x' });
    expect(committed).not.toHaveBeenCalled();
    worker.message({ protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'PREPARE', attempt: 'x' });
    worker.message({ protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'COMMIT', attempt: 'x' });
    expect(committed).toHaveBeenCalledTimes(1);
    release();
    await exclusive;
    await flush();
    expect(getChatUpdateLocked()).toBe(true);
    expect(locks.active).toHaveLength(0);
  });

  it('ignores another registration, malformed messages, and cross-scope attempts', async () => {
    const { worker, scope } = harness();
    await flush();
    worker.message(null);
    worker.message({
      protocol: CHAT_UPDATE_PROTOCOL,
      scope: '/goblin/',
      type: 'PREPARE',
      attempt: 'x',
    });
    worker.message(
      { protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'PREPARE', attempt: 'x' },
      undefined,
      { ...worker.source, scriptURL: new URL('/goblin/sw.js', window.location.origin).href },
    );
    expect(getChatUpdateLocked()).toBe(false);
  });

  it('refuses unsafe and unsupported updates while retaining normal actions without Web Locks', async () => {
    const { guard, worker } = harness(false);
    expect(getChatUpdateLocked()).toBe(false);
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_UNSUPPORTED_REASON,
    });
    drafts.dirty = true;
    expect(await guard.apply(undefined)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_DIRTY_REASON,
    });
  });

  it('fails closed if session recovery state cannot be inspected', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const { guard, worker, send } = harness();
    await flush();
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_UNKNOWN_REASON,
    });
    const reply = send('PREPARE');
    await flush();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ safe: false }) }),
    );
  });

  it('handles a retired worker or malformed worker reply without activating or dropping the prompt reason', async () => {
    const { guard, worker } = harness();
    await flush();
    expect(await guard.apply(undefined)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_UNSUPPORTED_REASON,
    });
    worker.source.postMessage.mockImplementation(() => {
      throw new Error('worker retired');
    });
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_UNKNOWN_REASON,
    });
    worker.source.postMessage.mockImplementation(
      (data: Record<string, unknown>, ports: TestPort[]) => {
        ports[0]?.postMessage({ protocol: 'unrelated' });
        ports[0]?.postMessage({ protocol: CHAT_UPDATE_PROTOCOL, attempt: data.attempt });
      },
    );
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: CHAT_UPDATE_UNKNOWN_REASON,
    });
  });

  it('requests only the guarded protocol and observes acceptance or a safety failure', async () => {
    const { guard, worker } = harness();
    await flush();
    worker.source.postMessage.mockImplementation(
      (data: Record<string, unknown>, ports: TestPort[]) => {
        ports[0]?.postMessage({
          protocol: CHAT_UPDATE_PROTOCOL,
          attempt: data.attempt,
          accepted: false,
          reason: 'Another draft',
        });
      },
    );
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: false,
      reason: 'Another draft',
    });
    expect(worker.source.postMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: 'APPLY', protocol: CHAT_UPDATE_PROTOCOL }),
    );
    worker.source.postMessage.mockImplementation(
      (data: Record<string, unknown>, ports: TestPort[]) => {
        ports[0]?.postMessage({
          protocol: CHAT_UPDATE_PROTOCOL,
          attempt: data.attempt,
          accepted: true,
        });
      },
    );
    expect(await guard.apply(worker.source as unknown as ServiceWorker)).toEqual({
      accepted: true,
    });
  });

  it('fails closed when the worker never replies without dropping a local preparation lock', async () => {
    vi.useFakeTimers();
    const { guard, worker, send } = harness();
    await flush();
    send('PREPARE');
    const result = guard.apply(worker.source as unknown as ServiceWorker);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toEqual({ accepted: false, reason: CHAT_UPDATE_UNKNOWN_REASON });
    expect(getChatUpdateLocked()).toBe(true);
  });
});
