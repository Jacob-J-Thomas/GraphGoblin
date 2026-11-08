// This leaf owns only the local action gate. It never imports recorder or submission state:
// the recorder can check the gate without importing the coordinator that inspects its drafts.
const updateLocks = new Set<string>();
let guardRuntimes = 0;
let guardExpected = true;

/** Entry points declare this before rendering; startup failures and disposal never disable it. */
export function setChatUpdateGuardExpected(expected: boolean): void {
  guardExpected = expected;
}

/** A transaction lock is separate from ordinary draft dirtiness. */
export function getChatUpdateLocked(): boolean {
  // The first paint can precede registration's React effect. New documents must stay gated even
  // in that gap, otherwise a user event could create dirty state ahead of its shared lease.
  return (
    updateLocks.size > 0 ||
    (guardRuntimes === 0 &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      !!navigator.locks &&
      // Development can explicitly omit registration, but an existing controller can still
      // update this page. Skipping registration alone does not make that page safe to use.
      (guardExpected || !!navigator.serviceWorker?.controller))
  );
}

export function addChatUpdateLock(attempt: string): void {
  updateLocks.add(attempt);
}

export function removeChatUpdateLock(attempt: string): boolean {
  return updateLocks.delete(attempt);
}

export function startChatUpdateRuntime(): void {
  guardRuntimes++;
}

export function stopChatUpdateRuntime(): void {
  guardRuntimes--;
}
