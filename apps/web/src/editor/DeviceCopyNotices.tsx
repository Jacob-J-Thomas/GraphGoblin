import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { useId } from 'react';
import { Alert, Button } from '../components/ui/index.js';
import { downloadJson, fileSlug, formatDateTime } from '../lib/utils.js';
import type { DeviceCopy } from './useLoadEditor.js';

const KIND: Record<DeviceCopy['source'], string> = {
  active: 'an unsaved draft',
  'set-aside': 'a set-aside draft',
  archive: 'an archived copy',
};

/** The stored record exactly as IndexedDB holds it, as a JSON download. */
function exportCopy(loopId: string, copy: DeviceCopy, what: string): void {
  const { source: _source, ...stored } = copy;
  downloadJson(`${fileSlug(loopId)}-${what}.json`, stored);
}

type Discard = (copy: DeviceCopy) => Promise<void>;

/**
 * A device copy written by an older build (ADR-0042). It is never converted, loaded or
 * overwritten; the notice says which copy of which loop a discard removes, and that only this
 * browser's copy goes.
 */
export function UnsupportedDeviceDraft({
  loopId,
  copy,
  onDiscard,
}: {
  loopId: string;
  copy: DeviceCopy;
  onDiscard: Discard;
}) {
  const id = useId();
  const definition = copy.definition as { schemaVersion?: unknown; name?: unknown };
  const format =
    typeof definition.schemaVersion === 'number'
      ? `format ${String(definition.schemaVersion)}`
      : 'an unknown format';
  const name =
    typeof definition.name === 'string' && definition.name !== ''
      ? `“${definition.name}”`
      : 'this loop';
  return (
    <Alert tone="warn" title={`Unsupported device draft (${format})`}>
      <span id={id}>
        This browser holds {KIND[copy.source]} of {name} (loop {copy.loopId}), saved{' '}
        {formatDateTime(copy.savedAt)}, in {format}. This build opens only format{' '}
        {CURRENT_DEFINITION_FORMAT} drafts and does not convert older ones. Discarding removes only
        this copy from this browser; the loop on the server and drafts in other browsers stay as
        they are.
      </span>
      <span className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportCopy(loopId, copy, 'unsupported-device-draft')}
        >
          Export this device draft
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-describedby={id}
          onClick={() => void onDiscard(copy)}
        >
          Discard this device draft
        </Button>
      </span>
    </Alert>
  );
}

/** A current-format device copy archived before a newer copy replaced it. */
export function DeviceBackup({
  loopId,
  copy,
  onDiscard,
}: {
  loopId: string;
  copy: DeviceCopy;
  onDiscard: Discard;
}) {
  return (
    <Alert tone="warn" title="Saved device backup">
      This saved device draft from {formatDateTime(copy.savedAt)} is kept as a backup. Export it
      before discarding it if you need to recover it later.
      <span className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportCopy(loopId, copy, 'device-backup')}
        >
          Export device backup
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onDiscard(copy)}>
          Discard this device copy
        </Button>
      </span>
    </Alert>
  );
}

/** A device copy that must be archived and read back before it can be replaced, but was not. */
export function UnpreservedDeviceCopy({
  loopId,
  copy,
  onDiscard,
}: {
  loopId: string;
  copy: DeviceCopy;
  onDiscard: Discard;
}) {
  return (
    <Alert tone="warn" title="This device copy could not be preserved">
      The copy from {formatDateTime(copy.savedAt)} must be archived and read back before it can be
      replaced. It is unchanged on this device.
      <span className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => exportCopy(loopId, copy, 'original-device-copy')}
        >
          Export original device copy
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onDiscard(copy)}>
          Discard this device copy
        </Button>
      </span>
    </Alert>
  );
}
