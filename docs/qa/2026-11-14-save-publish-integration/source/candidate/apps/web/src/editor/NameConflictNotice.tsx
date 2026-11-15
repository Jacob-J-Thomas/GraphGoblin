import { Alert, Button } from '../components/ui/index.js';
import { LOOP_NAME_RULE, sameLoopName } from '../lib/loop-names.js';
import type { DeviceCopy } from './save-status.js';
import type { EditorNameConflict } from './store.js';

const KEPT: Record<DeviceCopy, string> = {
  device: 'kept on this device',
  memory: 'kept in this window only (device storage is unavailable)',
  writing: 'kept in this editor',
};

/**
 * The editor's answer to a draft save refused for its loop name (409 `LOOP_NAME_CONFLICT`, #209).
 * It is not the stale-draft notice: nothing changed on the server and nothing is overwritten. It
 * says which name, the rule, and where the edits are, and offers the API's suggestion (an ordinary,
 * undoable rename), Edit name (the loop settings field), and Try again (the same name once more,
 * for when the other loop has since been renamed). Inside the node dialog, where the loop settings
 * are out of reach, Edit name is left out and the text says to close the dialog first.
 */
export function NameConflictNotice({
  conflict,
  currentName,
  device,
  inDialog = false,
  onUseSuggestion,
  onEditName,
  onRetry,
}: {
  conflict: EditorNameConflict;
  currentName: string;
  device: DeviceCopy;
  inDialog?: boolean;
  onUseSuggestion: (name: string) => void;
  onEditName?: () => void;
  onRetry: () => void;
}) {
  const suggestion =
    conflict.suggestedName && !sameLoopName(conflict.suggestedName, currentName)
      ? conflict.suggestedName
      : undefined;
  return (
    <Alert tone="warn" title="Another loop already has this name">
      <p>
        {`The name “${conflict.name.trim()}” matches another loop’s name, so this draft was not saved. `}
        {LOOP_NAME_RULE} Your changes are {KEPT[device]}, and the server keeps the previous name and
        draft until you choose a name no other loop has.
        {inDialog ? ' Close this dialog to edit the name in Loop settings.' : ''}
      </p>
      {conflict.retried ? <p className="mt-1">It was still in use when tried again.</p> : null}
      <span className="mt-2 flex flex-wrap gap-2">
        {suggestion ? (
          <Button size="sm" variant="outline" onClick={() => onUseSuggestion(suggestion)}>
            {`Use “${suggestion}”`}
          </Button>
        ) : null}
        {!inDialog && onEditName ? (
          <Button size="sm" variant="outline" onClick={onEditName}>
            Edit name
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-disabled={conflict.retrying || undefined}
          aria-busy={conflict.retrying || undefined}
          onClick={() => {
            if (!conflict.retrying) onRetry();
          }}
        >
          {conflict.retrying ? 'Trying again…' : 'Try again'}
        </Button>
      </span>
    </Alert>
  );
}
