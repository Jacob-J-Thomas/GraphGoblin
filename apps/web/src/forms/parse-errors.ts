import { createContext, use } from 'react';

/**
 * Text a form field cannot turn into a value (JSON that does not parse). The field keeps the last
 * valid value, so the schema alone never notices; the form reports the text and its error upward,
 * keyed by field path, and the editor keeps both, as a blocking issue, until the text parses or
 * the user discards it. Leaving the field does not clear it: coming back shows the text again.
 */
export interface ParseError {
  message: string;
  text: string;
}

/**
 * Why a path's unparsed text went away when the user asked for it ("Discard text"), as opposed to
 * the text starting to parse. The editor's undo history records a discard as a step of its own.
 */
export type ParseErrorReason = 'discard';

export interface ParseErrorChannel {
  /** The stored unparsed text for a path, if any, so a remounted field shows it again. */
  get: (path: string) => ParseError | undefined;
  /** Record (or, with `undefined`, clear) the unparsed text for a path. */
  report: (path: string, error: ParseError | undefined) => void;
  /** Drop the unparsed text for a path because the user discarded it. */
  discard: (path: string) => void;
  /** True when a store keeps the reports; only then can an entry be discarded from outside. */
  tracked: boolean;
  /** The stored entries now, so a mounted field notices one discarded elsewhere. */
  errors: Record<string, ParseError> | undefined;
}

const NONE: ParseErrorChannel = {
  get: () => undefined,
  report: () => undefined,
  discard: () => undefined,
  tracked: false,
  errors: undefined,
};

export const ParseErrorContext = createContext<ParseErrorChannel>(NONE);

export function useParseErrors(): ParseErrorChannel {
  return use(ParseErrorContext);
}

/** Move or drop whole row subtrees. Snapshot first so shifting adjacent indices cannot overwrite
 * another row's error; use the report channel so the editor's blocking issues move too. */
export function repathParseErrors(
  channel: ParseErrorChannel,
  changes: { from: string; to?: string; exact?: boolean }[],
): void {
  const moved = Object.entries(channel.errors ?? {}).flatMap(([path, error]) => {
    const change = changes.find(
      ({ from, exact }) =>
        path === from || (!exact && (from === '' || path.startsWith(`${from}.`))),
    );
    if (!change) return [];
    return [
      {
        path,
        error,
        next: change.to === undefined ? undefined : change.to + path.slice(change.from.length),
      },
    ];
  });
  for (const { path } of moved) channel.report(path, undefined);
  for (const { next, error } of moved) {
    if (next !== undefined) channel.report(next, error);
  }
}
