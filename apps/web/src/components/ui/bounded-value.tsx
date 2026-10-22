import { useMemo, useState } from 'react';
import { cn, downloadJson, prettyJson } from '../../lib/utils.js';
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
 * once; a larger value says how much of it is shown and offers the whole text in a scrolling
 * region, and the exact stored value as a download. Nothing about the value itself changes; the
 * bound is on what the page lays out, so a 2 MB variable cannot freeze the inspector's controls.
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
  const full = useMemo(
    () => (text && typeof value === 'string' ? value : prettyJson(value)),
    [value, text],
  );
  const [expanded, setExpanded] = useState(false);
  const large = full.length > previewChars;
  const shown = large && !expanded ? full.slice(0, previewChars) : full;
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <pre
        // A region that scrolls must be named and reachable from the keyboard.
        {...(expanded
          ? { role: 'region', tabIndex: 0, 'aria-label': label }
          : labelled
            ? { 'aria-label': label }
            : {})}
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
              ? `Showing all ${count(full.length)} characters.`
              : `Showing the first ${count(previewChars)} of ${count(full.length)} characters.`}
          </span>
          <Button
            size="sm"
            aria-label={`${expanded ? 'Show less of' : 'Show all of'} ${label}`}
            onClick={() => setExpanded(!expanded)}
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
