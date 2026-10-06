/** Focus a fallback target, adding a temporary tabindex only when it needs one. */
export function focusFallback(target: HTMLElement | null): void {
  if (!target) return;
  if (target.hasAttribute('tabindex')) {
    target.focus();
    return;
  }
  target.tabIndex = -1;
  // Chromium blurs a heading if tabindex is removed while it still has focus.
  const restore = () => {
    target.removeEventListener('blur', restore);
    target.removeAttribute('tabindex');
  };
  target.addEventListener('blur', restore, { once: true });
  target.focus();
  if (document.activeElement !== target) restore();
}

/**
 * Restore an action's focus after its DOM removal commits. A query may settle before React
 * removes the opener: watch only the expected removal, then use the explicit fallback.
 * Never refocus the opener. Stop on deliberate blur, navigation, or 500 ms after refresh settles.
 */
export function restoreFocusAfterRemoval({
  opener,
  scope,
  target,
  modal,
  refresh,
}: {
  opener: HTMLElement;
  scope: HTMLElement;
  target?: (() => HTMLElement | null) | undefined;
  modal?: HTMLDialogElement | undefined;
  refresh?: Promise<unknown> | undefined;
}): () => void {
  const document = opener.ownerDocument;
  let stopped = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(expiry);
    observer.disconnect();
    document.removeEventListener('focusin', restore);
    opener.removeEventListener('focusout', leaveOpener);
  };
  const leaveOpener = () => {
    // Removal need not emit focusout in Edge. If it does, the removal observer still owns it.
    queueMicrotask(() => {
      if (opener.isConnected && document.activeElement !== opener) stop();
    });
  };
  const restore = () => {
    if (stopped) return;
    if (!scope.isConnected) return stop();
    if (modal?.open) return;
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== opener &&
      active !== modal &&
      !modal?.contains(active)
    )
      return stop();
    if (opener.isConnected) {
      if (active !== opener) stop();
      return;
    }
    if (!target) return stop();
    const fallback = target();
    // A replacement heading/control can arrive in a later commit. Its insertion wakes us.
    if (!fallback?.isConnected) return;
    focusFallback(fallback);
    if (document.activeElement === fallback) stop();
  };
  const observer = new MutationObserver(restore);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });
  document.addEventListener('focusin', restore);
  opener.addEventListener('focusout', leaveOpener);
  const expire = () => {
    if (!stopped) expiry = setTimeout(stop, 500);
  };
  void Promise.resolve(refresh).then(expire, expire);
  restore();
  return stop;
}
