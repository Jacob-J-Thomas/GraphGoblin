import type { ReactNode } from 'react';
import { Icon, Logo } from '../icons/index.js';
import { MainNav, type NavItem } from './MainNav.js';

/** Shown under the header while the browser or API is unreachable. */
export function OfflineBanner({ apiUnreachable = false }: { apiUnreachable?: boolean }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-status-warn-border bg-status-warn-bg px-6 py-2 text-sm max-sm:px-4"
    >
      <Icon name="offline" className="text-status-warn-fg" />
      <strong className="font-semibold text-status-warn-fg">
        {apiUnreachable ? 'Cannot reach the GraphGoblin API' : 'You are offline'}
      </strong>
      <span>
        The app keeps working with what it has; saving, running, and live updates resume when you
        reconnect.
      </span>
    </div>
  );
}

/**
 * The application frame: the dark header with the goblin mark, the main navigation, and the
 * purple-to-magenta hairline along its bottom edge, the offline banner, then the screen. #11 mounts the theme control on the header's right.
 */
export function AppShell({
  nav,
  offline = false,
  apiUnreachable = false,
  children,
}: {
  nav: readonly NavItem[];
  offline?: boolean;
  apiUnreachable?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-app text-default">
      <header className="hairline-accent relative z-20 flex h-14 shrink-0 items-center gap-8 bg-surface-inverse px-6 text-inverse max-sm:gap-2 max-sm:px-4">
        <Logo />
        <MainNav items={nav} />
      </header>
      {offline || apiUnreachable ? (
        <OfflineBanner apiUnreachable={!offline && apiUnreachable} />
      ) : null}
      {children}
    </div>
  );
}
