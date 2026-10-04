import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { canvasFocusTarget } from './canvas-focus.js';
import { focusField } from './focus-field.js';
import { useEditorStore } from './store.js';

export type HistoryDirection = 'undo' | 'redo';

/** What `isApplePlatform` reads; `userAgentData` is not in every browser (nor in the DOM types). */
export interface PlatformInfo {
  platform: string;
  userAgentData?: { platform?: string } | undefined;
}

/** Whether the browser runs on macOS or iOS, where Cmd takes the place of Ctrl in shortcuts. */
export function isApplePlatform(info: PlatformInfo = navigator): boolean {
  return /mac|iphone|ipad|ipod/i.test(info.userAgentData?.platform || info.platform);
}

/** The shortcuts in `aria-keyshortcuts` form: Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y; Cmd on Apple. */
export function historyShortcuts(apple: boolean): Record<HistoryDirection, string> {
  return apple
    ? { undo: 'Meta+Z', redo: 'Meta+Shift+Z' }
    : { undo: 'Control+Z', redo: 'Control+Shift+Z Control+Y' };
}

/** The letter a key press stands for: its character, or on a non-Latin layout, its key's place. */
function letterOf(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : key;
}

/** Whether a key press is the undo or the redo shortcut on this platform. */
export function historyShortcut(
  event: KeyboardEvent,
  apple: boolean,
): HistoryDirection | undefined {
  // Alt excludes AltGr (Ctrl+Alt on Windows), which types characters on some layouts.
  if (event.altKey || event.isComposing) return undefined;
  const command = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command) return undefined;
  const letter = letterOf(event);
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && !apple && !event.shiftKey) return 'redo';
  return undefined;
}

const EDITABLE = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '.cm-editor',
].join(',');

/**
 * Whether a key press comes from a form control or a text editor, which keep their own undo (or
 * have none): text fields, selects, content-editable elements, and CodeMirror.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/** The focusable heading that names the nearest dialog or panel around `element`, if any. */
function namingHeading(element: Element): HTMLElement | null {
  const labelled = element.closest('[aria-labelledby]');
  const id = labelled?.getAttribute('aria-labelledby')?.split(/\s+/)[0];
  const heading = id ? document.getElementById(id) : null;
  return heading?.hasAttribute('tabindex') ? heading : null;
}

/**
 * Undo or redo one step, keeping keyboard focus where the user was. The forms that keep their own
 * state remount with the restored values, so a control focused inside one (a button, say) is
 * replaced: focus moves to the same field of the new form, else to the heading of the dialog or
 * panel it was in, else to the canvas.
 */
export function runHistory(direction: HistoryDirection): void {
  const before = document.activeElement;
  const field = before?.closest('[data-field]')?.getAttribute('data-field') ?? undefined;
  const ancestors: Element[] = [];
  for (let el = before?.parentElement; el; el = el.parentElement) ancestors.push(el);
  flushSync(() => useEditorStore.getState()[direction]());
  if (!before || before.isConnected) return;
  // Something already placed focus (a node editor that closed returns it to the canvas).
  if (document.activeElement && document.activeElement !== document.body) return;
  const anchor = ancestors.find((el) => el.isConnected);
  if (anchor && field !== undefined && focusField(anchor, field)) return;
  const fallback =
    (anchor ? namingHeading(anchor) : null) ??
    canvasFocusTarget(useEditorStore.getState().selectedNodeId);
  fallback?.focus();
}

/**
 * Undo and redo from the keyboard while the editor is open: Ctrl+Z, and Ctrl+Shift+Z or Ctrl+Y
 * (Cmd+Z and Cmd+Shift+Z on Apple platforms), with focus anywhere but a form control or text
 * editor, where the browser's (or CodeMirror's) own undo of the text keeps the keys.
 */
export function useUndoShortcuts(apple: boolean = isApplePlatform()): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      const direction = historyShortcut(event, apple);
      if (!direction) return;
      event.preventDefault();
      runHistory(direction);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [apple]);
}
