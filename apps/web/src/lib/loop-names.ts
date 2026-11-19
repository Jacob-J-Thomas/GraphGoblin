import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { loopNameKey } from '@graphgoblin/domain';

/** Whether the API counts `a` and `b` as the same loop name. */
export function sameLoopName(a: string, b: string): boolean {
  return loopNameKey(a) === loopNameKey(b);
}

/** A refused attempt: 409 `LOOP_NAME_CONFLICT`, with the API's advisory suggestion. */
export interface LoopNameConflict {
  /** The name the attempt asked for; unknown when the API chose it (a template's own name). */
  name: string | undefined;
  /**
   * An available name when the API refused, or undefined when it sent none. Advisory only: another
   * writer can take it before a retry, which the API then refuses with a fresh suggestion.
   */
  suggestedName: string | undefined;
}

/**
 * The API's name refusal for an attempt that asked for `name`, or undefined for any other failure.
 * Only the exact code counts, and `suggestedName` only when it is a non-blank string.
 */
export function loopNameConflict(
  error: unknown,
  name: string | undefined,
): LoopNameConflict | undefined {
  if (!(error instanceof GraphGoblinApiError) || error.code !== 'LOOP_NAME_CONFLICT')
    return undefined;
  const suggested = error.problem?.['suggestedName'];
  return {
    name,
    suggestedName: typeof suggested === 'string' && suggested.trim() !== '' ? suggested : undefined,
  };
}

/** The rule in one sentence, for every place that reports a refusal. */
export const LOOP_NAME_RULE =
  'Names that differ only in letter case or spacing count as the same name.';

/** The name an import document asks for: an export's `loop.name`, or a bare definition's `name`. */
export function importedLoopName(document: Record<string, unknown>): string | undefined {
  const loop = document['loop'];
  const source =
    typeof loop === 'object' && loop !== null ? (loop as Record<string, unknown>) : document;
  return typeof source['name'] === 'string' ? source['name'] : undefined;
}
