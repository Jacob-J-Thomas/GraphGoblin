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

export interface ParseErrorChannel {
  /** The stored unparsed text for a path, if any, so a remounted field shows it again. */
  get: (path: string) => ParseError | undefined;
  /** Record (or, with `undefined`, clear) the unparsed text for a path. */
  report: (path: string, error: ParseError | undefined) => void;
}

const NONE: ParseErrorChannel = { get: () => undefined, report: () => undefined };

export const ParseErrorContext = createContext<ParseErrorChannel>(NONE);

export function useParseErrors(): ParseErrorChannel {
  return use(ParseErrorContext);
}
