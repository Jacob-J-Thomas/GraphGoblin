import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { nextEdgeId, validateDraft, type EditorIssue } from './model.js';
import { expand, NODE_CARD_SIZE, overlapsBox } from './routing-geometry.js';
import {
  githubEventCheck,
  makeGitHubTriggerPreset,
  type GitHubTriggerPreset,
  type GitHubTriggerSetup,
} from './trigger-presets.js';

export interface GitHubPresetPreview {
  source: LoopDefinitionInput;
  definition: LoopDefinitionInput;
  triggerId: string;
  fields: string[];
  removedNodes: NodeInput[];
  addedNodes: NodeInput[];
  removedEdges: LoopDefinitionInput['edges'];
  addedEdges: LoopDefinitionInput['edges'];
  rewiredEdges: LoopDefinitionInput['edges'];
  issues: EditorIssue[];
}

/** Recognize only a private, immediate check/restore/exit topology. Config edits do not hide it.
 * Ambiguous or shared graphs are retained, never claimed as owned by a preset.
 */
function earlierFragment(def: LoopDefinitionInput, triggerId: string): NodeInput[] {
  const outgoing = def.edges.filter((edge) => edge.from.node === triggerId);
  if (outgoing.length !== 1) return [];
  const check = def.nodes.find((node) => node.id === outgoing[0]!.to.node);
  if (check?.kind !== 'decision') return [];
  const branches = def.edges.filter((edge) => edge.from.node === check.id);
  if (branches.length !== 2) return [];
  const restore = def.nodes.find((node) =>
    branches.some((edge) => edge.from.port === 'pass' && edge.to.node === node.id),
  );
  const quiet = def.nodes.find((node) =>
    branches.some((edge) => edge.from.port === 'ignore' && edge.to.node === node.id),
  );
  if (restore?.kind !== 'mutate' || quiet?.kind !== 'exit') return [];
  const nodes = [check, restore, quiet];
  if (nodes.some((node) => def.edges.filter((edge) => edge.to.node === node.id).length !== 1))
    return [];
  if (def.edges.some((edge) => edge.from.node === quiet.id)) return [];
  return nodes;
}

function hasDownstreamCheck(def: LoopDefinitionInput, triggerId: string): boolean {
  const pending = [triggerId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (def.nodes.some((node) => node.id === id && node.kind === 'decision')) return true;
    pending.push(...def.edges.filter((edge) => edge.from.node === id).map((edge) => edge.to.node));
  }
  return false;
}

const ROW_STEP = NODE_CARD_SIZE.height + 2 * NODE_CARD_SIZE.clearance;
const COLUMN_STEP = NODE_CARD_SIZE.width + 4 * NODE_CARD_SIZE.clearance;

/** Use the editor's card geometry/clearance helpers; leave existing cards in place. */
function beside(def: LoopDefinitionInput, anchor: { x: number; y: number }) {
  const box = (id: string, x: number, y: number) => ({
    id,
    left: x,
    right: x + NODE_CARD_SIZE.width,
    top: y,
    bottom: y + NODE_CARD_SIZE.height,
  });
  let y = anchor.y;
  while (
    def.nodes.some((node) =>
      overlapsBox(
        expand(box(node.id, node.ui?.x ?? 0, node.ui?.y ?? 0), NODE_CARD_SIZE.clearance),
        box('', anchor.x, y),
      ),
    )
  )
    y += ROW_STEP;
  return { x: anchor.x, y };
}

export function previewGitHubPreset(
  source: LoopDefinitionInput,
  triggerId: string,
  preset: GitHubTriggerPreset,
  setup: GitHubTriggerSetup,
): GitHubPresetPreview {
  const trigger = source.nodes.find((node) => node.id === triggerId);
  if (trigger?.kind !== 'trigger') throw new Error('The selected trigger no longer exists.');
  const config = makeGitHubTriggerPreset(preset, setup);
  const removedNodes = earlierFragment(source, triggerId);
  const removedIds = new Set(removedNodes.map((node) => node.id));
  const removedEdges = source.edges.filter(
    (edge) =>
      removedIds.has(edge.to.node) ||
      (removedIds.has(edge.from.node) && edge.from.node !== removedNodes[1]?.id),
  );
  let definition: LoopDefinitionInput = {
    ...source,
    nodes: source.nodes
      .filter((node) => !removedIds.has(node.id))
      .map((node) =>
        node.id === triggerId && node.kind === 'trigger' ? { ...node, config } : node,
      ),
    edges: source.edges.filter((edge) => !removedEdges.includes(edge)),
  };
  const addedNodes: NodeInput[] = [];
  const addedEdges: LoopDefinitionInput['edges'] = [];
  const rewiredEdges: LoopDefinitionInput['edges'] = [];
  const rewireSuccessors = (from: string, to: string) => {
    definition = {
      ...definition,
      edges: definition.edges.map((edge) => {
        if (edge.from.node !== from) return edge;
        const rewired = { ...edge, from: { ...edge.from, node: to } };
        rewiredEdges.push(rewired);
        return rewired;
      }),
    };
  };
  if (preset !== 'issues-poll') {
    // Reserve against the original too: replacement never reuses a removed node's identity.
    const taken = new Set(source.nodes.map((node) => node.id));
    const add = (
      name: string,
      kind: NodeInput['kind'],
      nodeConfig: unknown,
      x: number,
      y: number,
    ) => {
      let id = name;
      let suffix = 2;
      while (taken.has(id)) id = `${name}-${suffix++}`;
      taken.add(id);
      const node = {
        id,
        kind,
        label: name,
        config: nodeConfig,
        ui: beside(definition, { x, y }),
      } as NodeInput;
      addedNodes.push(node);
      definition = { ...definition, nodes: [...definition.nodes, node] };
      return id;
    };
    const { x, y } = trigger.ui ?? { x: 0, y: 0 };
    const check = add(
      'event-check',
      'decision',
      {
        kind: 'expression',
        jsonata: githubEventCheck(preset, setup),
        routes: [
          { id: 'pass', label: 'Continue' },
          { id: 'ignore', label: 'Ignore' },
        ],
      },
      x + COLUMN_STEP,
      y,
    );
    const restore = add(
      'restore-output',
      'mutate',
      {
        operations: [
          {
            op: 'set',
            path: '/lastOutput',
            value: {
              kind: 'expression',
              jsonata: `$lookup(outputs, ${JSON.stringify(triggerId)})`,
            },
          },
        ],
      },
      x + 2 * COLUMN_STEP,
      y,
    );
    const quiet = add(
      'quiet-exit',
      'exit',
      {
        outcome: 'success',
        returns: 'none',
        destinations: [],
      },
      x + 2 * COLUMN_STEP,
      y + ROW_STEP,
    );
    rewireSuccessors(removedNodes[1]?.id ?? triggerId, restore);
    for (const [from, port, to] of [
      [triggerId, 'out', check],
      [check, 'pass', restore],
      [check, 'ignore', quiet],
    ] as const) {
      const edge = {
        id: nextEdgeId(definition),
        from: { node: from, port },
        to: { node: to, port: 'in' as const },
      };
      addedEdges.push(edge);
      definition = { ...definition, edges: [...definition.edges, edge] };
    }
  } else if (removedNodes[1]) rewireSuccessors(removedNodes[1].id, triggerId);
  const current = trigger.config as Record<string, unknown>;
  const issues = validateDraft(definition).issues;
  if (preset === 'issues-poll' && !removedNodes.length && hasDownstreamCheck(source, triggerId))
    issues.push({
      code: 'POLL_RETAINS_DOWNSTREAM_CHECK',
      severity: 'warning',
      nodeId: triggerId,
      message:
        "The trigger's existing downstream check stays in place and may ignore poll results. Review or edit it before applying.",
    });
  return {
    source,
    definition,
    triggerId,
    fields: [...new Set([...Object.keys(current), ...Object.keys(config)])].filter(
      (key) =>
        JSON.stringify(current[key]) !== JSON.stringify((config as Record<string, unknown>)[key]),
    ),
    removedNodes,
    addedNodes,
    removedEdges,
    addedEdges,
    rewiredEdges,
    issues,
  };
}
