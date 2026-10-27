import {
  LoopDefinitionSchema,
  type HarnessDefaults,
  type LoopDefinitionInput,
  type ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { inheritedHarnessDefaults } from '@graphgoblin/domain';
import { unsupportedEffortMessage } from '../forms/fields/model.js';
import type { EditorIssue } from './model.js';

/**
 * Each inference node and LLM decision whose explicit effort its model does not offer, as an
 * `EFFORT_UNSUPPORTED` error on that node's Effort field. The API refuses to save such a draft,
 * so its own check (which reads only a saved draft) never reports it; the editor finds it from the
 * model catalog as soon as the model or effort changes. The choice itself is left as it is.
 *
 * An inherited model counts only once the owner and process defaults are known.
 */
export function unsupportedEffortIssues(
  definition: LoopDefinitionInput,
  catalog: readonly ModelCatalogEntry[] | undefined,
  defaults: { owner: HarnessDefaults; process: HarnessDefaults } | undefined,
): EditorIssue[] {
  if (!catalog) return [];
  const parsed = LoopDefinitionSchema.safeParse(definition);
  if (!parsed.success) return [];
  return parsed.data.nodes.flatMap((node): EditorIssue[] => {
    const selection =
      node.kind === 'inference'
        ? { harness: node.config.harness, model: node.config.model, effort: node.config.effort }
        : node.kind === 'decision' && node.config.kind === 'llm'
          ? {
              harness: node.config.harness,
              model: node.config.model.mode === 'explicit' ? node.config.model.value : undefined,
              effort: node.config.effort.mode === 'explicit' ? node.config.effort.value : undefined,
            }
          : undefined;
    if (!selection?.effort) return [];
    const model =
      selection.model ??
      (defaults &&
        inheritedHarnessDefaults({
          harness: selection.harness,
          loopDefaults: parsed.data.settings.defaults,
          ownerDefaults: defaults.owner,
          processDefaults: defaults.process,
        }).model);
    const entry = catalog.find((row) => row.harness === selection.harness && row.model === model);
    if (!entry || entry.efforts.includes(selection.effort)) return [];
    return [
      {
        code: 'EFFORT_UNSUPPORTED',
        severity: 'error',
        nodeId: node.id,
        path: 'config.effort',
        message: unsupportedEffortMessage(selection.effort, entry.displayName),
      },
    ];
  });
}
