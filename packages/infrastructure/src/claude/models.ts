import type { ClaudeModelCapability } from '@graphgoblin/contracts';
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_FABLE_MODEL = 'claude-fable-5-1';
/** Exact documented identities admitted through the same model and effort checks. */
export function claudeModelCapabilities(): ClaudeModelCapability[] {
  const efforts: ClaudeModelCapability['efforts'] = ['low', 'medium', 'high', 'xhigh', 'max'];
  return [
    {
      model: CLAUDE_MODEL,
      efforts: [...efforts],
    },
    {
      model: CLAUDE_FABLE_MODEL,
      efforts: [...efforts],
    },
  ];
}
