import type { SystemChatBinding } from '@graphgoblin/contracts';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/icons/index.js';
import { Badge, Button } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { newRunPath } from '../runs/new/paths.js';
import { HELD_INPUT_LABEL, saveLabel, type DeviceCopy } from './save-status.js';
import type { SaveState } from './store.js';
import { UndoRedo } from './UndoRedo.js';

const RUNS_LINK = cn(
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-md font-semibold pointer-coarse:h-11',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
);

const NOT_PUBLISHED = 'Publish the loop first: runs start from a published version.';

/**
 * Runs start only from the Runs page (#46); the editor links to its New run flow with this loop
 * chosen. Before the loop has a published version the link is disabled, and says why.
 */
export function OpenInRuns({ loopId, published }: { loopId: string; published: boolean }) {
  const hintId = useId();
  if (published) {
    return (
      <Link
        to={newRunPath(loopId)}
        className={cn(RUNS_LINK, 'text-link underline-offset-[3px] hover:underline')}
      >
        <Icon name="running" />
        Open in Runs
      </Link>
    );
  }
  return (
    <>
      <span
        role="link"
        aria-disabled="true"
        aria-describedby={hintId}
        tabIndex={0}
        title={NOT_PUBLISHED}
        className={cn(RUNS_LINK, 'cursor-not-allowed text-subtle')}
      >
        <Icon name="running" />
        Open in Runs
      </span>
      <span id={hintId} className="sr-only">
        {NOT_PUBLISHED}
      </span>
    </>
  );
}

/**
 * The editor's bar: where you are, what is published, the save state (the complete draft's, and
 * any field input kept in this window only), and the loop actions.
 */
export function EditorToolbar({
  loopId,
  system,
  name,
  published,
  version,
  saveState,
  device,
  heldInput = false,
  saveMessage,
  errors,
  validation,
  publishing,
  publishBlockedReason,
  onPublish,
  saveStatusRef,
}: {
  loopId: string;
  system?: SystemChatBinding | undefined;
  name: string;
  /** Whether the loop has a published version, and its number. */
  published: boolean;
  version: number | undefined;
  /** Where the server copy stands. */
  saveState: SaveState;
  /** Where the current edits are kept besides the server (`saveLabel` says which matters). */
  device: DeviceCopy;
  /** Whether a field holds input the draft does not (`hasHeldInput`), kept in this window only. */
  heldInput?: boolean;
  /** The indicator's tooltip: the save notice's text, or the server's message. */
  saveMessage: string | undefined;
  errors: number;
  /** The validation indicator, shown left of Publish. */
  validation?: ReactNode;
  publishing: boolean;
  /** A failed catalog lookup holds publication, even when cached choices remain. */
  publishBlockedReason?: string | undefined;
  onPublish: () => void;
  saveStatusRef?: Ref<HTMLSpanElement>;
}) {
  const label =
    system && saveState === 'invalid'
      ? 'Not saved: fix the chat issue'
      : saveLabel(saveState, device, heldInput);
  return (
    <header className="relative z-[3] flex items-start gap-x-3 border-b border-default bg-surface-raised px-4 py-2.5">
      {/* A fixed leading slot, first in the DOM and on screen and top-aligned: what the rest of the
          bar holds, how wide it is, and whether it wraps never moves Undo and Redo (#208). Its
          height is the row height of the bar's other controls, so each button sits where the
          first row's controls are centred. */}
      <div
        data-testid="history-actions"
        className="flex h-9 shrink-0 items-center gap-2 pointer-coarse:h-11"
      >
        <UndoRedo />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to="/loops"
          className="touch-target text-muted no-underline hover:text-default hover:underline"
        >
          Loops
        </Link>
        <span className="text-subtle">/</span>
        {/* A long name (up to 120 characters) ends in an ellipsis on its own line; hover shows it. */}
        <h1
          className="max-w-full min-w-0 truncate text-lg font-semibold tracking-[-0.01em] text-heading"
          title={name}
        >
          {name}
        </h1>
        {system ? <Badge>System</Badge> : null}
        {published ? <Badge tone="good">published v{version}</Badge> : <Badge>draft only</Badge>}
        {/* The complete draft's state, then, while a field holds input the draft does not, a
            segment of its own saying where that input is (#526). The segments wrap apart; this
            element stays the same focus target whatever they say. */}
        <span
          ref={saveStatusRef}
          className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          data-testid="save-state"
          title={saveMessage}
        >
          {label === '' ? null : (
            <span data-testid="draft-state" className="inline-flex items-center gap-1.5">
              {saveState === 'saved' ? (
                <Icon name="check-circle" className="size-[15px] text-status-good-fg" />
              ) : null}
              {saveState === 'invalid' ||
              saveState === 'offline' ||
              saveState === 'error' ||
              saveState === 'name-conflict' ? (
                <Icon
                  name={saveState === 'error' ? 'failed' : 'alert'}
                  className={cn(
                    'size-[15px]',
                    saveState === 'error' ? 'text-status-bad-fg' : 'text-status-warn-fg',
                  )}
                />
              ) : null}
              {label}
            </span>
          )}
          {heldInput ? (
            <span data-testid="held-input-state" className="inline-flex items-center gap-1.5">
              {/* Read as a sentence of its own after the draft's state. */}
              {label === '' ? null : <span className="sr-only">. </span>}
              <Icon name="alert" className="size-[15px] text-status-warn-fg" />
              {HELD_INPUT_LABEL}
            </span>
          ) : null}
        </span>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {system ? (
            <Link
              className={cn(RUNS_LINK, 'text-link')}
              to={
                system.audience.kind === 'gateway'
                  ? '/chat'
                  : `/chat/devices#device-${system.audience.deviceId}`
              }
            >
              {system.audience.kind === 'gateway' ? 'Open Chat' : 'Manage device'}
            </Link>
          ) : (
            <OpenInRuns loopId={loopId} published={published} />
          )}
          {validation}
          <Button
            onClick={onPublish}
            disabled={publishing || publishBlockedReason !== undefined}
            title={
              publishBlockedReason ??
              (errors > 0 ? `${errors} validation error(s) will block publishing` : undefined)
            }
          >
            <Icon name="send" />
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </div>
    </header>
  );
}
