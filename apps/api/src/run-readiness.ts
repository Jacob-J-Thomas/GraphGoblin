import type {
  Effort,
  HarnessId,
  LoopIssue,
  LoopVersionRecord,
  ModelCatalogEntry,
} from '@graphgoblin/contracts';
import { readinessMessage, resolveHarnessModel } from '@graphgoblin/domain';
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
  catalog: readonly ModelCatalogEntry[],
): Promise<void> {
  const numbered = new Map(
    [...plan.versions.values()]
      .filter((version) => version.status === 'published')
      .map((version) => [`${version.loopId}:${version.version}`, version]),
  );
  const pending = [{ version: plan.root, depth: 0 }];
  const visited = new Set<string>([plan.root.id]);
  const selections: {
    version: LoopVersionRecord;
    nodeId: string;
    harness: HarnessId;
    model: string | undefined;
    effort: Effort | undefined;
  }[] = [];
  // Breadth first visits a repeated version at its shallowest depth. A cycle cannot add work.
  // Use the handler's configured per-edge limit (including overrides); schemas cap it at 64.
  for (let i = 0; i < pending.length; i++) {
    const { version, depth } = pending[i]!;
    for (const node of version.definition.nodes) {
      if (node.kind === 'inference')
        selections.push({
          version,
          nodeId: node.id,
          harness: node.config.harness,
          model: node.config.model,
          effort: node.config.effort,
        });
      if (node.kind === 'decision' && node.config.kind === 'llm')
        selections.push({
          version,
          nodeId: node.id,
          harness: node.config.harness,
          model: node.config.model.mode === 'explicit' ? node.config.model.value : undefined,
          effort: node.config.effort.mode === 'explicit' ? node.config.effort.value : undefined,
        });
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
    selections.map(
      async ({ version, nodeId, harness, model, effort }): Promise<RunReadinessIssue[]> => {
        const result = await readiness.probe(harness);
        if (result.state === 'ready') {
          if (harness !== 'claude' || result.models === undefined) return [];
          const resolution = resolveHarnessModel({
            harness,
            ...(model !== undefined ? { model } : {}),
            ...(effort !== undefined ? { effort } : {}),
            loopDefaults: version.definition.settings.defaults,
            ownerDefaults: plan.defaults.owner,
            processDefaults: plan.defaults.process,
            catalog,
            claudeCapabilities: result.models,
          });
          // Other catalog/configuration failures keep their existing execution-time handling.
          if (resolution.status !== 'invalid' || resolution.code !== 'EFFORT_UNSUPPORTED')
            return [];
          return [
            {
              code: resolution.code,
              severity: 'error',
              loopId: version.loopId,
              versionId: version.id,
              nodeId,
              path: 'config.effort',
              message: resolution.message,
            },
          ];
        }
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
      },
    ),
  );
  const issues = results.flat();
  if (issues.length) throw new RunReadinessError(issues);
}
