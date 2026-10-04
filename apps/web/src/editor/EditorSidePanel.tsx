import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { LoopSettingsPanel } from './LoopSettingsPanel.js';
import type { EditorIssue } from './model.js';
import { ValidationPanel } from './ValidationPanel.js';

/**
 * The right-hand panel: the loop's settings over the live validation results. Nodes edit in a
 * dialog and runs start from the Runs page.
 */
export function EditorSidePanel({
  definition,
  issues,
  settingsEpoch,
}: {
  definition: LoopDefinitionInput;
  issues: EditorIssue[];
  settingsEpoch: number;
}) {
  return (
    <aside
      aria-label="Loop"
      className="flex w-[380px] shrink-0 flex-col border-l border-default bg-surface-raised"
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="p-5">
          <LoopSettingsPanel definition={definition} epoch={settingsEpoch} />
        </div>
        <ValidationPanel issues={issues} />
      </div>
    </aside>
  );
}
