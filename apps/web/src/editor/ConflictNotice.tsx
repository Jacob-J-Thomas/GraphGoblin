import { Alert, Button } from '../components/ui/index.js';
import type { DeviceCopy } from './save-status.js';
import type { useResolveConflict } from './useResolveConflict.js';

const KEPT: Record<DeviceCopy, string> = {
  device: 'are kept on this device',
  memory: 'are kept in this window only (device storage is unavailable)',
  writing: 'are kept in this editor',
};

/**
 * "The draft changed on the server" with its two answers. The editor shows it above the canvas and,
 * while the node dialog is open (the rest of the page is inert then), inside the dialog as well.
 * It says where the unsaved changes are, as far as the device copy is known to hold them.
 */
export function ConflictNotice({
  resolve,
  device,
}: {
  resolve: ReturnType<typeof useResolveConflict>;
  device: DeviceCopy;
}) {
  return (
    <Alert tone="warn" title="The draft changed on the server">
      Another tab or device saved this loop&apos;s draft after this editor loaded it. Your changes{' '}
      {KEPT[device]} and nothing was overwritten.{' '}
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
