/**
 * Pure projections from API records to the compact shapes the tools return. Agents get what they
 * need to act (ids, input schemas, what a run is waiting for) without the full records.
 */
import type {
  LoopDefinition,
  LoopRecord,
  LoopVersionRecord,
  RunRecord,
} from '@graphgoblin/contracts';

export function summarizeLoop(loop: LoopRecord) {
  return {
    id: loop.id,
    name: loop.name,
    ...(loop.description ? { description: loop.description } : {}),
    published: loop.currentVersionId !== undefined,
    hasDraft: loop.draftVersionId !== undefined,
    updatedAt: loop.updatedAt,
  };
}

/** Triggers, input waits, and exits of a definition: what a caller passes in and gets back. */
export function describeDefinition(definition: LoopDefinition) {
  const triggers = [];
  const inputWaits = [];
  const exits = [];
  for (const node of definition.nodes) {
    if (node.kind === 'trigger') {
      const config = node.config;
      triggers.push({
        nodeId: node.id,
        label: node.label,
        subtype: config.subtype,
        ...(config.subtype === 'manual'
          ? {
              startableFromMcp: config.exposeTo.includes('mcp'),
              ...(config.inputSchema ? { inputSchema: config.inputSchema } : {}),
            }
          : {}),
      });
    } else if (node.kind === 'wait' && node.config.mode === 'input') {
      inputWaits.push({
        nodeId: node.id,
        label: node.label,
        prompt: node.config.prompt,
        ...(node.config.inputSchema ? { inputSchema: node.config.inputSchema } : {}),
      });
    } else if (node.kind === 'exit') {
      exits.push({
        nodeId: node.id,
        label: node.label,
        default: node.config.default,
        returnMapping: node.config.return.mapping,
        returnChannels: node.config.return.channels.map((c) => c.kind),
      });
    }
  }
  return {
    name: definition.name,
    ...(definition.description ? { description: definition.description } : {}),
    nodeCount: definition.nodes.length,
    nodeKinds: [...new Set(definition.nodes.map((n) => n.kind))],
    variables: definition.variables,
    triggers,
    inputWaits,
    exits,
  };
}

/** The loop with the version runs start from: the published one, or the draft if none is published. */
export function describeLoop(detail: {
  loop: LoopRecord;
  current?: LoopVersionRecord;
  draft?: LoopVersionRecord;
}) {
  const version = detail.current ?? detail.draft;
  return {
    loop: summarizeLoop(detail.loop),
    version: version
      ? {
          id: version.id,
          number: version.version,
          status: version.status,
          ...(version.publishedAt ? { publishedAt: version.publishedAt } : {}),
        }
      : null,
    ...(detail.current
      ? {}
      : {
          note: 'This loop has no published version; the description is of the draft. start_run needs allowDraft: true until it is published.',
        }),
    ...(version ? describeDefinition(version.definition) : {}),
  };
}

/** A run without the bulky fields, for listings. */
export function summarizeRun(run: RunRecord) {
  return {
    id: run.id,
    loopId: run.loopId,
    status: run.status,
    ...(run.currentNodeId ? { currentNodeId: run.currentNodeId } : {}),
    iteration: run.iteration,
    ...(run.outcome ? { outcome: run.outcome } : {}),
    ...(run.waiting ? { waiting: run.waiting } : {}),
    ...(run.failure ? { failure: { code: run.failure.code, message: run.failure.message } } : {}),
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    createdAt: run.createdAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
}
