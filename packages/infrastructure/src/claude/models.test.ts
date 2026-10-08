import { describe, expect, it } from 'vitest';
import { ClaudeModelCapabilitySchema } from '@graphgoblin/contracts';
import {
  claudeModelBlocked,
  claudeModelCapabilities,
  CLAUDE_FABLE_MODEL,
  CLAUDE_MODEL,
} from './models.js';
import { resolvedClaudeSettings } from './policy.js';
import { ClaudeHarness } from './harness.js';
describe('exact Claude model capabilities', () => {
  it('keeps Fable documented but blocked independently of owner preferences', () => {
    const entries = claudeModelCapabilities();
    for (const entry of entries) expect(ClaudeModelCapabilitySchema.parse(entry)).toEqual(entry);
    expect(entries.find((e) => e.model === CLAUDE_MODEL)).toMatchObject({
      admission: 'supported',
      reasonCode: null,
      billingStatus: 'account-dependent',
    });
    expect(entries.find((e) => e.model === CLAUDE_FABLE_MODEL)).toMatchObject({
      admission: 'blocked',
      reasonCode: 'BILLING_UNVERIFIED',
      billingStatus: 'unverified',
    });
    expect(claudeModelBlocked(CLAUDE_FABLE_MODEL)).toBe(true);
    expect(claudeModelBlocked(CLAUDE_MODEL)).toBe(false);
    expect(claudeModelBlocked(undefined)).toBe(false);
    expect(() => resolvedClaudeSettings({ model: CLAUDE_FABLE_MODEL, effort: 'xhigh' })).toThrow(
      /billing/,
    );
    entries[0]!.efforts.length = 0;
    expect(claudeModelCapabilities()[0]!.efforts).toHaveLength(5);
  });
  it('refuses blocked Fable before even authentication transport', async () => {
    const calls: string[][] = [];
    const harness = new ClaudeHarness({
      platform: 'win32',
      runner: (request) => {
        calls.push([...request.args]);
        return Promise.reject(new Error('Transport must remain unused'));
      },
    });
    const session = harness.start(
      {
        workingDirectory: '.',
        model: CLAUDE_FABLE_MODEL,
        effort: 'xhigh',
        options: { sandbox: 'read-only', approval: 'never' },
        turn: { prompt: 'Synthetic' },
      },
      new AbortController().signal,
    );
    await expect(session.result).rejects.toMatchObject({ code: 'HARNESS_MODEL_UNVERIFIED' });
    expect(calls).toEqual([]);
  });
});
