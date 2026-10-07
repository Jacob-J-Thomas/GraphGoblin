/**
 * Pure editor model: node defaults, ports, connection rules, and live validation. The editor holds
 * the draft as `LoopDefinitionInput` (what the user typed, defaults not yet applied) and validates
 * it with the same `contracts` schemas and `domain` rules the API runs on publish.
 */
import {
  LoopDefinitionSchema,
  NodeSchema,
  type LoopDefinitionInput,
  type NodeInput,
  type NodeKind,
} from '@graphgoblin/contracts';
import { outputPorts, validateLoop, type ValidationIssue } from '@graphgoblin/domain';

/** The drag-and-drop data type that carries a node kind from the palette to the canvas. */
export const KIND_MIME = 'application/x-graphgoblin-kind';

export const NODE_KINDS: readonly NodeKind[] = [
  'trigger',
  'decision',
  'inference',
  'script',
  'mutate',
  'subloop',
  'wait',
  'heartbeat',
  'exit',
];

/** The design token that colours a node kind (`--kind-trigger` and `--kind-trigger-subtle`). */
export type KindToken = `kind-${NodeKind}`;

/**
 * Each kind's name, palette description, and colour token. The colour is a token name, never a
 * palette class: editor/KindChip.tsx turns it into the `--k` variables the kind utilities read.
 */
export const KIND_INFO: Record<NodeKind, { label: string; description: string; color: KindToken }> =
  {
    trigger: { label: 'Trigger', description: 'Starts a run', color: 'kind-trigger' },
    decision: {
      label: 'Decision',
      description: 'Chooses a labelled route',
      color: 'kind-decision',
    },
    inference: {
      label: 'Inference',
      description: 'Hands work to a harness',
      color: 'kind-inference',
    },
    script: { label: 'Script', description: 'Runs a program', color: 'kind-script' },
    mutate: { label: 'Mutate', description: 'Changes the context thread', color: 'kind-mutate' },
    subloop: { label: 'Subloop', description: 'Runs another loop', color: 'kind-subloop' },
    wait: {
      label: 'Wait',
      description: 'Parks until input, time, or a signal',
      color: 'kind-wait',
    },
    heartbeat: { label: 'Heartbeat', description: 'Polls on an interval', color: 'kind-heartbeat' },
    exit: { label: 'Exit', description: 'Finishes or loops back', color: 'kind-exit' },
  };

/** A small, mostly valid starting config for each kind. */
export function defaultConfig(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'trigger':
      return { subtype: 'manual' };
    case 'decision':
      return {
        answer: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Yes', criteria: 'The answer is yes' },
            { id: 'no', label: 'No', criteria: 'The answer is no' },
          ],
        },
        evaluation: { kind: 'expression', jsonata: '"yes"' },
        recordAlternatives: true,
      };
    case 'inference':
      return { prompt: { template: 'Summarise: {{ lastMessage.content }}' } };
    case 'script':
      return { command: 'node', args: ['script.js'] };
    case 'mutate':
      return { operations: [{ op: 'append-message', role: 'note', content: 'Note' }] };
    case 'subloop':
      return { loopRef: { loopId: '' } };
    case 'wait':
      return { mode: 'input', prompt: 'Approve?' };
    case 'heartbeat':
      return { intervalSeconds: 60, maxBeats: 3 };
    case 'exit':
      return {};
  }
}

/** The next free id for a node of a kind: `decision`, `decision-2`, ... */
export function nextNodeId(def: LoopDefinitionInput, kind: NodeKind): string {
  const taken = new Set(def.nodes.map((n) => n.id));
  if (!taken.has(kind)) return kind;
  let n = 2;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

export function nextEdgeId(def: LoopDefinitionInput): string {
  const taken = new Set(def.edges.map((e) => e.id));
  let n = def.edges.length + 1;
  while (taken.has(`e${n}`)) n += 1;
  return `e${n}`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Output ports of a node. Uses `domain`'s `outputPorts` when the node parses; otherwise derives
 * them from the raw config so a half-edited node keeps its handles on the canvas.
 */
export function portsOf(node: NodeInput): string[] {
  const parsed = NodeSchema.safeParse(node);
  if (parsed.success) return outputPorts(parsed.data);
  const config = record(node.config);
  switch (node.kind) {
    case 'decision': {
      const answer = record(config['answer']);
      const options = Array.isArray(answer['options']) ? (answer['options'] as unknown[]) : [];
      return options
        .map((option) => record(option)['id'])
        .filter((id): id is string => typeof id === 'string' && id !== '');
    }
    case 'script': {
      const labels = Object.values(record(config['exitCodeRoutes'])).filter(
        (label): label is string => typeof label === 'string' && label !== '' && label !== 'out',
      );
      return ['out', ...new Set(labels)];
    }
    case 'exit':
      return config['loopBack'] ? ['loopBack'] : [];
    default:
      return ['out'];
  }
}

/** Ports drawn on the canvas: the node's ports, plus the optional `loopBack` port on exits. */
export function canvasPorts(node: NodeInput): string[] {
  const ports = portsOf(node);
  return node.kind === 'exit' && !ports.includes('loopBack') ? [...ports, 'loopBack'] : ports;
}

/** Display labels for the handles; decision IDs remain the actual connection ports. */
export function canvasPortLabels(node: NodeInput): Readonly<Record<string, string>> {
  if (node.kind !== 'decision') return {};
  const options = record(record(node.config).answer)['options'];
  if (!Array.isArray(options)) return {};
  return Object.fromEntries(
    options.flatMap((option) => {
      const row = record(option);
      return typeof row['id'] === 'string' && typeof row['label'] === 'string'
        ? [[row['id'], row['label']]]
        : [];
    }),
  );
}

export interface ConnectionRequest {
  source: string;
  sourceHandle: string | null;
  target: string;
}

/** Why a connection is refused, or null when it is allowed. */
export function connectionProblem(
  def: LoopDefinitionInput,
  conn: ConnectionRequest,
): string | null {
  const from = def.nodes.find((n) => n.id === conn.source);
  const to = def.nodes.find((n) => n.id === conn.target);
  if (!from || !to) return 'unknown node';
  if (to.kind === 'trigger') return 'triggers have no input';
  const port = conn.sourceHandle ?? 'out';
  if (!canvasPorts(from).includes(port)) return `"${from.id}" has no output port "${port}"`;
  if (def.edges.some((e) => e.from.node === from.id && e.from.port === port)) {
    return `port "${port}" of "${from.id}" is already connected`;
  }
  return null;
}

export type EditorIssue = ValidationIssue & {
  path?: string;
  /** For FIELD_INPUT_INVALID: where held input is kept, and its control's discard noun. */
  discard?: { scope: string; path: string; input?: 'unparsed text' | 'incomplete schedule' };
};

/** Schema issues first (they block saving), then the structural rules from `domain`. */
export function validateDraft(def: LoopDefinitionInput): {
  issues: EditorIssue[];
  schemaValid: boolean;
} {
  const parsed = LoopDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue): EditorIssue => {
      const [first, index, ...rest] = issue.path;
      const node = first === 'nodes' && typeof index === 'number' ? def.nodes[index] : undefined;
      const edge = first === 'edges' && typeof index === 'number' ? def.edges[index] : undefined;
      return {
        code: 'SCHEMA',
        severity: 'error',
        message: issue.message,
        path: (node || edge ? rest : issue.path).map(String).join('.'),
        ...(node ? { nodeId: node.id } : {}),
        ...(edge ? { edgeId: edge.id } : {}),
      };
    });
    return { issues, schemaValid: false };
  }
  return { issues: validateLoop(parsed.data), schemaValid: true };
}

/** Identity of an issue for de-duplication. */
export function issueKey(issue: EditorIssue): string {
  return `${issue.code}|${issue.nodeId ?? ''}|${issue.message}`;
}

/** Held input that is not a valid value yet, as blocking issues. */
export function fieldErrorIssues(
  fieldErrors: Record<
    string,
    Record<string, { message: string; input?: 'unparsed text' | 'incomplete schedule' }>
  >,
): EditorIssue[] {
  return Object.entries(fieldErrors).flatMap(([scope, errors]) =>
    Object.entries(errors).map(([path, { message, input }]): EditorIssue => {
      const nodeId = scope.startsWith('node:') ? scope.slice('node:'.length) : undefined;
      return {
        code: 'FIELD_INPUT_INVALID',
        severity: 'error',
        message: `This field holds input that is not a valid value yet. ${message}`,
        path: nodeId ? `config.${path}` : `${scope}.${path}`,
        ...(nodeId ? { nodeId } : {}),
        discard: { scope, path, ...(input ? { input } : {}) },
      };
    }),
  );
}

/**
 * Local issues plus the server's (from `POST /loops/{id}/validate`), which add the checks only the
 * API can run, such as cron syntax and subloop references. Issues already found locally are not
 * repeated; server issues are ignored while the draft does not parse, because they describe an
 * older revision.
 */
export function mergeIssues(
  local: { issues: EditorIssue[]; schemaValid: boolean },
  server: readonly EditorIssue[] | undefined,
  fields: readonly EditorIssue[] = [],
): EditorIssue[] {
  const seen = new Set(local.issues.map(issueKey));
  const extra = local.schemaValid ? (server ?? []).filter((i) => !seen.has(issueKey(i))) : [];
  return [...fields, ...local.issues, ...extra];
}

/** How many errors and warnings a list holds. */
export function issueCounts(issues: readonly EditorIssue[]): { errors: number; warnings: number } {
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { errors, warnings: issues.length - errors };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "1 issue", "3 issues". */
export function issuesLabel(count: number): string {
  return plural(count, 'issue');
}

/** "2 errors, 1 warning", "1 error", or "3 warnings": the parts that are not zero. */
export function countsLabel(issues: readonly EditorIssue[]): string {
  const { errors, warnings } = issueCounts(issues);
  const parts = [
    errors > 0 ? plural(errors, 'error') : '',
    warnings > 0 ? plural(warnings, 'warning') : '',
  ];
  return parts.filter(Boolean).join(', ');
}

/** The issues about each node, by node id, in list order. */
export function issuesByNode(issues: readonly EditorIssue[]): Map<string, EditorIssue[]> {
  const byNode = new Map<string, EditorIssue[]>();
  for (const issue of issues) {
    if (issue.nodeId === undefined) continue;
    const list = byNode.get(issue.nodeId);
    if (list) list.push(issue);
    else byNode.set(issue.nodeId, [issue]);
  }
  return byNode;
}

/**
 * The issues as the editor shows them: those about a node of the definition (its card's badge
 * lists them), per node in the definition's order, and the rest in list order: loop-level issues,
 * edge issues, and issues about a node that is no longer there (a server check of an older
 * revision, say). Every issue is in exactly one place, so the counts always add up.
 */
export function groupIssues(
  issues: readonly EditorIssue[],
  definition: LoopDefinitionInput,
): { general: EditorIssue[]; nodes: { nodeId: string; issues: EditorIssue[] }[] } {
  const byNode = issuesByNode(issues);
  const ids = [...new Set(definition.nodes.map((n) => n.id))];
  const nodes = ids.flatMap((nodeId) => {
    const list = byNode.get(nodeId);
    return list ? [{ nodeId, issues: list }] : [];
  });
  const present = new Set(ids);
  const general = issues.filter((i) => i.nodeId === undefined || !present.has(i.nodeId));
  return { general, nodes };
}

/** Whether two issue lists say the same thing, so a node card showing one need not re-render. */
export function sameIssues(a: readonly EditorIssue[], b: readonly EditorIssue[]): boolean {
  return (
    a.length === b.length &&
    a.every((issue, index) => {
      const other = b[index]!;
      return (
        issueKey(issue) === issueKey(other) &&
        issue.severity === other.severity &&
        issue.edgeId === other.edgeId &&
        issue.path === other.path &&
        issue.discard?.scope === other.discard?.scope &&
        issue.discard?.path === other.discard?.path &&
        issue.discard?.input === other.discard?.input
      );
    })
  );
}

/** A new loop: a manual trigger wired to an exit. */
export function newLoopDefinition(name: string): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 320, y: 80 } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}
