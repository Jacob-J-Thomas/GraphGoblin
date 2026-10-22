import type { HarnessId, PromptSubmission } from '@graphgoblin/contracts';
import { describeError, RunFailureError } from '../errors.js';
import type { HarnessEvent } from '../ports.js';

type ReportedFailure = Extract<HarnessEvent, { type: 'error' }>;

/** One mapping for launch exceptions, streamed errors and rejected results. */
export function mapHarnessFailure(
  error: unknown,
  lastError: ReportedFailure | undefined,
  nodeId: string,
  harness: HarnessId,
  fallback: PromptSubmission = 'delivery-uncertain',
): { failure: RunFailureError; submission: PromptSubmission } {
  const info = typeof error === 'object' && error !== null ? error : {};
  const reportedCode =
    lastError?.code ?? ('code' in info && typeof info.code === 'string' ? info.code : undefined);
  const reportedRetriable =
    lastError?.retriable ?? ('retriable' in info && info.retriable === true);
  const code = (reportedCode ?? '').toLowerCase();
  const message = lastError?.message ?? describeError(error);
  let failure: RunFailureError;
  if (code === 'harness_termination_unconfirmed' || code === 'harness_session_missing') {
    failure = new RunFailureError(
      code === 'harness_session_missing'
        ? 'HARNESS_SESSION_MISSING'
        : 'HARNESS_TERMINATION_UNCONFIRMED',
      message,
      { nodeId, resumable: false, details: { adapterCode: reportedCode } },
    );
  } else if (
    [
      'harness_quota_exhausted',
      'usage_limit_reached',
      'insufficient_quota',
      'rate_limit_exceeded',
    ].includes(code)
  ) {
    failure = new RunFailureError('HARNESS_QUOTA_EXHAUSTED', message, { nodeId, resumable: true });
  } else if (
    ['harness_not_authenticated', 'unauthorized', '401', 'not_authenticated'].includes(code)
  ) {
    failure = new RunFailureError('HARNESS_NOT_AUTHENTICATED', message, {
      nodeId,
      resumable: true,
    });
  } else if (code === 'harness_not_installed') {
    failure = new RunFailureError('HARNESS_NOT_INSTALLED', message, { nodeId, resumable: true });
  } else if (code === 'harness_timeout') {
    failure = new RunFailureError('INFERENCE_TIMEOUT', message, { nodeId, resumable: true });
  } else {
    failure = new RunFailureError('HARNESS_TURN_FAILED', 'harness turn failed: ' + message, {
      nodeId,
      // Pinned refusals cannot be repaired within this run. Codex's generic exit/stream
      // failures remain resumable even when its SDK says not retriable; Claude requires
      // positive retry evidence. Submission/session safety is checked separately.
      resumable:
        ![
          'harness_unsupported_policy',
          'harness_invalid_configuration',
          'harness_arguments_rejected',
        ].includes(code) &&
        (harness === 'codex' || reportedRetriable),
      details: { adapterCode: reportedCode ?? null },
    });
  }
  const reportedSubmission =
    lastError?.submission ?? ('submission' in info ? info.submission : undefined);
  // A missing handle alone must not erase a missing conversation or uncertain transport.
  // Unconfirmed termination can never establish that nothing reached the provider.
  const submission =
    failure.code === 'HARNESS_SESSION_MISSING'
      ? 'session-missing'
      : failure.code === 'HARNESS_TERMINATION_UNCONFIRMED'
        ? 'delivery-uncertain'
        : reportedSubmission === 'definitely-not-submitted' ||
            reportedSubmission === 'delivery-uncertain' ||
            reportedSubmission === 'session-missing'
          ? reportedSubmission
          : fallback;
  return { failure, submission };
}
