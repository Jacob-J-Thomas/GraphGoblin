import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { Icon } from '../components/icons/index.js';
import { Badge, SidePanel } from '../components/ui/index.js';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import type { EditorIssue } from './model.js';
import { useEditorStore } from './store.js';
import { ValidationPanel } from './ValidationPanel.js';

/** The panel's element id, for the toolbar toggle's `aria-controls`. */
export const LOOP_PANEL_ID = 'loop-panel';

/** Where this browser remembers whether the panel is expanded ("expanded" or "collapsed"). */
export const LOOP_PANEL_STORAGE_KEY = 'graphgoblin-loop-panel';

/** Until the user chooses, the panel starts expanded on windows at least this wide (px). */
export const LOOP_PANEL_WIDE = 1280;

/** The default when nothing is stored: expanded on wide windows, collapsed below. */
export function loopPanelDefault(): boolean {
  return window.innerWidth >= LOOP_PANEL_WIDE;
}

/** The collapsed rail's reminder of what the validation list holds, so nothing hides unseen. */
function ValidationCount({ issues }: { issues: EditorIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (issues.length === 0) {
    return (
      <span title="Ready to publish" className="text-status-good-fg">
        <Icon name="check-circle" />
        <span className="sr-only">Ready to publish</span>
      </span>
    );
  }
  return (
    <div className="grid justify-items-center gap-1">
      {errors > 0 ? (
        <Badge tone="bad" size="sm" title={`${errors} error${errors === 1 ? '' : 's'}`}>
          <Icon name="failed" />
          {errors}
          <span className="sr-only"> error{errors === 1 ? '' : 's'}</span>
        </Badge>
      ) : null}
      {warnings > 0 ? (
        <Badge tone="warn" size="sm" title={`${warnings} warning${warnings === 1 ? '' : 's'}`}>
          <Icon name="alert" />
          {warnings}
          <span className="sr-only"> warning{warnings === 1 ? '' : 's'}</span>
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * The right-hand panel: the loop's own configuration (name, description, settings, variables) and,
 * pinned under it, the live validation list. Node editing happens in the node dialog and runs start
 * from Runs, so neither is here. It collapses to a rail that keeps the issue counts.
 */
export function LoopPanel({
  definition,
  issues,
  expanded,
  onExpandedChange,
}: {
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  // The settings forms keep their own state; a load (reload, restore) replaces the definition.
  const generation = useEditorStore((s) => s.generation);
  return (
    <SidePanel
      id={LOOP_PANEL_ID}
      title="Loop"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      rail={<ValidationCount issues={issues} />}
    >
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <LoopSettingsPanel key={generation} definition={definition} />
      </div>
      <ValidationPanel issues={issues} />
    </SidePanel>
  );
}
