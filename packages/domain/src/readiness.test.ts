import { describe, expect, it } from 'vitest';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { cliFailureState, readinessFailure, readinessMessage } from './readiness.js';

describe('no-turn readiness diagnostics', () => {
  it.each([
    ['quota exhausted', 'quota'],
    ['HTTP/1.1 429', 'quota'],
    ['status:403', 'auth'],
    ['{"status_code":503}', 'transport'],
    ['401 unauthorized', 'auth'],
    ['unknown option --effort', 'cli-incompatible'],
    ['ECONNRESET network', 'transport'],
    ['unrecognized failure', 'unknown'],
  ])('classifies %s without returning its body', (text, state) => {
    expect(cliFailureState(text)).toBe(state);
  });
  it('gives every state an action without model entitlement claims', () => {
    for (const state of HarnessReadinessStateSchema.options) {
      expect(readinessMessage('claude', state).length).toBeGreaterThan(30);
      expect(readinessMessage('codex', state).length).toBeGreaterThan(30);
      if (state !== 'ready')
        expect(readinessFailure('codex', state)).toMatchObject({ state, ok: false });
    }
  });
});

it('does not treat CLI version numbers as HTTP failure codes', () => {
  for (const patch of [401, 403, 429, 503])
    expect(cliFailureState(`CLI 2.1.${patch}: unrecognized diagnostic`)).toBe('unknown');
});
