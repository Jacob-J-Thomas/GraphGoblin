import type { HarnessId, PromptSubmission } from '@graphgoblin/contracts';
import { describeError, RunFailureError } from '../errors.js';

/** Raw evidence: defaults used to classify a turn must never masquerade as explicit metadata. */
export interface HarnessFailureEvidence {
  code: string;
  message: string;
  retriable: boolean;
  submission?: PromptSubmission;
}

const PINNED = new Set([
  'HARNESS_ARGUMENTS_REJECTED',
  'HARNESS_INVALID_CONFIGURATION',
  'HARNESS_UNSUPPORTED_POLICY',
]);
const ORDINARY = new Set([
  'HARNESS_NOT_AUTHENTICATED',
  'HARNESS_QUOTA_EXHAUSTED',
  'HARNESS_TRANSPORT_FAILED',
  'HARNESS_OUTPUT_LIMIT',
  'HARNESS_TIMEOUT',
  'HARNESS_NOT_INSTALLED',
  'INFERENCE_TIMEOUT',
  'UNAUTHORIZED',
  '401',
  'NOT_AUTHENTICATED',
  'USAGE_LIMIT_REACHED',
  'INSUFFICIENT_QUOTA',
  'RATE_LIMIT_EXCEEDED',
]);

/** Recognized adapter metadata is preserved before message-based classification. */
export function isHarnessFailureCode(code: string): boolean {
  const value = code.toUpperCase();
  return (
    PINNED.has(value) ||
    ORDINARY.has(value) ||
    ['HARNESS_SESSION_MISSING', 'HARNESS_TERMINATION_UNCONFIRMED', 'HARNESS_TURN_FAILED'].includes(
      value,
    )
  );
}

/** Single precedence table for engine and adapter evidence, independent of arrival boundary. */
export function harnessFailureRank(evidence: HarnessFailureEvidence): number {
  const code = evidence.code.toUpperCase();
  if (code === 'HARNESS_TERMINATION_UNCONFIRMED') return 6;
  if (code === 'HARNESS_SESSION_MISSING' || evidence.submission === 'session-missing') return 5;
  if (PINNED.has(code)) return 4;
  if (evidence.submission !== undefined) return 3;
  return ORDINARY.has(code) ? 2 : 1;
}

export function harnessFailureEvidence(error: unknown): HarnessFailureEvidence {
  const info = typeof error === 'object' && error !== null ? error : {};
  const state = 'submission' in info ? info.submission : undefined;
  return {
    code: 'code' in info && typeof info.code === 'string' ? info.code : 'HARNESS_TURN_FAILED',
    message: describeError(error),
    retriable: 'retriable' in info && info.retriable === true,
    ...(state === 'definitely-not-submitted' ||
    state === 'delivery-uncertain' ||
    state === 'session-missing'
      ? { submission: state }
      : {}),
  };
}

/** Higher evidence wins; within a class the later observation wins. No I/O or derived defaults. */
export function mergeHarnessFailure(
  previous: HarnessFailureEvidence | undefined,
  next: HarnessFailureEvidence,
): HarnessFailureEvidence {
  // Missing conversations and unconfirmed termination are safety evidence, not generic wrappers.
  // An earlier ordinary error must never hide these or a later pinned-definition refusal.
  return !previous || harnessFailureRank(next) >= harnessFailureRank(previous) ? next : previous;
}

export function harnessFailureSubmission(
  evidence: HarnessFailureEvidence,
  fallback: PromptSubmission,
  accepted = false,
): PromptSubmission {
  const code = evidence.code.toUpperCase();
  const state =
    code === 'HARNESS_TERMINATION_UNCONFIRMED'
      ? 'delivery-uncertain'
      : code === 'HARNESS_SESSION_MISSING'
        ? 'session-missing'
        : (evidence.submission ?? fallback);
  return accepted && state === 'definitely-not-submitted' ? 'delivery-uncertain' : state;
}

/** Derive the engine outcome only after all evidence, including cleanup, has been folded. */
export function mapHarnessFailure(
  error: unknown,
  previous: HarnessFailureEvidence | undefined,
  nodeId: string,
  harness: HarnessId,
  fallback: PromptSubmission = 'delivery-uncertain',
) {
  const evidence = mergeHarnessFailure(previous, harnessFailureEvidence(error));
  const code = evidence.code.toUpperCase();
  const message = evidence.message;
  let failure: RunFailureError;
  if (
    code === 'HARNESS_TERMINATION_UNCONFIRMED' ||
    code === 'HARNESS_SESSION_MISSING' ||
    evidence.submission === 'session-missing'
  ) {
    failure = new RunFailureError(
      code === 'HARNESS_TERMINATION_UNCONFIRMED' ? code : 'HARNESS_SESSION_MISSING',
      message,
      { nodeId, resumable: false, details: { adapterCode: evidence.code } },
    );
  } else if (
    [
      'HARNESS_QUOTA_EXHAUSTED',
      'USAGE_LIMIT_REACHED',
      'INSUFFICIENT_QUOTA',
      'RATE_LIMIT_EXCEEDED',
    ].includes(code)
  ) {
    failure = new RunFailureError('HARNESS_QUOTA_EXHAUSTED', message, { nodeId, resumable: true });
  } else if (
    ['HARNESS_NOT_AUTHENTICATED', 'UNAUTHORIZED', '401', 'NOT_AUTHENTICATED'].includes(code)
  ) {
    failure = new RunFailureError('HARNESS_NOT_AUTHENTICATED', message, {
      nodeId,
      resumable: true,
    });
  } else if (code === 'HARNESS_NOT_INSTALLED') {
    failure = new RunFailureError(code, message, { nodeId, resumable: true });
  } else if (code === 'HARNESS_TIMEOUT' || code === 'INFERENCE_TIMEOUT') {
    failure = new RunFailureError('INFERENCE_TIMEOUT', message, { nodeId, resumable: true });
  } else if (code === 'HARNESS_TRANSPORT_FAILED' || code === 'HARNESS_OUTPUT_LIMIT') {
    failure = new RunFailureError(code, message, {
      nodeId,
      resumable: code === 'HARNESS_TRANSPORT_FAILED' && evidence.retriable,
    });
  } else {
    failure = new RunFailureError('HARNESS_TURN_FAILED', 'harness turn failed: ' + message, {
      nodeId,
      resumable: !PINNED.has(code) && (harness === 'codex' || evidence.retriable),
      details: { adapterCode: evidence.code },
    });
  }
  return { failure, evidence, submission: harnessFailureSubmission(evidence, fallback) };
}
