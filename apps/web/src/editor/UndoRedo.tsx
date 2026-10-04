import { Icon } from '../components/icons/index.js';
import { Button } from '../components/ui/index.js';
import { useEditorStore } from './store.js';
import { historyShortcuts, isApplePlatform, type HistoryDirection } from './useUndoShortcuts.js';

/**
 * One of the toolbar's history buttons, named by what it will change ("Undo move start"). With
 * nothing to undo or redo it is `aria-disabled` rather than disabled, so it keeps its place in
 * the Tab order and its name ("Undo") still says what it is.
 */
function HistoryButton({
  direction,
  step,
  shortcut,
}: {
  direction: HistoryDirection;
  /** The label of the step it would undo or redo, if any. */
  step: string | undefined;
  shortcut: string;
}) {
  const verb = direction === 'undo' ? 'Undo' : 'Redo';
  const name = step === undefined ? verb : `${verb} ${step}`;
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={name}
      title={name}
      aria-keyshortcuts={shortcut}
      aria-disabled={step === undefined ? true : undefined}
      onClick={() => {
        if (step !== undefined) useEditorStore.getState()[direction]();
      }}
    >
      <Icon name={direction} />
    </Button>
  );
}

/** The editor toolbar's Undo and Redo buttons (#17); the shortcuts are in useUndoShortcuts. */
export function UndoRedo({ apple = isApplePlatform() }: { apple?: boolean }) {
  const undoStep = useEditorStore((s) => s.past.at(-1)?.label);
  const redoStep = useEditorStore((s) => s.future.at(-1)?.label);
  const shortcuts = historyShortcuts(apple);
  return (
    <>
      <HistoryButton direction="undo" step={undoStep} shortcut={shortcuts.undo} />
      <HistoryButton direction="redo" step={redoStep} shortcut={shortcuts.redo} />
    </>
  );
}
