import { nodesOfKind, validateLoop, type ValidationIssue } from '@graphgoblin/domain';
import type { LoopDefinition, LoopIssue } from '@graphgoblin/contracts';
import type { Container } from './container.js';
import { classifierIssues } from './classifier-issues.js';
import { modelIssues } from './model-issues.js';

/** The same authoring and publication checks for normal and template-created loop drafts. */
export async function loopPublicationIssues(
  container: Container,
  ownerId: string,
  definition: LoopDefinition,
  selfId?: string,
): Promise<LoopIssue[]> {
  const { loops } = container.repos;
  const issues: ValidationIssue[] = [];
  let selfVersion: number | undefined;
  for (const node of nodesOfKind(definition, 'subloop')) {
    const { loopId, version } = node.config.loopRef;
    if (loopId === selfId) {
      if (version === 'latest') continue;
      if (selfVersion === undefined) {
        const versions = await loops.listVersions(loopId);
        selfVersion =
          versions.find((candidate) => candidate.status === 'draft')?.version ??
          Math.max(0, ...versions.map((candidate) => candidate.version)) + 1;
      }
      if (version === selfVersion) continue;
    }
    const target = await loops.getLoop(loopId);
    if (!target || target.ownerId !== ownerId) {
      issues.push({
        code: 'SUBLOOP_NOT_FOUND',
        severity: 'error',
        message: `subloop "${node.id}" references loop ${loopId}, which does not exist`,
        nodeId: node.id,
      });
      continue;
    }
    const published =
      version === 'latest'
        ? await loops.getLatestPublished(loopId)
        : await loops.getPublished(loopId, version);
    if (!published)
      issues.push({
        code: 'SUBLOOP_NOT_PUBLISHED',
        severity: 'error',
        message: `subloop "${node.id}" references "${target.name}", which has no published ${
          version === 'latest' ? 'version' : `version ${version}`
        }`,
        nodeId: node.id,
      });
  }
  return [
    ...validateLoop(definition),
    ...container.triggers.checkDefinition(definition),
    ...issues,
    ...(await modelIssues(container, ownerId, definition)),
    ...(await classifierIssues(container, ownerId, definition)),
  ];
}
