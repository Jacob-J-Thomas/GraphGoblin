import { Button } from '../components/ui/index.js';
import { usePwaStore } from './store.js';

/** Shown when a new build is waiting. The update happens only after the user confirms. */
export function UpdateToast() {
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const confirm = usePwaStore((s) => s.confirm);
  const dismiss = usePwaStore((s) => s.dismiss);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-slate-300 bg-white p-3 shadow-lg"
    >
      <span className="text-sm">A new version is available</span>
      <Button size="sm" onClick={confirm}>
        Update
      </Button>
      <Button size="sm" variant="ghost" onClick={dismiss}>
        Later
      </Button>
    </div>
  );
}
