import type { RunErrorCode, RunFailure } from '@graphgoblin/contracts';

/**
 * Thrown by handlers and the executor for the "unavoidable" failure class in the resiliency
 * model (docs/05-execution-engine.md). Everything else that escapes a handler is a bug and is
 * recorded as INTERNAL_ERROR.
 */
export class RunFailureError extends Error {
  constructor(
    readonly code: RunErrorCode,
    message: string,
    readonly options: { resumable?: boolean; details?: unknown; nodeId?: string } = {},
  ) {
    super(message);
    this.name = 'RunFailureError';
  }

  toFailure(nodeId?: string): RunFailure {
    const id = this.options.nodeId ?? nodeId;
    return {
      code: this.code,
      message: this.message,
      resumable: this.options.resumable ?? true,
      ...(id ? { nodeId: id } : {}),
      ...(this.options.details !== undefined
        ? { details: toJsonDetails(this.options.details) }
        : {}),
    };
  }
}

/** Thrown when a handler observes its abort signal. */
export class RunCancelledError extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'RunCancelledError';
  }
}

function toJsonDetails(details: unknown): RunFailure['details'] {
  try {
    return JSON.parse(JSON.stringify(details)) as RunFailure['details'];
  } catch {
    return String(details);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof RunCancelledError ||
    (error instanceof Error && (error.name === 'AbortError' || error.message === 'run cancelled'))
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * A conditional append found the run's log longer than the caller expected: something else
 * appended first. The caller re-reads the log and decides again.
 */
export class AppendConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedLastSeq: number,
    readonly actualLastSeq: number,
  ) {
    super(`run ${runId} log is at ${actualLastSeq}, not ${expectedLastSeq}`);
    this.name = 'AppendConflictError';
  }
}
