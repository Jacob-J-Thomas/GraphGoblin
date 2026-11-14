import { useState, useSyncExternalStore } from 'react';

/**
 * Whether a primary press is under way (#273): from a mouse's main button, a touch or a pen going
 * down until the click it produces has been delivered, or until it ends without one. A browser
 * clicks the element where a press and its release meet, so content that appears before that click
 * can move a different element under the pointer and lose it. Leaving a text field by pressing a
 * button shows how: the field's blur runs between the press and the release.
 *
 * The press begins at `pointerdown` or `mousedown`; touch sends its compatibility `mousedown`,
 * `mouseup` and click together, after its own pointer events. Its release (`pointerup`, `mouseup`)
 * is followed in the same task by the click, at the element where press and release meet or at
 * their common ancestor, so the press ends once that click has bubbled to the window, after every
 * handler of it. A release that no click follows, or whose click is stopped on its way, ends at the
 * next task. `pointercancel`, `dragend` and the window losing focus end it at once: no click follows
 * them. Window listeners see the press and release in the capture phase, before any element can
 * stop them.
 */
let pressed = false;
/** Set from a press's release until its click has passed or the next task, whichever is first. */
let releasing: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function update(next: boolean): void {
  clearTimeout(releasing);
  releasing = undefined;
  if (pressed === next) return;
  pressed = next;
  for (const listener of [...listeners]) listener();
}

const onPress = (event: MouseEvent) => {
  if (event.button === 0) update(true);
};
const onRelease = (event: MouseEvent) => {
  if (!pressed || event.button !== 0 || releasing !== undefined) return;
  releasing = setTimeout(() => update(false), 0);
};
// Only the click that follows a release ends the press; a keyboard's click during one does not.
const onClick = () => {
  if (releasing !== undefined) update(false);
};
const onCancel = () => update(false);
// A field's blur reaches the window only in the capture phase; this listener hears its own.
const onWindowBlur = (event: FocusEvent) => {
  if (event.target === event.currentTarget) update(false);
};

const PRESSES = ['pointerdown', 'mousedown'] as const;
const RELEASES = ['pointerup', 'mouseup'] as const;
/** A drag or a touch the browser takes for scrolling ends a press without a click. */
const CANCELS = ['pointercancel', 'dragend'] as const;

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    for (const type of PRESSES) window.addEventListener(type, onPress, true);
    for (const type of RELEASES) window.addEventListener(type, onRelease, true);
    for (const type of CANCELS) window.addEventListener(type, onCancel, true);
    window.addEventListener('click', onClick);
    window.addEventListener('blur', onWindowBlur);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    for (const type of PRESSES) window.removeEventListener(type, onPress, true);
    for (const type of RELEASES) window.removeEventListener(type, onRelease, true);
    for (const type of CANCELS) window.removeEventListener(type, onCancel, true);
    window.removeEventListener('click', onClick);
    window.removeEventListener('blur', onWindowBlur);
    clearTimeout(releasing);
    releasing = undefined;
    pressed = false;
  };
}

const snapshot = () => pressed;

/** Whether a primary press is under way, read while rendering. */
export function usePrimaryPress(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * `value`, except while a primary press is under way: then what it was when the press began, until
 * the press ends. `same` says when two values show the same thing. Only content that would move
 * other content holds this way (the rename notice); edits themselves apply at once.
 */
export function useHeldDuringPress<T>(value: T, same: (a: T, b: T) => boolean = Object.is): T {
  const busy = usePrimaryPress();
  const [held, setHeld] = useState(value);
  if (!busy && !same(held, value)) setHeld(value);
  return busy ? held : value;
}
