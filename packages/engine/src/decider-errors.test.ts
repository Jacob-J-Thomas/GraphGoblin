import { describe, expect, it } from 'vitest';
import {
  DeciderFailureError,
  deciderFailure,
  isDeciderError,
  summarizeDeciderError,
} from './decider-errors.js';

describe('safe provider summaries', () => {
  it.each([
    undefined,
    null,
    'secret',
    {},
    { code: 42 },
    { code: 'DECIDER_secret', name: 'secret', status: 'secret' },
  ])('discards untrusted text (%j)', (error) => {
    expect(summarizeDeciderError(error)).toEqual({
      message: 'Decision provider request failed',
      name: 'Error',
    });
    expect(deciderFailure(error).details).toEqual({ code: 'DECIDER_ERROR' });
  });
  it.each([99, 600, NaN, 400.5])('discards invalid HTTP statuses (%s)', (status) => {
    expect(summarizeDeciderError({ status })).not.toHaveProperty('status');
  });
  it.each([
    'DECIDER_UNAVAILABLE',
    'DECIDER_NOT_AUTHENTICATED',
    'DECIDER_RATE_LIMITED',
    'DECIDER_HTTP_ERROR',
    'DECIDER_UNREACHABLE',
    'DECIDER_INVALID_RESPONSE',
    'DECIDER_REDIRECT',
    'DECIDER_TIMEOUT',
    'DECIDER_ERROR',
  ])('retains recognized codes (%s)', (code) => {
    const error = Object.assign(new Error('secret'), { code, name: 'JevError', status: 400 });
    expect(summarizeDeciderError(error)).toMatchObject({ code, name: 'JevError', status: 400 });
    const wrapped = new DeciderFailureError(error, 'jev');
    expect(deciderFailure(wrapped)).toMatchObject({
      details: { code, strategy: 'jev' },
      diagnostic: { name: 'JevError', code, status: 400, strategy: 'jev' },
    });
    expect(JSON.stringify(deciderFailure(wrapped))).not.toContain('secret');
    expect(isDeciderError(error)).toBe(true);
  });
  it('wraps uncoded exceptions without retaining their message or stack', () => {
    const wrapped = new DeciderFailureError(new Error('secret'), 'codex');
    expect(deciderFailure(wrapped)).toMatchObject({
      details: { code: 'DECIDER_ERROR', strategy: 'codex' },
      diagnostic: { name: 'Error', code: 'DECIDER_ERROR', strategy: 'codex' },
    });
    expect(isDeciderError(wrapped)).toBe(true);
    expect(isDeciderError(new Error('ordinary bug'))).toBe(false);
  });
});
