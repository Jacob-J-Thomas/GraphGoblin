import type { HarnessId, LoopIssue, LoopVersionRecord } from '@graphgoblin/contracts';
import { readinessMessage } from '@graphgoblin/domain';
import type { RunStartPlan } from '@graphgoblin/engine';
import type { ReadinessOperation } from './readiness-operation.js';

type RunReadinessIssue = LoopIssue & { loopId: string; versionId: string };
export class RunReadinessError extends Error {
  constructor(readonly issues: RunReadinessIssue[]) {
    super('Harness readiness checks failed. Fix the listed problems, then start the run again.');
  }
}

/** Manual admission checks the engine's pins, never a mutable draft or a later publication. */
export async function assertRunReadiness(
  plan: RunStartPlan,
  readiness: ReadinessOperation,
): Promise<void> {
  const numbered = new Map(
    [...plan.versions.values()]
      .filter((version) => version.status === 'published')
      .map((version) => [`${version.loopId}:${version.version}`, version]),
  );
  const pending = [{ version: plan.root, depth: 0 }];
  const visited = new Set<string>([plan.root.id]);
  const selections: { version: LoopVersionRecord; nodeId: string; harness: HarnessId }[] = [];
  // Breadth first visits a repeated version at its shallowest depth. A cycle cannot add work.
  // Use the handler's configured per-edge limit (including overrides); schemas cap it at 64.
  for (let i = 0; i < pending.length; i++) {
    const { version, depth } = pending[i]!;
    for (const node of version.definition.nodes) {
      if (node.kind === 'inference')
        selections.push({ version, nodeId: node.id, harness: node.config.harness });
      if (node.kind === 'decision' && node.config.kind === 'llm')
        selections.push({ version, nodeId: node.id, harness: node.config.harness });
      if (node.kind !== 'subloop') continue;
      const limit = node.config.depthLimitOverride ?? version.definition.settings.subloopDepthLimit;
      if (depth + 1 > limit) continue;
      const ref = node.config.loopRef;
      const target =
        ref.version === 'latest'
          ? plan.versions.get(plan.subloopVersions[ref.loopId] ?? '')
          : numbered.get(`${ref.loopId}:${ref.version}`);
      // Unresolved references keep their existing SUBLOOP_NOT_FOUND execution behavior.
      if (!target || visited.has(target.id)) continue;
      visited.add(target.id);
      pending.push({ version: target, depth: depth + 1 });
    }
  }
  const results = await Promise.all(
    selections.map(async ({ version, nodeId, harness }): Promise<RunReadinessIssue[]> => {
      const result = await readiness.probe(harness);
      if (result.state === 'ready') return [];
      const detail = result.problems.join(' ') || readinessMessage(harness, result.state);
      return [
        {
          code: 'HARNESS_READINESS_' + result.state.toUpperCase().replaceAll('-', '_'),
          severity: 'warning',
          loopId: version.loopId,
          versionId: version.id,
          nodeId,
          path: 'config.harness',
          message:
            version.id === plan.root.id
              ? detail
              : `Loop "${version.definition.name}" (${version.loopId}), node "${nodeId}": ${detail}`,
        },
      ];
    }),
  );
  const issues = results.flat();
  if (issues.length) throw new RunReadinessError(issues);
}
