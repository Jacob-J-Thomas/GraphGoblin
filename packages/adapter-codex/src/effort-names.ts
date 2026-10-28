import type { Effort } from '@graphgoblin/contracts';

/**
 * The provider's name for each canonical effort, per Codex model family (#205).
 *
 * GraphGoblin offers one lowest level, `none` (no reasoning). Model families name that level
 * differently: some accept `none`, older ones call it `minimal`. Every other level has the same
 * name for every family. The run records the canonical effort the user chose; only the CLI
 * invocation (`--config model_reasoning_effort="<name>"`) carries the provider's name.
 *
 * | Family (model id prefix) | Canonical `none` sent as | Evidence                                          |
 * | ------------------------ | ------------------------ | ------------------------------------------------- |
 * | `gpt-6`                  | `none`                   | live turn on `gpt-6-luna`, CLI 0.160.0, 2026-10-28 |
 * | `gpt-5.6`                | `none`                   | offered with GPT-6 (#205); not verified live      |
 * | any other model          | `none` (canonical name)  | no family known; the provider decides             |
 *
 * A family that names the level `minimal` is one entry `{ prefix: '<family>', none: 'minimal' }`.
 * None is seeded today: no model the catalog ships names it so (docs/06-harness-integration.md).
 */
export interface CodexEffortFamily {
  /** Model ids equal to this prefix, or continuing it with `-` or `.`, belong to the family. */
  readonly prefix: string;
  /** The provider's name for the canonical `none` in this family. */
  readonly none: 'none' | 'minimal';
}

export const CODEX_EFFORT_FAMILIES: readonly CodexEffortFamily[] = [
  { prefix: 'gpt-6', none: 'none' },
  { prefix: 'gpt-5.6', none: 'none' },
];

/** A canonical effort, or a provider's own name for the lowest level. */
export type CodexProviderEffort = Effort | 'minimal';

function belongs(model: string, prefix: string): boolean {
  if (!model.startsWith(prefix)) return false;
  const next = model.charAt(prefix.length);
  return next === '' || next === '-' || next === '.';
}

/** The name the Codex CLI receives for `effort` on `model`. */
export function codexEffortName(
  model: string,
  effort: Effort,
  families: readonly CodexEffortFamily[] = CODEX_EFFORT_FAMILIES,
): CodexProviderEffort {
  if (effort !== 'none') return effort;
  return families.find((family) => belongs(model, family.prefix))?.none ?? effort;
}
