import { Link } from 'react-router';
import { Icon } from '../components/icons/index.js';
import { Badge, Button } from '../components/ui/index.js';
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

/** The editor's bar: where you are, what is published, the save state, and the loop actions. */
export function EditorToolbar({
  name,
  published,
  version,
  saveState,
  saveMessage,
  errors,
  publishing,
  onLoopSettings,
  onRun,
  onPublish,
}: {
  name: string;
  /** Whether the loop has a published version, and its number. */
  published: boolean;
  version: number | undefined;
  saveState: SaveState;
  saveMessage: string | undefined;
  errors: number;
  publishing: boolean;
  onLoopSettings: () => void;
  onRun: () => void;
  onPublish: () => void;
}) {
  return (
    <header className="relative z-[3] flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default bg-surface-raised px-4 py-2.5">
      <Link to="/loops" className="text-muted no-underline hover:text-default hover:underline">
        Loops
      </Link>
      <span className="text-subtle">/</span>
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{name}</h1>
      {published ? <Badge tone="good">published v{version}</Badge> : <Badge>draft only</Badge>}
      <span
        className="inline-flex items-center gap-1.5 text-sm text-muted"
        data-testid="save-state"
        title={saveMessage}
      >
        {saveState === 'saved' ? (
          <Icon name="check-circle" className="size-[15px] text-status-good-fg" />
        ) : null}
        {SAVE_LABEL[saveState]}
      </span>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" onClick={onLoopSettings}>
          <Icon name="sliders" />
          Loop settings
        </Button>
        <Button variant="outline" disabled={!published} onClick={onRun}>
          <Icon name="running" />
          Run
        </Button>
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
