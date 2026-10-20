import { describe, expect, it } from 'vitest';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { cliFailureState, readinessFailure, readinessMessage } from './readiness.js';

describe('no-turn readiness diagnostics', () => {
  it.each([
    ['Failed to connect to authentication server: ECONNREFUSED', 'transport'],
    ['stream disconnected before completion: authentication token refresh timed out', 'transport'],
    ['Invalid API key ? Please run /login', 'auth'],
    ['API Error: 500 Internal server error', 'transport'],
    ['ETIMEDOUT', 'transport'],
    ['EAI_AGAIN', 'transport'],
    ['quota exhausted', 'quota'],
    ['HTTP/1.1 429', 'quota'],
    ['status:403', 'auth'],
    ['{"status_code":503}', 'transport'],
    ['401 unauthorized', 'auth'],
    ['unknown option --effort', 'cli-incompatible'],
    ["error: unknown option '--network-access'", 'cli-incompatible'],
    ["error: unexpected argument '--network' found", 'cli-incompatible'],
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
  it('writes one capitalised detail sentence and one action for each failed state', () => {
    for (const state of HarnessReadinessStateSchema.options) {
      if (state === 'ready') continue;
      for (const [harness, name] of [
        ['claude', 'Claude'],
        ['codex', 'Codex'],
        ['litellm', 'Litellm'],
      ] as const) {
        const [problem] = readinessFailure(harness, state).problems;
        // Two sentences: the detail names the harness, the action ends with retrying preflight.
        expect(problem?.match(/[.!?](?:\s|$)/g)).toHaveLength(2);
        expect(problem).toMatch(new RegExp(`^${name} `));
        expect(problem).toMatch(/retry preflight\.$/);
        expect(problem).not.toMatch(/reload the page|\bclaude (?!auth login)|\bcodex (?!login)/);
      }
    }
    expect(readinessMessage('claude', 'auth')).toBe(
      'Claude sign-in is missing or invalid. Run claude auth login, then retry preflight.',
    );
    expect(readinessMessage('codex', 'cli-missing')).toBe(
      'Codex CLI was not found. Install the Codex CLI or set GG_CODEX_BINARY, then retry preflight.',
    );
    expect(readinessMessage('litellm', 'auth')).toMatch(/Run the Litellm login command/);
    expect(readinessMessage('litellm', 'cli-missing')).toMatch(/set its binary path/);
    expect(readinessMessage('claude', 'ready')).not.toMatch(/retry/);
    expect(readinessFailure('codex', 'cli-incompatible', 'Codex CLI 0.150.0 is too old.')).toEqual({
      state: 'cli-incompatible',
      ok: false,
      problems: ['Codex CLI 0.150.0 is too old. Update the Codex CLI, then retry preflight.'],
    });
  });
});

it('does not treat CLI version numbers as HTTP failure codes', () => {
  for (const patch of [401, 403, 429, 503])
    expect(cliFailureState(`CLI 2.1.${patch}: unrecognized diagnostic`)).toBe('unknown');
});

it('describes transport without assuming a connection failure', () => {
  for (const name of ['Claude', 'Codex'])
    expect(readinessMessage(name.toLowerCase(), 'transport')).toBe(
      `${name} reported a connection or provider service error. Check the network connection and the provider's service status, then retry preflight.`,
    );
});
