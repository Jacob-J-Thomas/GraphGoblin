import { OfflineBanner, useConnectionBannerClaim } from '../components/layout/index.js';
import { useConnectionStatus } from '../lib/online.js';

/**
 * The connection banner of a loaded editor (#208), shown straight under its toolbar.
 *
 * In the shell the banner sits above the routed screen, so it pushes the whole editor, Undo and
 * Redo included, down while a history session is under way. Mounting this component claims the
 * banner from the shell (`useConnectionBannerClaim`), which then hides its copy; unmounting it,
 * whatever the reason, releases the claim and the shell shows the banner again. The editor
 * renders it only for the frame it shows loaded and not inert: loading, error, blocked and voice
 * staging states leave no claim, and the shell's banner stays the only status.
 *
 * It reads the same `useConnectionStatus` as the shell and draws the same `OfflineBanner`, so
 * the wording, the offline/API-unreachable distinction and the reconnect grace are unchanged.
 */
export function EditorConnectionBanner() {
  useConnectionBannerClaim();
  const connection = useConnectionStatus();
  return connection === 'online' ? null : (
    <OfflineBanner apiUnreachable={connection === 'api-unreachable'} />
  );
}
