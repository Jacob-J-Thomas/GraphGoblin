import type { LoopDefinition, LoopDefinitionInput } from '@graphgoblin/contracts';
import { cn } from '../lib/utils.js';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import type { EditorIssue } from './model.js';
import { RunLauncher } from './RunLauncher.js';
import { ValidationPanel } from './ValidationPanel.js';

export type PanelTab = 'loop' | 'run';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'loop', label: 'Loop' },
  { id: 'run', label: 'Run' },
];

/** The right-hand panel: Loop and Run tabs over the live validation results. Nodes edit in a dialog. */
export function EditorSidePanel({
  tab,
  onTab,
  definition,
  issues,
  loopId,
  settingsEpoch,
  published,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  loopId: string;
  settingsEpoch: number;
  published: LoopDefinition | undefined;
}) {
  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-default bg-surface-raised">
      <div
        className="flex shrink-0 gap-1 border-b border-default px-4"
        role="tablist"
        aria-label="Panels"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={cn(
              'relative h-[46px] cursor-pointer px-3 font-medium text-muted hover:text-default',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              'aria-selected:font-semibold aria-selected:text-default',
              'after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-t-[3px]',
              'aria-selected:after:bg-accent-strong',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="p-5">
          {tab === 'loop' ? (
            <LoopSettingsPanel definition={definition} epoch={settingsEpoch} />
          ) : null}
          {tab === 'run' ? (
            published ? (
              <RunLauncher loopId={loopId} published={published} />
            ) : (
              <p className="text-sm text-muted">Publish the loop to run it.</p>
            )
          ) : null}
        </div>
        <ValidationPanel issues={issues} />
      </div>
    </aside>
  );
}
