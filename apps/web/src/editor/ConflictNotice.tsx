import { Alert, Button } from '../components/ui/index.js';
import type { useResolveConflict } from './useResolveConflict.js';

/**
 * "The draft changed on the server" with its two answers. The editor shows it above the canvas and,
 * while the node dialog is open (the rest of the page is inert then), inside the dialog as well.
 */
export function ConflictNotice({ resolve }: { resolve: ReturnType<typeof useResolveConflict> }) {
  return (
    <Alert tone="warn" title="The draft changed on the server">
      Another tab or device saved this loop&apos;s draft after this editor loaded it. Your changes
      are kept on this device and nothing was overwritten.{' '}
      <span className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.busy}
          onClick={() => void resolve.reload()}
        >
          Reload server draft
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.busy}
          onClick={() => void resolve.overwrite()}
        >
          Overwrite with this copy
        </Button>
      </span>
      {resolve.error ? <span className="mt-1 block">{resolve.error}</span> : null}
    </Alert>
  );
}
