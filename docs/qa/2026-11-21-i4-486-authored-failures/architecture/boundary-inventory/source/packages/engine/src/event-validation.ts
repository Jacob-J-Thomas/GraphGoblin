import {
  RunEventSchema,
  RunFailureSchema,
  type RunEvent,
  type RunFailure,
} from '@graphgoblin/contracts';
import { RunFailureError } from './errors.js';

/** Validate the complete generated record before any part of its append is persisted. */
export function validateGeneratedEvent(value: unknown): RunEvent {
  const parsed = RunEventSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Schema diagnostics name fields and bounds, never include the rejected payload.
  const reason = parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new RunFailureError(
    'EVENT_INVALID',
    `Generated run event could not be recorded: ${reason}`,
    { resumable: false },
  );
}

/** Only failure diagnostics may be shortened. Successful values are validated unchanged. */
export function boundedFailure(failure: RunFailure): RunFailure {
  const bound = RunFailureSchema.shape.message.maxLength!;
  const original = failure.message;
  const marker = ` [truncated; original ${original.length} characters]`;
  const message =
    original.length > bound ? original.slice(0, bound - marker.length) + marker : original;
  const parsed = RunFailureSchema.safeParse({ ...failure, message });
  if (parsed.success) return parsed.data;
  // Even malformed adapter failure metadata must not break failure reporting recursively.
  return {
    code: 'EVENT_INVALID',
    message: 'Generated failure metadata did not conform to the run failure contract.',
    resumable: false,
  };
}
