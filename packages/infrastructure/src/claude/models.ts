import type { ClaudeModelCapability } from '@graphgoblin/contracts';
export const CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_FABLE_MODEL = 'claude-fable-5-1';
export const CLAUDE_SONNET_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_HAIKU_MODEL = 'claude-haiku-5-5';
/** One harness-owned catalog row per supported Claude identity. */
export interface ClaudeCatalogModel extends ClaudeModelCapability {
  displayName: string;
}
const ALL_EFFORTS: ClaudeModelCapability['efforts'] = ['low', 'medium', 'high', 'xhigh', 'max'];
/**
 * Exact identities admitted through the same model and effort checks. Sonnet 5.5 and Haiku 5.5
 * were verified on 2026-10-18 with bounded real turns through installed CLI 2.1.292 and a
 * Claude.ai login: the init record and result usage reported exactly these ids. The verified
 * efforts and their evidence are recorded in docs/06-harness-integration.md.
 */
const CLAUDE_MODELS: readonly ClaudeCatalogModel[] = [
  { model: CLAUDE_MODEL, displayName: 'Claude Opus 5.5', efforts: ALL_EFFORTS },
  { model: CLAUDE_FABLE_MODEL, displayName: 'Claude Fable 5.1', efforts: ALL_EFFORTS },
  { model: CLAUDE_SONNET_MODEL, displayName: 'Claude Sonnet 5.5', efforts: ALL_EFFORTS },
  { model: CLAUDE_HAIKU_MODEL, displayName: 'Claude Haiku 5.5', efforts: ALL_EFFORTS },
];
/** Fresh copies, so callers cannot change the supported set. */
export function claudeCatalogModels(): ClaudeCatalogModel[] {
  return CLAUDE_MODELS.map((entry) => ({ ...entry, efforts: [...entry.efforts] }));
}
export function claudeModelCapabilities(): ClaudeModelCapability[] {
  return CLAUDE_MODELS.map(({ model, efforts }) => ({ model, efforts: [...efforts] }));
}
