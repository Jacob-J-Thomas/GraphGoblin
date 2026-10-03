import { createContext, use, useEffect } from 'react';

/**
 * Text a form field cannot turn into a value (JSON that does not parse). The field keeps the last
 * valid value, so the schema alone never notices; the form reports the text's error upward
 * instead, keyed by field path, and the editor treats it as a blocking issue.
 */
export type ParseErrorReporter = (path: string, error: string | undefined) => void;

export const ParseErrorContext = createContext<ParseErrorReporter>(() => undefined);

/** Report `error` for `path` while it is set, and clear it when the field unmounts. */
export function useReportParseError(path: string, error: string | undefined): void {
  const report = use(ParseErrorContext);
  useEffect(() => {
    report(path, error);
  }, [report, path, error]);
  useEffect(() => () => report(path, undefined), [report, path]);
}
