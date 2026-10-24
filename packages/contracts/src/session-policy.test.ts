import { describe, expect, it } from 'vitest';
import { InferenceConfigSchema, SessionPolicySchema } from './nodes.js';

describe('authored own-session policy', () => {
  it('keeps the default fresh and gives own continuity no implicit reset', () => {
    expect(InferenceConfigSchema.parse({ prompt: { template: 'task' } }).session).toEqual({
      policy: 'fresh',
    });
    expect(SessionPolicySchema.parse({ policy: 'resume-own' })).toEqual({ policy: 'resume-own' });
  });
  it.each([1, 2, Number.MAX_SAFE_INTEGER])(
    'accepts an explicit reset after %s visits',
    (resetAfterVisits) => {
      expect(SessionPolicySchema.parse({ policy: 'resume-own', resetAfterVisits })).toEqual({
        policy: 'resume-own',
        resetAfterVisits,
      });
    },
  );
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, null, '2'])(
    'refuses an invalid reset %s',
    (resetAfterVisits) => {
      expect(
        SessionPolicySchema.safeParse({ policy: 'resume-own', resetAfterVisits }).success,
      ).toBe(false);
    },
  );
  it.each([
    { policy: 'fresh' },
    { policy: 'resume-previous' },
    { policy: 'resume-named', key: 'shared' },
  ])('preserves an existing policy $policy', (session) => {
    expect(SessionPolicySchema.parse(session)).toEqual(session);
    expect(SessionPolicySchema.safeParse({ ...session, resetAfterVisits: 2 }).success).toBe(false);
  });
});
