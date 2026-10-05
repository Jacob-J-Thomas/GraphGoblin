import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { canvasFocusTarget } from './canvas-focus.js';
import { focusableIn, focusField, groupFocus } from './focus-field.js';
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

/** Input types whose text the browser edits, and so undoes, itself. */
const TEXT_INPUTS = new Set([
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

const TEXT_EDITORS = [
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '.cm-editor',
].join(',');

/**
 * Whether a key press comes from a text editor, which keeps its own undo of the text: a text-entry
 * input, a textarea, a content-editable element, or CodeMirror, including anything inside one (the
 * search panel's checkboxes in a code editor belong to that editor). Elsewhere checkboxes, radios,
 * switches, selects, and buttons have no text to undo, so the editor's undo applies there.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(TEXT_EDITORS) !== null) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

/** The focusable heading that names the nearest dialog or panel around `element`, if any. */
function namingHeading(element: Element): HTMLElement | null {
  const labelled = element.closest('[aria-labelledby]');
  const id = labelled?.getAttribute('aria-labelledby')?.split(/\s+/)[0];
  const heading = id ? document.getElementById(id) : null;
  return heading?.hasAttribute('tabindex') ? heading : null;
}

/**
 * What a control is, as far as a remounted copy of it can tell: its element, type, role, and
 * name (its `aria-label`, else its label's text, else its own text). Ids are generated per mount,
 * so they cannot say it.
 */
function identity(el: HTMLElement): string {
  const labels = 'labels' in el ? (el as HTMLInputElement).labels : null;
  const name = el.getAttribute('aria-label') ?? labels?.[0]?.textContent ?? el.textContent;
  const type = el.getAttribute('type') ?? '';
  return `${el.tagName}|${type}|${el.getAttribute('role') ?? ''}|${(name ?? '').trim()}`;
}

/** Where a control sits among the focusable controls of a part of the page. */
interface Whereabouts {
  identity: string;
  /** Which of the controls with the same identity it is. */
  nth: number;
  /** Its place among all of them. */
  place: number;
}

function whereabouts(control: HTMLElement, scope: Element): Whereabouts {
  const all = focusableIn(scope);
  const id = identity(control);
  const same = all.filter((el) => identity(el) === id);
  return { identity: id, nth: same.indexOf(control), place: all.indexOf(control) };
}

/**
 * The control in `scope` that stands where the old one did: the same control (by identity, the
 * last of its kind when there are fewer now), else, with `byPlace`, whatever is in its place now.
 */
function findAgain(scope: Element, where: Whereabouts, byPlace: boolean): HTMLElement | undefined {
  const all = focusableIn(scope);
  const same = all.filter((el) => identity(el) === where.identity);
  return same[Math.min(where.nth, same.length - 1)] ?? (byPlace ? all[where.place] : undefined);
}

/**
 * Undo or redo one step, keeping keyboard focus where the user was. The forms that keep their own
 * state remount with the restored values, so a control focused inside one (a checkbox, a select,
 * a button) is replaced. Focus moves to the same control in the same field of the new form (else
 * to whatever is in its place, else to the field's first control); outside any field, to the same
 * control in the part of the page that stayed; failing those, to the heading of the dialog or
 * panel it was in, else to the canvas. A radio stands for its group's checked radio. The same
 * control is the one with the same element, type, role, and name, counted among its namesakes.
 */
export function runHistory(direction: HistoryDirection): void {
  const before = document.activeElement;
  const control = before instanceof HTMLElement && before !== document.body ? before : undefined;
  const field = control?.closest('[data-field]');
  const path = field?.getAttribute('data-field') ?? undefined;
  const inField = field && control ? whereabouts(control, field) : undefined;
  // The innermost element around the control that survives the remount is only known afterwards.
  const around: { element: Element; where: Whereabouts }[] = [];
  if (control) {
    for (let el = control.parentElement; el && el !== document.body; el = el.parentElement) {
      around.push({ element: el, where: whereabouts(control, el) });
    }
  }
  flushSync(() => useEditorStore.getState()[direction]());
  if (!control || control.isConnected) return;
  // Something already placed focus (a node editor that closed returns it to the canvas).
  if (document.activeElement && document.activeElement !== document.body) return;
  const kept = around.find(({ element }) => element.isConnected);
  const anchor = kept?.element;
  if (anchor && path !== undefined && inField) {
    const again = [...anchor.querySelectorAll('[data-field]')].find(
      (el) => el.getAttribute('data-field') === path,
    );
    const target = again ? findAgain(again, inField, true) : undefined;
    if (again && target) {
      groupFocus(target, again).focus();
      return;
    }
    if (focusField(anchor, path)) return;
  }
  // Outside a field only the same control will do: a node card an undo removed is not replaced by
  // its neighbour.
  const target = kept ? findAgain(kept.element, kept.where, false) : undefined;
  if (anchor && target) {
    groupFocus(target, anchor).focus();
    return;
  }
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
