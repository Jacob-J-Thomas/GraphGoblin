import type { Effort, HarnessId, LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import { resolveHarnessModel, validateHarnessDefaults } from '@graphgoblin/domain';
import type { Container } from './container.js';
import { readOwnerDefaults } from './container.js';

/** One catalog snapshot and the same resolver as execution, for all authoring admission endpoints. */
export async function modelIssues(
  container: Container,
  ownerId: string,
  definition: LoopDefinition,
): Promise<LoopIssue[]> {
  const catalog = await container.repos.catalog.list();
  const ownerDefaults = await readOwnerDefaults(container.repos.settings, ownerId);
  const shared = {
    loopDefaults: definition.settings.defaults,
    ownerDefaults,
    processDefaults: container.config.defaults,
    catalog,
  };
  const issues: LoopIssue[] = validateHarnessDefaults(shared).map(
    ({ level, harness, resolution }) => ({
      code: resolution.code,
      severity: 'error',
      message: resolution.message,
      path:
        (level === 'loop' ? 'settings.defaults' : level + '.defaults') +
        '.byHarness.' +
        harness +
        '.' +
        resolution.path,
    }),
  );
  function check(
    harness: HarnessId,
    model: string | undefined,
    effort: Effort | undefined,
    nodeId: string,
    path: string,
  ) {
    if (!container.ports.harnesses[harness]) {
      issues.push({
        code: 'HARNESS_UNAVAILABLE',
        severity: 'warning',
        nodeId,
        path,
        message: 'The selected harness is not configured; configure it before publication.',
      });
    }
    const resolution = resolveHarnessModel({
      ...shared,
      harness,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
    if (resolution.status !== 'ready')
      issues.push({
        code: resolution.code,
        severity: resolution.status === 'invalid' ? 'error' : 'warning',
        nodeId,
        path: path + '.' + resolution.path,
        message: resolution.message,
      });
  }
  for (const node of definition.nodes) {
    if (node.kind === 'inference')
      check(node.config.harness, node.config.model, node.config.effort, node.id, 'config');
    if (node.kind === 'decision' && node.config.evaluation.kind === 'llm') {
      const evaluation = node.config.evaluation;
      check(
        evaluation.harness,
        evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
        evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
        node.id,
        'config.evaluation',
      );
    }
    if (
      node.kind === 'exit' &&
      node.config.criteria.some(
        (criterion) => criterion.when === 'predicate' && criterion.strategy === 'codex',
      )
    )
      check('codex', undefined, undefined, node.id, 'config.criteria');
  }
  return issues;
}
export function blocksPublication(issue: LoopIssue): boolean {
  return (
    issue.severity === 'error' ||
    [
      'MODEL_DISABLED',
      'HARNESS_UNAVAILABLE',
      'CLASSIFIER_MODEL_DISABLED',
      'CLASSIFIER_SECRET_MISSING',
      'CLASSIFIER_SECRET_UNREADABLE',
    ].includes(issue.code)
  );
}
export function rejectsAdmission(issue: LoopIssue): boolean {
  return (
    issue.severity === 'error' &&
    [
      'MODEL_UNRESOLVED',
      'EFFORT_UNRESOLVED',
      'MODEL_NOT_IN_CATALOG',
      'MODEL_HARNESS_MISMATCH',
      'EFFORT_UNSUPPORTED',
      'CLASSIFIER_MODEL_NOT_FOUND',
      'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
    ].includes(issue.code)
  );
}
