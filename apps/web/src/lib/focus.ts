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
 * removes the opener: keep watching while focus belongs to it, then use the explicit fallback.
 * Stop when the user moves on or the owning section leaves the page.
 */
export function restoreFocusAfterRemoval({
  opener,
  scope,
  target,
  modal,
  restoreOpener = true,
}: {
  opener: HTMLElement;
  scope: HTMLElement;
  target?: (() => HTMLElement | null) | undefined;
  modal?: HTMLDialogElement | undefined;
  restoreOpener?: boolean;
}): () => void {
  const document = opener.ownerDocument;
  let stopped = false;
  const stop = () => {
    stopped = true;
    observer.disconnect();
    document.removeEventListener('focusin', restore);
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
      if (restoreOpener) opener.focus();
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
  restore();
  return stop;
}
