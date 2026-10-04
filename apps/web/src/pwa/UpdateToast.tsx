import { Button } from '../components/ui/index.js';
import { usePwaStore } from './store.js';

/**
 * Shown when a new build is waiting. The update happens only after the user confirms. A
 * notification, so it carries the magenta accent edge and dot (a reserved highlight moment).
 */
export function UpdateToast() {
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const confirm = usePwaStore((s) => s.confirm);
  const dismiss = usePwaStore((s) => s.dismiss);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-6 bottom-6 z-50 flex items-center gap-3 overflow-hidden rounded-lg border border-default bg-surface-overlay py-3 pr-3 pl-4 text-sm font-medium text-default shadow-3 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent-highlight before:glow-highlight-edge max-sm:inset-x-4 max-sm:bottom-4"
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-accent-highlight ring-4 ring-accent-highlight-subtle"
      />
      <span className="max-sm:flex-1">A new version is available</span>
      <Button size="sm" onClick={confirm}>
        Update
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Later
      </Button>
    </div>
  );
}
