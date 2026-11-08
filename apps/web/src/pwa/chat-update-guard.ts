import { anyVoiceDraftDirty, subscribeVoiceDrafts } from '../chat/recorder.js';
import {
  addChatUpdateLock,
  removeChatUpdateLock,
  startChatUpdateRuntime,
  stopChatUpdateRuntime,
} from './chat-update-lock.js';
export { getChatUpdateLocked } from './chat-update-lock.js';

const unresolvedSubmissions = new Set<string>();
const listeners = new Set<() => void>();

export const CHAT_UPDATE_PROTOCOL = 'graphgoblin-chat-update-v1';
export const CHAT_UPDATE_DIRTY_REASON =
  'Finish or discard voice drafts and resolve pending messages in all open tabs before updating.';
export const CHAT_UPDATE_UNKNOWN_REASON =
  'The update could not be verified. Return to the other tabs, or close and reopen all app windows.';
export const CHAT_UPDATE_UNSUPPORTED_REASON =
  'This browser cannot safely update open voice sessions. Close all app windows to finish updating.';

export interface ChatUpdateResult {
  accepted: boolean;
  reason?: string;
}

export interface ChatUpdateGuard {
  apply(worker: ServiceWorker | undefined): Promise<ChatUpdateResult>;
  dispose(): void;
}

export function chatUpdateLockName(scope: string): string {
  return `${CHAT_UPDATE_PROTOCOL}:${scope}`;
}

function changed(): void {
  for (const listener of listeners) listener();
}

/** Only opaque local operation keys are retained here; audio and message content stay in Chat. */
export function setChatSubmissionUnresolved(key: string, unresolved: boolean): void {
  if (unresolved === unresolvedSubmissions.has(key)) return;
  if (unresolved) unresolvedSubmissions.add(key);
  else unresolvedSubmissions.delete(key);
  changed();
}

export function isChatUpdateUnsafe(): boolean {
  return anyVoiceDraftDirty() || unresolvedSubmissions.size > 0;
}

export function subscribeChatUpdateGuard(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribeDrafts = subscribeVoiceDrafts(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeDrafts();
  };
}

/** Acquired before inspecting safety so an event cannot begin a new draft between check and ack. */
export function lockChatUpdate(attempt: string): boolean {
  addChatUpdateLock(attempt);
  changed();
  return !isChatUpdateUnsafe();
}

export function unlockChatUpdate(attempt: string): void {
  if (removeChatUpdateLock(attempt)) changed();
}

export function warnBeforeChatUnload(event: BeforeUnloadEvent): void {
  if (!isChatUpdateUnsafe()) return;
  event.preventDefault();
  // Browsers show their own message; setting returnValue also supports older WebKit.
  event.returnValue = 'Voice drafts and pending messages stay in this open app.';
}

/** SPA navigation keeps the session draft alive; only leaving the document needs a warning. */
export function watchChatUnload(): () => void {
  window.addEventListener('beforeunload', warnBeforeChatUnload);
  return () => window.removeEventListener('beforeunload', warnBeforeChatUnload);
}

/**
 * Each document owns a shared lock before enabling capture/submission. A waiting worker queues
 * an exclusive lock before asking clean pages to freeze and release theirs. New documents queue
 * behind that exclusive request, closing the client-enumeration race. A hidden/unresponsive page
 * cannot lose its shared lock merely because a timer expired.
 */
export function startChatUpdateGuard(
  scopePath: string,
  committed: (worker: ServiceWorker) => void,
): ChatUpdateGuard {
  startChatUpdateRuntime();
  const scope = new URL(scopePath, window.location.origin).href;
  const name = chatUpdateLockName(scope);
  const owner = crypto.randomUUID();
  const leaseKey = `${owner}:lease`;
  const prepared = new Set<string>();
  const removeUnload = watchChatUnload();
  const locks = navigator.locks;
  const container = navigator.serviceWorker;
  let storageKnown = true;
  // Registration also runs on non-chat routes. Seed the same opaque flags that Chat's restoration
  // owns, before a clean lease/ack can be granted and before those components have mounted.
  const storageKey =
    new URL(scope).pathname === '/goblin/'
      ? 'graphgoblin.goblin.chat.v1'
      : 'graphgoblin.owner.chat.v1';
  try {
    const raw = sessionStorage.getItem(storageKey);
    let pending = false;
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      pending =
        typeof stored === 'object' && stored !== null && 'pending' in stored && !!stored.pending;
    }
    setChatSubmissionUnresolved(`${storageKey}:turn`, pending);
    setChatSubmissionUnresolved(
      `${storageKey}.voice-upload:upload`,
      sessionStorage.getItem(`${storageKey}.voice-upload`) !== null,
    );
  } catch {
    storageKnown = false;
  }
  let disposed = false;
  let acquiring: AbortController | undefined;
  let releaseShared: (() => void) | undefined;
  let generation = 0;

  const acquireShared = () => {
    if (disposed || !locks || releaseShared || acquiring || prepared.size > 0) return;
    lockChatUpdate(leaseKey);
    const ownGeneration = ++generation;
    const abort = new AbortController();
    acquiring = abort;
    void locks
      .request(name, { mode: 'shared', signal: abort.signal }, async () => {
        if (disposed || ownGeneration !== generation || prepared.size > 0) return;
        acquiring = undefined;
        await new Promise<void>((resolve) => {
          releaseShared = resolve;
          unlockChatUpdate(leaseKey);
        });
        releaseShared = undefined;
      })
      .catch(() => {
        if (ownGeneration === generation) acquiring = undefined;
        // A failed acquisition never enables new dirty state without owning the barrier.
      });
  };

  const releaseLease = () => {
    generation++;
    acquiring?.abort();
    acquiring = undefined;
    releaseShared?.();
    releaseShared = undefined;
  };

  const message = (event: MessageEvent<unknown>) => {
    const data = event.data as Record<string, unknown> | undefined;
    if (
      !data ||
      data.protocol !== CHAT_UPDATE_PROTOCOL ||
      data.scope !== scope ||
      typeof data.attempt !== 'string' ||
      typeof data.type !== 'string'
    )
      return;
    const source = event.source as ServiceWorker | null;
    // Only this registration's worker may coordinate its pages; /app/ and /goblin/ stay separate.
    if (!source || source.scriptURL !== new URL('sw.js', scope).href) return;
    const attempt = data.attempt;
    const key = `${owner}:${attempt}`;
    if (data.type === 'PREPARE') {
      prepared.add(attempt);
      const safe = lockChatUpdate(key) && !!locks && storageKnown;
      if (safe) releaseLease();
      event.ports[0]?.postMessage({ protocol: CHAT_UPDATE_PROTOCOL, attempt, safe });
    } else if (data.type === 'ABORT') {
      if (!prepared.delete(attempt)) return;
      // Reacquire first; removing the transaction lock must not enable actions ahead of a lease.
      if (locks && !releaseShared) acquireShared();
      unlockChatUpdate(key);
    } else if (data.type === 'COMMIT' && prepared.has(attempt)) {
      committed(source);
    }
  };
  container?.addEventListener('message', message);
  acquireShared();

  return {
    apply: (worker) => {
      if (isChatUpdateUnsafe())
        return Promise.resolve({ accepted: false, reason: CHAT_UPDATE_DIRTY_REASON });
      if (!locks || !container || !worker)
        return Promise.resolve({ accepted: false, reason: CHAT_UPDATE_UNSUPPORTED_REASON });
      if (!storageKnown)
        return Promise.resolve({ accepted: false, reason: CHAT_UPDATE_UNKNOWN_REASON });
      return new Promise<ChatUpdateResult>((resolve) => {
        const channel = new MessageChannel();
        const attempt = crypto.randomUUID();
        // A timeout is failure to prove safety, never permission to release a peer's dirty state.
        const timer = setTimeout(() => {
          channel.port1.close();
          resolve({ accepted: false, reason: CHAT_UPDATE_UNKNOWN_REASON });
        }, 15_000);
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          const result = event.data as Record<string, unknown> | undefined;
          if (!result || result.protocol !== CHAT_UPDATE_PROTOCOL || result.attempt !== attempt)
            return;
          clearTimeout(timer);
          channel.port1.close();
          resolve({
            accepted: result.accepted === true,
            ...(result.accepted === true
              ? {}
              : {
                  reason:
                    typeof result.reason === 'string' ? result.reason : CHAT_UPDATE_UNKNOWN_REASON,
                }),
          });
        };
        try {
          worker.postMessage({ protocol: CHAT_UPDATE_PROTOCOL, scope, type: 'APPLY', attempt }, [
            channel.port2,
          ]);
        } catch {
          clearTimeout(timer);
          channel.port1.close();
          resolve({ accepted: false, reason: CHAT_UPDATE_UNKNOWN_REASON });
        }
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopChatUpdateRuntime();
      container?.removeEventListener?.('message', message);
      removeUnload();
      releaseLease();
      unlockChatUpdate(leaseKey);
      for (const attempt of prepared) unlockChatUpdate(`${owner}:${attempt}`);
      prepared.clear();
    },
  };
}
