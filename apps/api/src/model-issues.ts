import type { Effort, HarnessId, LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import { resolveHarnessModel, validateHarnessDefaults } from '@graphgoblin/domain';
import type { Container } from './container.js';
import {
  claudeModelBlocked,
  CLAUDE_BILLING_UNVERIFIED_MESSAGE,
} from '@graphgoblin/infrastructure/claude';
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
  for (const [level, defaults] of [
    ['loop', shared.loopDefaults],
    ['owner', ownerDefaults],
    ['process', shared.processDefaults],
  ] as const)
    if (claudeModelBlocked(defaults.byHarness.claude?.model))
      issues.push({
        code: 'HARNESS_MODEL_UNVERIFIED',
        severity: 'warning',
        path:
          (level === 'loop' ? 'settings.defaults' : level + '.defaults') +
          '.byHarness.claude.model',
        message: CLAUDE_BILLING_UNVERIFIED_MESSAGE,
      });
  let claudePreflight:
    ReturnType<NonNullable<typeof container.ports.harnesses.claude>['preflight']> | undefined;
  async function check(
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
    if (harness === 'claude' && resolution.status === 'ready') {
      if (claudeModelBlocked(resolution.model))
        issues.push({
          code: 'HARNESS_MODEL_UNVERIFIED',
          severity: 'warning',
          nodeId,
          path: path + '.model',
          message: CLAUDE_BILLING_UNVERIFIED_MESSAGE,
        });
      else if (container.ports.harnesses.claude) {
        try {
          claudePreflight ??= container.ports.harnesses.claude.preflight();
          const preflight = await claudePreflight;
          if (!preflight.ok)
            issues.push({
              code: 'HARNESS_UNAVAILABLE',
              severity: 'warning',
              nodeId,
              path: path + '.harness',
              message:
                preflight.problems.join('; ') ||
                'Claude installation or account login is unavailable',
            });
        } catch {
          issues.push({
            code: 'HARNESS_UNAVAILABLE',
            severity: 'warning',
            nodeId,
            path: path + '.harness',
            message: 'Claude preflight is unavailable',
          });
        }
      }
    }
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
      await check(node.config.harness, node.config.model, node.config.effort, node.id, 'config');
    if (node.kind === 'decision' && node.config.evaluation.kind === 'llm') {
      const evaluation = node.config.evaluation;
      await check(
        evaluation.harness,
        evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
        evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
        node.id,
        'config.evaluation',
      );
    }
    if (node.kind === 'exit') {
      for (const [index, criterion] of node.config.criteria.entries()) {
        if (criterion.when !== 'predicate' || criterion.evaluation.kind !== 'llm') continue;
        const evaluation = criterion.evaluation;
        await check(
          evaluation.harness,
          evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
          evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
          node.id,
          'config.criteria.' + index + '.evaluation',
        );
      }
    }
  }
  return issues;
}
export function blocksPublication(issue: LoopIssue): boolean {
  return (
    issue.severity === 'error' ||
    [
      'MODEL_DISABLED',
      'HARNESS_UNAVAILABLE',
      'HARNESS_MODEL_UNVERIFIED',
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

/** Missing inherited readiness can be fixed after authoring; explicit invalid choices cannot. */
export function rejectsDraftAdmission(definition: LoopDefinition, issue: LoopIssue): boolean {
  if (!rejectsAdmission(issue)) return false;
  if (issue.path?.startsWith('owner.defaults.') || issue.path?.startsWith('process.defaults.'))
    return false;
  const field = issue.path?.endsWith('.model')
    ? 'model'
    : issue.path?.endsWith('.effort')
      ? 'effort'
      : undefined;
  const node = definition.nodes.find((candidate) => candidate.id === issue.nodeId);
  if (!node || !field) return true;
  if (node.kind === 'inference') return node.config[field] !== undefined;
  if (node.kind === 'decision' && node.config.evaluation.kind === 'llm')
    return node.config.evaluation[field].mode === 'explicit';
  if (node.kind === 'exit') {
    const index = /^config\.criteria\.(\d+)\.evaluation\./.exec(issue.path ?? '')?.[1];
    const criterion = index === undefined ? undefined : node.config.criteria[Number(index)];
    if (criterion?.when === 'predicate' && criterion.evaluation.kind === 'llm')
      return criterion.evaluation[field].mode === 'explicit';
  }
  return true;
}
