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
