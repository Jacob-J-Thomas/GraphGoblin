import { Icon } from '../components/icons/index.js';
import { Button } from '../components/ui/index.js';
import { useEditorStore } from './store.js';
import { historyShortcuts, isApplePlatform, type HistoryDirection } from './useUndoShortcuts.js';

/**
 * The history buttons' own classes on top of the ghost icon button: a 44 px target where the
 * primary pointer is coarse (touch), and no press movement. The ghost style nudges a pressed
 * button down 1 px, which moves it out from under the pointer: a press held on its top pixel row
 * lost the click (#208). These two stay where they are and show the press as a strong border
 * instead (an `aria-disabled` button, with nothing to do, keeps its ordinary look). The `!` makes
 * the override win over the ghost style's own `:active` rule whatever order the stylesheet emits
 * them in. Only these buttons change; the shared button styles are untouched.
 */
const HISTORY_BUTTON =
  'pointer-coarse:size-11 active:translate-none! not-aria-disabled:active:border-strong';

/**
 * One of the toolbar's history buttons, named by what it will change ("Undo move start"). With
 * nothing to undo or redo it is `aria-disabled` rather than disabled, so it keeps its place in
 * the Tab order and its name ("Undo") still says what it is. The name is visually hidden text
 * rather than `aria-label`, so it is never taken for the label of a field it mentions (a lookup
 * by label such as "Description" finds the field, not "Undo edit loop description").
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
      // 32 px for a mouse (the icon size), 44 px for touch.
      className={HISTORY_BUTTON}
      title={name}
      data-history={direction}
      aria-keyshortcuts={shortcut}
      aria-disabled={step === undefined ? true : undefined}
      onClick={() => {
        if (step !== undefined) useEditorStore.getState()[direction]();
      }}
    >
      <Icon name={direction} />
      <span className="sr-only">{name}</span>
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
