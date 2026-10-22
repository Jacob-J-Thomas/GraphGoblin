import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn, downloadJson, prettyJson, prettyJsonPrefix } from '../../lib/utils.js';
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
  // Counts the changes of value that happened while the keyboard was inside (the effect below).
  const [handoffs, setHandoffs] = useState(0);
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
      setHandoffs((n) => n + 1);
    }
  }
  const expanded = expandedState && shownValue === value;
  // After the commit of a change of value made while the keyboard was inside: the browser may
  // have dropped the focus to the body (a removed control, a region whose tabindex changed).
  // Put the keyboard on the new value's Show all when it has one, else on the text itself, and
  // keep the text focusable only while it is what holds the keyboard.
  useLayoutEffect(() => {
    if (handoffs === 0) return;
    const root = rootRef.current;
    const pre = preRef.current;
    const inside = root !== null && root.contains(document.activeElement);
    if (showAllRef.current) {
      if (!inside || document.activeElement === pre) showAllRef.current.focus();
    } else if (!inside) pre?.focus();
    setHoldsFocus(document.activeElement === pre);
  }, [handoffs]);
  const isText = text && typeof value === 'string';
  // Collapsed: only the preview is produced (a string shows its own prefix; JSON stops at the
  // budget). Expanded: the whole text, once, for as long as this value stays expanded.
  const preview = useMemo(
    () =>
      isText
        ? { text: value.slice(0, previewChars), truncated: value.length > previewChars }
        : prettyJsonPrefix(value, previewChars),
    [value, isText, previewChars],
  );
  const full = useMemo(
    () => (expanded ? (isText ? value : prettyJson(value)) : undefined),
    [expanded, value, isText],
  );
  const large = preview.truncated;
  const shown = expanded && full !== undefined ? full : preview.text;
  const total = isText ? value.length : full?.length;
  return (
    <div
      ref={rootRef}
      className={cn('grid min-w-0 gap-1.5', className)}
      onFocus={() => setOwnsFocus(true)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOwnsFocus(false);
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
