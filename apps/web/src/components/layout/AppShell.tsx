import type { ReactNode } from 'react';
import { Icon, Logo } from '../icons/index.js';
import { MainNav, type NavItem } from './MainNav.js';

/**
 * Shown while the browser or API is unreachable: under the shell's header, or, for a loaded
 * editor that claimed it (`connection-banner.ts`), under the editor's own toolbar.
 */
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
        The app keeps working with what it has; saving, running, and live updates resume{' '}
        {apiUnreachable ? 'when the API is reachable again.' : 'when you reconnect.'}
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
      {/* At least 56 px, growing with its content instead of a fixed row: where enlarged text
          or a narrow viewport cannot hold the logo and the navigation side by side, the
          navigation wraps under the logo (below 640 px, Menu moves to a row of its own at the
          right, and its panel opens under the header's actual bottom edge). A row that fits is
          the same 56 px row as before (#563). */}
      <header className="hairline-accent relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-8 gap-y-0 bg-surface-inverse px-6 text-inverse max-sm:gap-2 max-sm:px-4 max-sm:py-1.5">
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
