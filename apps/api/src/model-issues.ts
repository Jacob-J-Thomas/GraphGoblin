import { readinessOperation, type ReadinessOperation } from './readiness-operation.js';
import type { Effort, HarnessId, LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import {
  readinessMessage,
  resolveHarnessModel,
  validateHarnessDefaults,
} from '@graphgoblin/domain';
import type { Container } from './container.js';
import { readOwnerDefaults } from './container.js';

/** One catalog snapshot and the same resolver as execution, for all authoring admission endpoints. */
export async function modelIssues(
  container: Container,
  ownerId: string,
  definition: LoopDefinition,
  readiness: ReadinessOperation | false = readinessOperation(container.ports.harnesses),
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
  async function check(
    harness: HarnessId,
    model: string | undefined,
    effort: Effort | undefined,
    nodeId: string,
    path: string,
  ) {
    const resolution = resolveHarnessModel({
      ...shared,
      harness,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
    const selectionIssues: LoopIssue[] = [];
    if (readiness && (resolution.status === 'ready' || !container.ports.harnesses[harness])) {
      const preflight = await readiness.probe(harness);
      if (preflight.state !== 'ready')
        selectionIssues.push({
          code: 'HARNESS_READINESS_' + preflight.state.toUpperCase().replaceAll('-', '_'),
          severity: 'warning',
          nodeId,
          path: path + '.harness',
          message: preflight.problems.join(' ') || readinessMessage(harness, preflight.state),
        });
    }
    if (resolution.status !== 'ready')
      selectionIssues.push({
        code: resolution.code,
        severity: resolution.status === 'invalid' ? 'error' : 'warning',
        nodeId,
        path: path + '.' + resolution.path,
        message: resolution.message,
      });
    return selectionIssues;
  }
  const selections: Promise<LoopIssue[]>[] = [];
  for (const node of definition.nodes) {
    if (node.kind === 'inference')
      selections.push(
        check(node.config.harness, node.config.model, node.config.effort, node.id, 'config'),
      );
    if (node.kind === 'decision' && node.config.kind === 'llm') {
      const evaluation = node.config;
      selections.push(
        check(
          evaluation.harness,
          evaluation.model.mode === 'explicit' ? evaluation.model.value : undefined,
          evaluation.effort.mode === 'explicit' ? evaluation.effort.value : undefined,
          node.id,
          'config',
        ),
      );
    }
  }
  return [...issues, ...(await Promise.all(selections)).flat()];
}
export function blocksPublication(issue: LoopIssue): boolean {
  return (
    issue.severity === 'error' ||
    issue.code.startsWith('HARNESS_READINESS_') ||
    [
      'MODEL_DISABLED',
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
  if (node.kind === 'decision' && node.config.kind === 'llm')
    return node.config[field].mode === 'explicit';

  return true;
}
