import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { SidePanel } from '../components/ui/index.js';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import { useEditorStore } from './store.js';
import type { EditorIssue } from './model.js';

/** The panel's element id, for its Show and Hide controls' `aria-controls`. */
export const LOOP_PANEL_ID = 'loop-panel';

/** Where this browser remembers whether the panel is expanded ("expanded" or "collapsed"). */
export const LOOP_PANEL_STORAGE_KEY = 'graphgoblin-loop-panel';

/** Until the user chooses, the panel starts expanded on windows at least this wide (px). */
export const LOOP_PANEL_WIDE = 1280;

/** The default when nothing is stored: expanded on wide windows, collapsed below. */
export function loopPanelDefault(): boolean {
  return window.innerWidth >= LOOP_PANEL_WIDE;
}

/**
 * The right-hand panel: the loop's own configuration (name, description, settings, variables).
 * Node editing happens in the node dialog, runs start from Runs, and validation shows on the nodes'
 * badges and the toolbar's indicator beside Publish (#15), so none of them is here. It collapses to
 * a rail with its Show button.
 */
export function LoopPanel({
  definition,
  issues,
  expanded,
  onExpandedChange,
}: {
  definition: LoopDefinitionInput;
  issues?: readonly EditorIssue[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  // The settings forms keep their own state; a load (reload, restore) replaces the definition,
  // and an undo or redo restores another one.
  const generation = useEditorStore((s) => s.generation);
  const historyEpoch = useEditorStore((s) => s.historyEpoch);
  return (
    <SidePanel
      id={LOOP_PANEL_ID}
      title="Loop settings"
      icon="sliders"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <div className="relative min-h-0 flex-1 overflow-auto p-5">
        <LoopSettingsPanel
          key={`${generation}:${historyEpoch}`}
          definition={definition}
          issues={issues}
        />
      </div>
    </SidePanel>
  );
}
