import type { LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import type { Container } from './container.js';

/** Shared by every definition admission endpoint; paths are relative to the node. */
export async function classifierIssues(
  container: Container,
  ownerId: string,
  definition: LoopDefinition,
): Promise<LoopIssue[]> {
  const entries = await container.repos.classifiers.list(ownerId);
  const issues: LoopIssue[] = [];
  for (const node of definition.nodes) {
    const selections =
      node.kind === 'decision' && node.config.evaluation.kind === 'classifier'
        ? [
            {
              id: node.config.evaluation.model,
              primitive: node.config.answer.type,
              path: 'config.evaluation.model',
              kind: 'Decision',
              unavailable: 'This evaluation is unavailable; publication is blocked.',
            },
          ]
        : node.kind === 'exit'
          ? node.config.criteria.flatMap((criterion, index) =>
              criterion.when === 'predicate' && criterion.evaluation.kind === 'classifier'
                ? [
                    {
                      id: criterion.evaluation.model,
                      primitive: criterion.answer.type,
                      path: 'config.criteria.' + index + '.evaluation.model',
                      kind: 'Exit',
                      unavailable: 'This evaluation is unavailable; publication is blocked.',
                    },
                  ]
                : [],
            )
          : [];
    for (const { id, primitive, path, kind, unavailable } of selections) {
      const entry = entries.find((model) => model.id === id);
      const prefix =
        kind +
        " '" +
        node.label +
        "' (" +
        node.id +
        "), classifier '" +
        (entry?.displayName ?? id) +
        "' (" +
        id +
        ')';
      const add = (code: string, severity: 'error' | 'warning', message: string) =>
        issues.push({ code, severity, nodeId: node.id, path, message: prefix + ': ' + message });
      if (!entry) {
        add(
          'CLASSIFIER_MODEL_NOT_FOUND',
          'error',
          'model not found. Register it in Settings, Classifier models, or select an existing model.',
        );
        continue;
      }
      if (!entry.primitives.includes(primitive)) {
        add(
          'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
          'error',
          (primitive === 'choice' ? 'Choice' : primitive === 'noul' ? 'Noul' : 'Score') +
            ' is not supported. Select a compatible classifier or edit its capabilities in Settings, Classifier models.',
        );
        continue;
      }
      if (!entry.enabled)
        add(
          'CLASSIFIER_MODEL_DISABLED',
          'warning',
          'model is disabled. Enable it in Settings, Classifier models. ' + unavailable,
        );
      const { summary, issue } = await container.classifierRegistry.inspect(ownerId, entry);
      if (issue)
        add(
          issue,
          'warning',
          summary.configurationReason +
            ' Configure its key in Settings, Classifier models. ' +
            unavailable,
        );
    }
  }
  return issues;
}
