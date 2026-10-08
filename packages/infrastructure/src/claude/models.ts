import type { ClaudeModelCapability } from '@graphgoblin/contracts';
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_FABLE_MODEL = 'claude-fable-5-1';
/** Exact documented identities; blocked entries cannot be enabled by a catalog preference. */
export function claudeModelCapabilities(): ClaudeModelCapability[] {
  const efforts: ClaudeModelCapability['efforts'] = ['low', 'medium', 'high', 'xhigh', 'max'];
  return [
    {
      model: CLAUDE_MODEL,
      efforts: [...efforts],
      admission: 'supported',
      reasonCode: null,
      billingStatus: 'account-dependent',
    },
    {
      model: CLAUDE_FABLE_MODEL,
      efforts: [...efforts],
      admission: 'blocked',
      reasonCode: 'BILLING_UNVERIFIED',
      billingStatus: 'unverified',
    },
  ];
}
export const CLAUDE_BILLING_UNVERIFIED_MESSAGE =
  'Fable billing is unverified; Claude account login does not establish included use and native CLI calls may use paid usage credits';
export function claudeModelBlocked(model: string | undefined): boolean {
  return claudeModelCapabilities().some(
    (entry) => entry.model === model && entry.admission === 'blocked',
  );
}
