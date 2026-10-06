/** Provider text, error names and arbitrary codes are untrusted at the run boundary. */
const DECIDER_FAILURE_MESSAGES = {
  DECIDER_UNAVAILABLE: 'Decision provider is unavailable',
  DECIDER_NOT_AUTHENTICATED: 'Decision provider rejected authentication',
  DECIDER_RATE_LIMITED: 'Decision provider rate limit exceeded',
  DECIDER_HTTP_ERROR: 'Decision provider request failed',
  DECIDER_UNREACHABLE: 'Classifier endpoint is unreachable',
  DECIDER_INVALID_RESPONSE: 'Decision provider returned an invalid response',
  DECIDER_REDIRECT: 'Classifier redirects are not followed',
  DECIDER_TIMEOUT: 'Decision provider request timed out',
  DECIDER_ERROR: 'Decision provider request failed',
} as const;

type DeciderCode = keyof typeof DECIDER_FAILURE_MESSAGES;
type Strategy = 'jev' | 'codex';
const ERROR_NAMES = new Set([
  'Error',
  'JevError',
  'HttpClassifierError',
  'CodexError',
  'HarnessError',
]);

export function summarizeDeciderError(error: unknown) {
  const fields = typeof error === 'object' && error !== null ? error : {};
  const code =
    'code' in fields &&
    typeof fields.code === 'string' &&
    Object.hasOwn(DECIDER_FAILURE_MESSAGES, fields.code)
      ? (fields.code as DeciderCode)
      : undefined;
  const name =
    'name' in fields && typeof fields.name === 'string' && ERROR_NAMES.has(fields.name)
      ? fields.name
      : 'Error';
  const status =
    'status' in fields &&
    typeof fields.status === 'number' &&
    Number.isInteger(fields.status) &&
    fields.status >= 100 &&
    fields.status <= 599
      ? fields.status
      : undefined;
  return {
    message: DECIDER_FAILURE_MESSAGES[code ?? 'DECIDER_ERROR'],
    name,
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

/** Carries only a safe summary and the strategy selected by the exit criterion. */
export class DeciderFailureError extends Error {
  readonly code: DeciderCode;
  readonly diagnostic: ReturnType<typeof summarizeDeciderError>;
  constructor(
    error: unknown,
    readonly strategy: Strategy,
  ) {
    const diagnostic = summarizeDeciderError(error);
    super(diagnostic.message);
    this.name = 'DeciderFailureError';
    this.code = diagnostic.code ?? 'DECIDER_ERROR';
    this.diagnostic = diagnostic;
  }
}

export function isDeciderError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('DECIDER_')
  );
}

export function deciderFailure(error: unknown) {
  const diagnostic =
    error instanceof DeciderFailureError ? error.diagnostic : summarizeDeciderError(error);
  const strategy = error instanceof DeciderFailureError ? error.strategy : undefined;
  return {
    message: diagnostic.message,
    details: { code: diagnostic.code ?? 'DECIDER_ERROR', ...(strategy ? { strategy } : {}) },
    diagnostic: {
      name: diagnostic.name,
      code: diagnostic.code ?? 'DECIDER_ERROR',
      ...(diagnostic.status !== undefined ? { status: diagnostic.status } : {}),
      ...(strategy ? { strategy } : {}),
    },
  };
}
