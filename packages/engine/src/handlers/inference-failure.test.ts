import { expect, it } from 'vitest';
import {
  harnessFailureEvidence,
  harnessFailureSubmission,
  mapHarnessFailure,
  mergeHarnessFailure,
  type HarnessFailureEvidence,
} from '../index.js';

const evidence: HarnessFailureEvidence[] = [
  {
    code: 'HARNESS_TERMINATION_UNCONFIRMED',
    message: 'termination',
    retriable: true,
    submission: 'definitely-not-submitted',
  },
  { code: 'HARNESS_SESSION_MISSING', message: 'missing', retriable: true },
  { code: 'HARNESS_ARGUMENTS_REJECTED', message: 'pinned', retriable: true },
  {
    code: 'HARNESS_TRANSPORT_FAILED',
    message: 'explicit',
    retriable: false,
    submission: 'definitely-not-submitted',
  },
  { code: 'HARNESS_QUOTA_EXHAUSTED', message: 'ordinary', retriable: false },
  { code: 'HARNESS_TURN_FAILED', message: 'wrapper', retriable: false },
];
it.each(
  evidence.flatMap((previous, p) =>
    evidence.map((next, n) => ({ previous, next, expected: p < n ? previous : next })),
  ),
)('folds $previous.message then $next.message by authority', ({ previous, next, expected }) => {
  expect(mergeHarnessFailure(previous, next)).toBe(expected);
  expect(mergeHarnessFailure(undefined, next)).toBe(next);
  expect(
    mergeHarnessFailure(previous, { ...previous, message: 'Later equal authority' }).message,
  ).toBe('Later equal authority');
});
it.each([null, 'submission', { code: 2, submission: 'submitted' }, { submission: false }])(
  'does not invent typed metadata for %j',
  (error) => {
    expect(harnessFailureEvidence(error)).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      retriable: false,
    });
    expect(harnessFailureEvidence(error).submission).toBeUndefined();
  },
);
it.each([
  'HARNESS_QUOTA_EXHAUSTED',
  'usage_limit_reached',
  'insufficient_quota',
  'rate_limit_exceeded',
  'HARNESS_NOT_AUTHENTICATED',
  'unauthorized',
  '401',
  'not_authenticated',
  'HARNESS_NOT_INSTALLED',
  'HARNESS_TIMEOUT',
  'INFERENCE_TIMEOUT',
])('maps ordinary typed %s', (code) => {
  expect(
    mapHarnessFailure({ code, message: 'Typed refusal' }, undefined, 'infer', 'claude').failure
      .options.resumable,
  ).toBe(true);
});
it('applies missing/termination overrides before explicit submission and the acceptance guard', () => {
  expect(harnessFailureSubmission(evidence[0]!, 'definitely-not-submitted', true)).toBe(
    'delivery-uncertain',
  );
  expect(harnessFailureSubmission(evidence[1]!, 'delivery-uncertain', true)).toBe(
    'session-missing',
  );
  expect(harnessFailureSubmission(evidence[3]!, 'delivery-uncertain', true)).toBe(
    'delivery-uncertain',
  );
  expect(harnessFailureSubmission(evidence[5]!, 'definitely-not-submitted')).toBe(
    'definitely-not-submitted',
  );
  expect(
    mapHarnessFailure({ submission: 'session-missing' }, undefined, 'infer', 'codex').failure.code,
  ).toBe('HARNESS_SESSION_MISSING');
});
