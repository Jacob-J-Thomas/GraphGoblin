import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/icons/index.js';
import { Badge, Button } from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { newRunPath } from '../runs/new/paths.js';
import { LOOP_PANEL_ID } from './LoopPanel.js';
import type { SaveState } from './store.js';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'All changes saved',
  invalid: 'Saved on this device only',
  offline: 'Offline: saved on this device',
  error: 'Save failed',
  conflict: 'Draft changed elsewhere',
};

const RUNS_LINK = cn(
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-md font-semibold',
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

/** The editor's bar: where you are, what is published, the save state, and the loop actions. */
export function EditorToolbar({
  loopId,
  name,
  published,
  version,
  saveState,
  saveMessage,
  errors,
  validation,
  publishing,
  loopPanelExpanded,
  onLoopSettings,
  onPublish,
  saveStatusRef,
}: {
  loopId: string;
  name: string;
  /** Whether the loop has a published version, and its number. */
  published: boolean;
  version: number | undefined;
  saveState: SaveState;
  saveMessage: string | undefined;
  errors: number;
  /** The validation indicator, shown left of Publish. */
  validation?: ReactNode;
  publishing: boolean;
  /** Whether the loop panel is expanded: "Loop settings" expands and collapses it. */
  loopPanelExpanded: boolean;
  onLoopSettings: () => void;
  onPublish: () => void;
  saveStatusRef?: Ref<HTMLSpanElement>;
}) {
  return (
    <header className="relative z-[3] flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default bg-surface-raised px-4 py-2.5">
      <Link to="/loops" className="text-muted no-underline hover:text-default hover:underline">
        Loops
      </Link>
      <span className="text-subtle">/</span>
      {/* A long name (up to 120 characters) ends in an ellipsis on its own line; hover shows it. */}
      <h1
        className="max-w-full min-w-0 truncate text-lg font-semibold tracking-[-0.01em]"
        title={name}
      >
        {name}
      </h1>
      {published ? <Badge tone="good">published v{version}</Badge> : <Badge>draft only</Badge>}
      <span
        ref={saveStatusRef}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        data-testid="save-state"
        title={saveMessage}
      >
        {saveState === 'saved' ? (
          <Icon name="check-circle" className="size-[15px] text-status-good-fg" />
        ) : null}
        {saveState === 'invalid' || saveState === 'offline' || saveState === 'error' ? (
          <Icon
            name={saveState === 'error' ? 'failed' : 'alert'}
            className={cn(
              'size-[15px]',
              saveState === 'error' ? 'text-status-bad-fg' : 'text-status-warn-fg',
            )}
          />
        ) : null}
        {SAVE_LABEL[saveState]}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          aria-expanded={loopPanelExpanded}
          aria-controls={LOOP_PANEL_ID}
          onClick={onLoopSettings}
        >
          <Icon name="sliders" />
          Loop settings
        </Button>
        <OpenInRuns loopId={loopId} published={published} />
        {validation}
        <Button
          onClick={onPublish}
          disabled={publishing}
          title={errors > 0 ? `${errors} validation error(s) will block publishing` : undefined}
        >
          <Icon name="send" />
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </header>
  );
}
