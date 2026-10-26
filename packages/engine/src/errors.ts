import type { RunErrorCode, RunFailure, RecoveryRefusalCode } from '@graphgoblin/contracts';
import type { EventDraft } from './ports.js';

/** Artifact I/O failed explicitly; missing content is represented separately by undefined. */
export class ArtifactStoreError extends Error {
  constructor(
    readonly code: 'ARTIFACT_CORRUPT' | 'ARTIFACT_WRITE_FAILED',
    readonly ref: string,
    options?: ErrorOptions,
  ) {
    super(
      code === 'ARTIFACT_CORRUPT'
        ? 'Artifact content does not match its reference'
        : 'Artifact could not be published',
      options,
    );
    this.name = 'ArtifactStoreError';
  }
}

/** Safe, transport-independent failure: an HTTP probe body exceeded its byte budget. */
export class ProbeBodyOverflowError extends Error {
  readonly code = 'HTTP_PROBE_BODY_OVERFLOW';
  constructor() {
    super('HTTP probe body exceeds byte limit');
    this.name = 'ProbeBodyOverflowError';
  }
}

/**
 * Thrown by handlers and the executor for the "unavoidable" failure class in the resiliency
 * model (docs/05-execution-engine.md). Everything else that escapes a handler is a bug and is
 * recorded as INTERNAL_ERROR.
 */
export class RunFailureError extends Error {
  constructor(
    readonly code: RunErrorCode,
    message: string,
    readonly options: {
      resumable?: boolean;
      details?: unknown;
      nodeId?: string;
      script?: RunFailure['script'];
      inference?: RunFailure['inference'];
      missingSession?: RunFailure['missingSession'];
      /** Facts the failing visit learned, appended in the same write as `run.failed` (#398). */
      records?: EventDraft[];
    } = {},
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
      ...(this.options.script ? { script: this.options.script } : {}),
      ...(this.options.inference ? { inference: this.options.inference } : {}),
      ...(this.options.missingSession ? { missingSession: this.options.missingSession } : {}),
      ...(this.options.details !== undefined
        ? { details: toJsonDetails(this.options.details) }
        : {}),
    };
  }
}

/**
 * A stored definition the current contract refuses: an exit that publishes an Event, retired by
 * ADR-0044 but still present in a version, draft or draft-run snapshot saved before. Thrown
 * before the definition is served or executed. As a run failure it is not resumable: the pinned
 * definition never changes, so resuming cannot help.
 */
export class LoopUpgradeRequiredError extends RunFailureError {
  constructor(
    readonly loopId: string,
    readonly versionId: string,
    readonly version: number,
    readonly paths: string[],
    message: string,
  ) {
    super('LOOP_UPGRADE_REQUIRED', message, {
      resumable: false,
      details: { loopId, versionId, version, paths },
    });
    this.name = 'LoopUpgradeRequiredError';
  }
}

/** Thrown when a handler observes its abort signal. */
export class RunCancelledError extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'RunCancelledError';
  }
}

/**
 * Thrown by the subloop handler when the child it awaits was cancelled. The run is cancelled in
 * turn, at the child's request, as cancelling inline work cancels the run that does it (#251).
 */
export class ChildCancelledError extends Error {
  /** `records` are appended in the same write as the cancellation request (#398). */
  constructor(
    readonly childRunId: string,
    readonly records: EventDraft[] = [],
  ) {
    super(`subloop child ${childRunId} was cancelled`);
    this.name = 'ChildCancelledError';
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

/** A specific run's current-format stored data cannot be decoded. Store failures stay distinct. */
export class UnreadableRunHistoryError extends Error {
  readonly code = 'HISTORY_UNREADABLE';
  constructor(
    readonly runId: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'UnreadableRunHistoryError';
  }
}

/** Only native cleanup caused by this shutdown's own interruption can veto store release. */
export class ShutdownCleanupError extends Error {
  constructor() {
    super('Native process termination unconfirmed during explicit stop; ownership retained');
    this.name = 'ShutdownCleanupError';
  }
}

/** The same typed refusal returned by the read-only recovery policy. */
export class RecoveryRefusedError extends Error {
  constructor(
    readonly code: RecoveryRefusalCode,
    message: string,
    readonly replayRunId?: string,
  ) {
    super(message);
    this.name = 'RecoveryRefusedError';
  }
}
