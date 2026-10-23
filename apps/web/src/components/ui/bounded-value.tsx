import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cachedJsonPrefix, cn, downloadJson, prettyJson } from '../../lib/utils.js';
import { Button } from './button.js';

/**
 * Characters of a value shown before the viewer asks for the rest: about a hundred lines of
 * pretty-printed JSON, enough to read a value and small enough that a thread full of such values
 * lays out without a long task (#259). The stored value is never cut; only the text on screen is.
 */
export const VALUE_PREVIEW_CHARS = 4_096;
/** The tighter bound for a value inside a table cell, a diff column or a progress row. */
export const CELL_PREVIEW_CHARS = 1_024;

const TONES = {
  code: 'rounded-md border border-default bg-code-bg font-mono text-[12.5px] text-code-fg',
  removed: 'bg-status-bad-bg font-mono text-[12.5px] text-status-bad-fg',
  added: 'bg-status-good-bg font-mono text-[12.5px] text-status-good-fg',
  plain: 'text-md',
  heading: 'text-lg font-semibold',
} as const;

export interface BoundedValueProps {
  /** The exact stored value, shown as pretty JSON (or as itself, with `text`). */
  value: unknown;
  /** Show a string as text instead of as a JSON string literal. */
  text?: boolean;
  /** The accessible name of the controls, and of the text once it scrolls (or when `labelled`). */
  label: string;
  /**
   * Name the text itself with `label` even while it does not scroll. Off by default: a labelled
   * element hides its own text from the accessible name of a table row or list item around it.
   */
  labelled?: boolean;
  /** Characters shown before the rest is on request. */
  previewChars?: number;
  /** Offer the exact value as a JSON download named `<fileName>.json`. */
  fileName?: string;
  /** Shown in place of nothing (an `undefined` value or an empty string). */
  emptyText?: string;
  tone?: keyof typeof TONES;
  className?: string;
  /** `data-testid` of the `<pre>` that holds the shown text. */
  testId?: string;
}

const count = (n: number) => n.toLocaleString('en-US');
/** Shown in the render that first sees a changed value, before its preview exists. */
const PREPARING = 'Preparing the preview…';

/**
 * A value as text whose rendering is bounded: up to `previewChars` characters are laid out at
 * once, and the preview is produced without formatting the whole value (`prettyJsonPrefix`); a
 * larger value says so and offers the whole text in a scrolling region, formatted only then, and
 * the exact stored value as a download. Nothing about the value itself changes; the bound is on
 * what the page lays out and holds, so a 2 MB variable cannot freeze the inspector's controls.
 * Expansion lasts while the same value stays shown: any change of value starts bounded again,
 * including a return to a value the reader expanded earlier.
 */
export function BoundedValue({
  value,
  text = false,
  label,
  labelled = false,
  previewChars = VALUE_PREVIEW_CHARS,
  fileName,
  emptyText = '',
  tone = 'code',
  className,
  testId,
}: BoundedValueProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const showAllRef = useRef<HTMLButtonElement>(null);
  const [expandedState, setExpandedState] = useState(false);
  const [shownValue, setShownValue] = useState<unknown>(value);
  // Whether the keyboard is inside this component, tracked by its focus events so that it is
  // known in the render that sees a new value, before the DOM changes under the focused element.
  const [ownsFocus, setOwnsFocus] = useState(false);
  // The text carries the keyboard across a change of value (focusable, not a tab stop) until the
  // keyboard moves on.
  const [holdsFocus, setHoldsFocus] = useState(false);
  // The value whose arrival found the keyboard inside, boxed so that `undefined` as a value is
  // distinct from no hand-off: its hand-off is in flight until its preview has settled. A box is
  // completed once (`completedRef`): a return to the same value later, with the keyboard
  // elsewhere, must not replay a hand-off that already happened.
  const [handoff, setHandoff] = useState<{ for: unknown } | undefined>(undefined);
  const completedRef = useRef<{ for: unknown } | undefined>(undefined);
  // Another value arrived (another event, a live reconstruction, or one shown expanded earlier):
  // it starts bounded. React re-renders at once with the adjusted state; `expanded` is false in
  // the discarded pass too, so the whole text is never formatted for a value that is not expanded.
  if (shownValue !== value) {
    setShownValue(value);
    setExpandedState(false);
    if (ownsFocus) {
      // The text stays focusable in this same commit, so a focused region never loses its
      // tabindex while it has the focus, and a removed control has somewhere to hand it to.
      setHoldsFocus(true);
      setHandoff({ for: value });
    }
  }
  const expanded = expandedState && shownValue === value;
  const isText = text && typeof value === 'string';
  // A changed value is previewed in the deferred render that follows the urgent one, so selecting
  // an event paints before a wide object's keys are enumerated; a mounted component's first value
  // is previewed at once, and a string's prefix is cheap enough to take straight away.
  const settledValue = useDeferredValue(value);
  const pending = !isText && settledValue !== value;
  // Collapsed: only the preview is produced (a string shows its own prefix; JSON stops at the
  // budget, remembered per value so a return to it costs a lookup). Expanded: the whole text,
  // once, for as long as this value stays expanded.
  const preview = useMemo(
    () =>
      isText
        ? { text: value.slice(0, previewChars), truncated: value.length > previewChars }
        : cachedJsonPrefix(settledValue, previewChars),
    [settledValue, value, isText, previewChars],
  );
  const full = useMemo(
    () => (expanded ? (isText ? value : prettyJson(value)) : undefined),
    [expanded, value, isText],
  );
  // While the preview is pending, the controls follow the settled (previous) preview, so a control
  // that holds the keyboard is not unmounted for one frame only to come back.
  const large = preview.truncated;
  const shown = pending ? PREPARING : expanded && full !== undefined ? full : preview.text;
  const total = isText ? value.length : full?.length;
  // After the commit that settles a changed value's preview, when its arrival found the keyboard
  // inside: the browser may have dropped the focus to the body (a removed control, a region whose
  // tabindex changed). Put the keyboard on the new value's Show all when it has one, else on the
  // text itself, and keep the text focusable only while it is what holds the keyboard. Until then
  // the text stays focusable and the previous controls stay mounted, so nothing is lost in the
  // urgent commit. A later value that arrives with the keyboard elsewhere leaves `handoff` boxing
  // the earlier value, so the effect does nothing for it.
  useLayoutEffect(() => {
    if (handoff === undefined || handoff === completedRef.current) return;
    if (handoff.for !== value || pending) return;
    completedRef.current = handoff;
    const root = rootRef.current;
    const pre = preRef.current;
    const inside = root !== null && root.contains(document.activeElement);
    if (showAllRef.current) {
      if (!inside || document.activeElement === pre) showAllRef.current.focus();
    } else if (!inside) pre?.focus();
    setHoldsFocus(document.activeElement === pre);
  }, [handoff, value, pending, large]);
  return (
    <div
      ref={rootRef}
      className={cn('grid min-w-0 gap-1.5', className)}
      onFocus={() => setOwnsFocus(true)}
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget)) return;
        // The reader left (a blur event means the keyboard moved by itself: a control the update
        // removed fires none). Nothing is owed any more: no pending hand-off, no held text.
        setOwnsFocus(false);
        setHandoff(undefined);
        setHoldsFocus(false);
      }}
    >
      <pre
        ref={preRef}
        // A region that scrolls must be named and reachable from the keyboard.
        {...(expanded
          ? { role: 'region', tabIndex: 0, 'aria-label': label }
          : {
              ...(labelled ? { 'aria-label': label } : {}),
              ...(holdsFocus ? { tabIndex: -1, onBlur: () => setHoldsFocus(false) } : {}),
            })}
        data-testid={testId}
        className={cn(
          'm-0 min-w-0 px-3 py-2 leading-normal whitespace-pre-wrap wrap-anywhere',
          expanded && 'max-h-[60vh] overflow-auto',
          TONES[tone],
        )}
      >
        {shown === '' ? emptyText : shown}
        {large && !expanded ? '…' : null}
      </pre>
      {large ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            {expanded
              ? `Showing all ${count(total ?? shown.length)} characters.`
              : total !== undefined
                ? `Showing the first ${count(previewChars)} of ${count(total)} characters.`
                : `Showing the first ${count(previewChars)} characters of a larger value.`}
          </span>
          <Button
            ref={showAllRef}
            size="sm"
            aria-label={`${expanded ? 'Show less of' : 'Show all of'} ${label}`}
            onClick={() => setExpandedState(!expanded)}
          >
            {expanded ? 'Show less' : 'Show all'}
          </Button>
          {fileName ? (
            <Button
              size="sm"
              aria-label={`Download ${label} as JSON`}
              onClick={() => downloadJson(`${fileName}.json`, value)}
            >
              Download JSON
            </Button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
