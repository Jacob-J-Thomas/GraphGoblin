import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * Who shows the one connection banner (#208).
 *
 * The app shell shows it under its header, above whichever screen is routed. Above the editor that
 * placement moves the whole editor, Undo and Redo included, down by the banner's height whenever
 * the browser goes offline or the API becomes unreachable. A loaded editor therefore claims the
 * banner for as long as it is mounted and shows it itself, below its own toolbar; the shell hides
 * its copy while a claim is held, so there is never a second visible or announced status.
 *
 * A claim is an object of its own, so overlapping claims (one editor leaving in the commit that
 * another arrives) and a repeated release (React's development remount of effects) cannot leave
 * the count wrong: the banner is claimed while at least one unreleased claim exists.
 */
const claims = new Set<symbol>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of [...listeners]) listener();
}

/** Take the banner until the returned function releases it. Releasing twice does nothing. */
export function claimConnectionBanner(): () => void {
  const claim = Symbol('connection banner claim');
  claims.add(claim);
  changed();
  return () => {
    if (claims.delete(claim)) changed();
  };
}

/** Whether a screen currently shows the connection banner itself. */
export function isConnectionBannerClaimed(): boolean {
  return claims.size > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the shell must leave the connection banner to a screen that claimed it. */
export function useConnectionBannerClaimed(): boolean {
  return useSyncExternalStore(subscribe, isConnectionBannerClaimed, () => false);
}

/**
 * Claim the connection banner while the calling component is mounted. It is a layout effect so
 * the shell hides its copy before the browser paints the screen's own, and the claim goes with
 * the component however it unmounts: navigation, a failed render caught by the error boundary,
 * or the remount of an effect that React's strict mode replays.
 */
export function useConnectionBannerClaim(): void {
  useLayoutEffect(() => claimConnectionBanner(), []);
}
