export type ClaudeErrorCode =
  | 'HARNESS_NOT_INSTALLED'
  | 'HARNESS_NOT_AUTHENTICATED'
  | 'HARNESS_INVALID_CONFIGURATION'
  | 'HARNESS_MODEL_UNVERIFIED'
  | 'HARNESS_UNSUPPORTED_POLICY'
  | 'HARNESS_PROTOCOL_ERROR'
  | 'HARNESS_OUTPUT_INVALID'
  | 'HARNESS_OUTPUT_LIMIT'
  | 'HARNESS_TIMEOUT'
  | 'HARNESS_TERMINATION_UNCONFIRMED'
  | 'HARNESS_QUOTA_EXHAUSTED'
  | 'HARNESS_TURN_FAILED';
/** Fixed diagnostics contain neither raw CLI stderr/provider bodies nor auth status. */
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
export function protocolError(): ClaudeHarnessError {
  return new ClaudeHarnessError(
    'HARNESS_PROTOCOL_ERROR',
    'Claude stream protocol is invalid or incomplete',
  );
}
export function abortError(): DOMException {
  return new DOMException('Claude turn cancelled', 'AbortError');
}
