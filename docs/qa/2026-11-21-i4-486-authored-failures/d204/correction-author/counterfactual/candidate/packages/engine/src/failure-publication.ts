import { SlugSchema, UlidSchema, type JsonValue, type RunFailure } from '@graphgoblin/contracts';
import { deciderFailure } from './decider-errors.js';
import { describeError, RunFailureError } from './errors.js';

/** Engine-owned public copy; the optional diagnostic is private and never serialized. */
export class InternalRunFailureError extends RunFailureError {
  #diagnostic: ReturnType<typeof errorDiagnostic> | undefined;

  constructor(
    message: string,
    options: RunFailureError['options'],
    diagnostic?: ReturnType<typeof errorDiagnostic>,
  ) {
    super('INTERNAL_ERROR', message, options);
    this.#diagnostic = diagnostic;
  }

  get diagnostic() {
    return this.#diagnostic;
  }
}

export const INTERNAL_FAILURE_MESSAGE =
  'An unexpected error interrupted the run. See the server logs for this run.';

export function errorDiagnostic(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
} {
  return {
    message: describeError(error),
    ...(error instanceof Error
      ? { name: error.name, ...(error.stack ? { stack: error.stack } : {}) }
      : {}),
  };
}

export function boundedAuthoredCause(message: string): string {
  const max = 1000;
  return message.length > max ? message.slice(0, max - 1) + '…' : message;
}

const RECORDING_OPERATIONS = [
  'harness.submission',
  'turn.intent.reconcile',
  'harness.status',
] as const;
export type InferenceRecordingOperation = (typeof RECORDING_OPERATIONS)[number];

type JsonObject = Record<string, JsonValue>;

function isObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

function isChildWrapper(details: JsonObject): details is JsonObject & { childRunId: string } {
  return (
    UlidSchema.safeParse(details.childRunId).success &&
    (details.childNodeId === undefined || SlugSchema.safeParse(details.childNodeId).success) &&
    Object.keys(details).every(
      (key) => key === 'childRunId' || key === 'childNodeId' || key === 'childDetails',
    )
  );
}

function isLegacyRecording(
  entry: JsonValue,
): entry is JsonObject & { operation: InferenceRecordingOperation } {
  return (
    isObject(entry) &&
    RECORDING_OPERATIONS.some((operation) => operation === entry.operation) &&
    typeof entry.message === 'string' &&
    (entry.name === undefined || typeof entry.name === 'string') &&
    (entry.stack === undefined || typeof entry.stack === 'string') &&
    Object.keys(entry).every(
      (key) => key === 'operation' || key === 'message' || key === 'name' || key === 'stack',
    )
  );
}

function internalMessage(details: JsonObject): string {
  if (
    typeof details.code === 'string' &&
    (details.strategy === undefined ||
      details.strategy === 'codex' ||
      details.strategy === 'jev') &&
    Object.keys(details).every((key) => key === 'code' || key === 'strategy')
  ) {
    const provider = deciderFailure(details);
    // Reconstruct fixed copy from the known code. Historical message text is untrusted.
    if (provider.details.code === details.code) return provider.message;
  }
  return INTERNAL_FAILURE_MESSAGE;
}

function childDetails(
  details: JsonValue | undefined,
  internal: boolean,
  diagnostics: JsonValue[],
): { details: JsonValue | undefined; internalMessage: string } {
  if (!isObject(details)) return { details, internalMessage: INTERNAL_FAILURE_MESSAGE };
  if (isChildWrapper(details)) {
    const child = childDetails(details.childDetails, internal, diagnostics);
    return {
      details: child.details === undefined ? details : { ...details, childDetails: child.details },
      internalMessage: `subloop child ${details.childRunId} failed: ${child.internalMessage}`,
    };
  }

  const message = internalMessage(details);
  if (
    internal &&
    typeof details.name === 'string' &&
    (typeof details.stack === 'string' || details.stack === null)
  ) {
    const { name, stack, ...publicDetails } = details;
    diagnostics.push({ name, stack });
    details = publicDetails;
  }
  if (Array.isArray(details.recording)) {
    const recording = details.recording.map((entry) => {
      if (!isLegacyRecording(entry)) return entry;
      diagnostics.push(entry);
      return { operation: entry.operation };
    });
    details = { ...details, recording };
  }
  return { details, internalMessage: message };
}

/** Redact only the old engine slots on the child-failure chain being copied into a new run. */
export function childFailureForPublication(failure: RunFailure) {
  const diagnostics: JsonValue[] = [];
  const internal = failure.code === 'INTERNAL_ERROR';
  const projected = childDetails(failure.details, internal, diagnostics);
  const message = internal ? projected.internalMessage : failure.message;
  if (message !== failure.message) diagnostics.unshift({ message: failure.message });
  return { message, details: projected.details, diagnostics };
}
