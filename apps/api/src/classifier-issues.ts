import type { LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import type { Container } from './container.js';

/** Shared by every definition admission endpoint; paths are relative to the decision node. */
export async function classifierIssues(
  container: Container,
  ownerId: string,
  definition: LoopDefinition,
): Promise<LoopIssue[]> {
  const entries = await container.repos.classifiers.list(ownerId);
  const issues: LoopIssue[] = [];
  for (const node of definition.nodes) {
    if (node.kind !== 'decision' || !node.config.strategy.includes('jev')) continue;
    const id = node.config.jev?.model ?? 'jev';
    const entry = entries.find((model) => model.id === id);
    const prefix = `Decision '${node.label}' (${node.id}), classifier '${entry?.displayName ?? id}' (${id})`;
    const skipped =
      node.config.strategy.length === 1
        ? '; this strategy will be skipped and the decision cannot currently produce a route.'
        : '; this strategy will be skipped.';
    const add = (code: string, severity: 'error' | 'warning', message: string) => {
      issues.push({
        code,
        severity,
        nodeId: node.id,
        path: 'config.jev.model',
        message: `${prefix}: ${message}`,
      });
    };
    if (!entry) {
      add(
        'CLASSIFIER_MODEL_NOT_FOUND',
        'error',
        'model not found. Register it in Settings, Classifier models, or select an existing model.',
      );
      continue;
    }
    if (!entry.primitives.includes('choice')) {
      add(
        'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
        'error',
        'Choice is not supported. Select a Choice classifier or edit its capabilities in Settings, Classifier models.',
      );
      continue;
    }
    if (!entry.enabled)
      add(
        'CLASSIFIER_MODEL_DISABLED',
        'warning',
        `model is disabled. Enable it in Settings, Classifier models${skipped}`,
      );
    const { summary, issue } = await container.classifierRegistry.inspect(ownerId, entry);
    if (issue)
      add(
        issue,
        'warning',
        `${summary.configurationReason}. Set it in Settings, Secrets${skipped}`,
      );
  }
  return issues;
}
