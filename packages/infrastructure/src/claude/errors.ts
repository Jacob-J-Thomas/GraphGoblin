export type ClaudeErrorCode =
  | 'HARNESS_NOT_INSTALLED'
  | 'HARNESS_NOT_AUTHENTICATED'
  | 'HARNESS_INVALID_CONFIGURATION'
  | 'HARNESS_UNSUPPORTED_POLICY'
  | 'HARNESS_PROTOCOL_ERROR'
  | 'HARNESS_OUTPUT_INVALID'
  | 'HARNESS_OUTPUT_LIMIT'
  | 'HARNESS_TIMEOUT'
  | 'HARNESS_TERMINATION_UNCONFIRMED'
  | 'HARNESS_QUOTA_EXHAUSTED'
  | 'HARNESS_TURN_FAILED';
/** Diagnostics contain only fixed text and bounded protocol names, never provider/auth bodies. */
export class ClaudeHarnessError extends Error {
  constructor(
    readonly code: ClaudeErrorCode,
    message: string,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'ClaudeHarnessError';
  }
}
export const CLAUDE_RECOVERY_HINT = 'Update GraphGoblin or report this Claude CLI version.';
/** Only name-shaped metadata can appear in diagnostics; malformed values never get serialized. */
export function claudeDiagnosticName(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,99}$/.test(value)
    ? value
    : '<invalid>';
}
export function protocolError(record?: Record<string, unknown>): ClaudeHarnessError {
  const identity = record
    ? ` (record ${claudeDiagnosticName(record.type)}${record.subtype === undefined ? '' : '/' + claudeDiagnosticName(record.subtype)})`
    : '';
  return new ClaudeHarnessError(
    'HARNESS_PROTOCOL_ERROR',
    `Claude stream protocol is invalid or incomplete${identity}. ${CLAUDE_RECOVERY_HINT}`,
  );
}
export function abortError(): DOMException {
  return new DOMException('Claude turn cancelled', 'AbortError');
}
