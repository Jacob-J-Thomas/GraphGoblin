/**
 * Startup failures whose cleanup did not settle (#560). Only this API-private type lets startup
 * reporting look past the outer error to its primary; an arbitrary AggregateError is never
 * interpreted. The module imports nothing from the API so lock, container and serve code can share
 * it without cycles. Lock acquisition reports through it for every caller, including `--reset` and
 * `--create-api-key`, so its wording does not assume server startup.
 */

/** Closed labels for the cleanup steps of a failed startup. */
export type StartupCleanupOperation =
  | 'main-record-identity'
  | 'main-record-close'
  | 'main-record-lookup'
  | 'main-record-unlink'
  | 'recovery-release'
  | 'readonly-database-close'
  | 'database-close'
  | 'database-lease-release'
  | 'directory-lease-release';

/** Ownership that a failed startup kept because releasing it was not proven safe or complete. */
export interface RetainedOwnership {
  readonly resource: 'lock-record' | 'database-lease' | 'directory-lease';
  /** The lock record itself, or the data directory or database file a lease protects. */
  readonly path: string;
}

/** One failed cleanup step: its closed label, a bounded code and the original error. */
export interface StartupCleanupFailure {
  readonly operation: StartupCleanupOperation;
  readonly code: string;
  readonly error: unknown;
}

/** A Node, libsql or system error code, or `UNKNOWN`; never free text. */
export function vettedCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'UNKNOWN';
}

export function cleanupStep(
  operation: StartupCleanupOperation,
  error: unknown,
): StartupCleanupFailure {
  return { operation, code: vettedCode(error), error };
}

const RESOURCE: Record<RetainedOwnership['resource'], string> = {
  'lock-record': 'lock record',
  'database-lease': 'database lease',
  'directory-lease': 'data-directory lease',
};

/** Bounded detail: closed labels, vetted codes and configured paths, never secondary messages. */
export function describeStartupCleanup(
  cleanup: readonly StartupCleanupFailure[],
  retained: readonly RetainedOwnership[],
): string {
  const parts: string[] = [];
  if (cleanup.length)
    parts.push(
      `cleanup also failed: ${cleanup.map(({ operation, code }) => `${operation} (${code})`).join(', ')}`,
    );
  if (retained.length)
    parts.push(
      `ownership retained: ${retained.map(({ resource, path }) => `${RESOURCE[resource]} ${path}`).join(', ')}`,
    );
  return parts.join('; ');
}

/**
 * The original startup failure first, then each failed cleanup step in the order it was attempted,
 * and the ownership deliberately kept. `errors` is `[primary, ...cleanup errors]` and `cause` is
 * the primary, so the original objects stay inspectable.
 */
export class StartupCleanupError extends AggregateError {
  override readonly name = 'StartupCleanupError';
  readonly primary: unknown;
  readonly cleanup: readonly StartupCleanupFailure[];
  readonly retained: readonly RetainedOwnership[];

  constructor(
    primary: unknown,
    cleanup: readonly StartupCleanupFailure[],
    retained: readonly RetainedOwnership[],
  ) {
    super(
      [primary, ...cleanup.map(({ error }) => error)],
      `${primary instanceof Error ? primary.message : 'GraphGoblin startup failed'}; ${describeStartupCleanup(cleanup, retained)}`,
      { cause: primary },
    );
    this.primary = primary;
    this.cleanup = cleanup;
    this.retained = retained;
  }

  /** The detail shown after the primary's own explanation. */
  get detail(): string {
    return describeStartupCleanup(this.cleanup, this.retained);
  }
}

/**
 * The exact primary when cleanup settled. Otherwise one flat tagged failure: an earlier tagged
 * primary contributes its own primary, steps and retained ownership first, keeping causal order.
 */
export function withStartupCleanup(
  primary: unknown,
  cleanup: readonly StartupCleanupFailure[],
  retained: readonly RetainedOwnership[],
): unknown {
  if (!cleanup.length && !retained.length) return primary;
  return primary instanceof StartupCleanupError
    ? new StartupCleanupError(
        primary.primary,
        [...primary.cleanup, ...cleanup],
        [...primary.retained, ...retained],
      )
    : new StartupCleanupError(primary, cleanup, retained);
}
