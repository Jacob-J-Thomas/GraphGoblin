import {
  JsonPointerSchema,
  LoopSettingsSchema,
  NodeConfigSchemas,
  SlugSchema,
  type LoopDefinitionInput,
  type NodeKind,
} from '@graphgoblin/contracts';
import {
  nodeMap,
  spellReference,
  type NodeMap,
  type ReferenceScope,
  type ReferenceSite,
  type SourceReferences,
} from './node-reference-path.js';
import { formatPointer, parsePointer, updateAtPointer } from './pointer.js';
import { sourceAnalysis } from './source-analysis.js';
import { authoredFields, syntaxIssue } from './syntax.js';
import type { ValidationIssue } from './validation-issue.js';

type NodeInput = LoopDefinitionInput['nodes'][number];
type DefinitionIndex = {
  nodes: ReadonlyMap<string, NodeInput>;
  customOutputs: ReadonlySet<string>;
};
type AuthoredField = ReturnType<typeof authoredFields>[number];
type Location = Pick<ValidationIssue, 'nodeId' | 'path'>;
type Field = AuthoredField & { scope?: ReferenceScope; location: Location; nodeIndex?: number };

export type NodeRenameResult =
  | { kind: 'unchanged' | 'missing-node' | 'ambiguous-node' | 'invalid-id' | 'duplicate-id' }
  | {
      kind: 'renamed';
      definition: LoopDefinitionInput;
      repairedReferences: number;
      warnings: ValidationIssue[];
    };

function referenceScope(kind: NodeKind, segments: string[]): ReferenceScope | undefined {
  const [first, second] = segments;
  const last = segments.at(-1);
  if (kind === 'trigger') return undefined; // Payload/probe view before a run exists.
  if (kind === 'wait' && first === 'filter') return 'binding';
  if (kind === 'heartbeat' && first === 'until') return 'heartbeat';
  if (kind === 'subloop') {
    if (first === 'output') return second === 'custom' ? 'parent' : undefined;
    if (second === 'messages' || second === 'artifacts') return 'binding';
  }
  if (
    last === 'where' &&
    (first === 'operations' || first === 'input' || (first === 'output' && second === 'transforms'))
  )
    return 'binding';
  return 'thread';
}

function fields(definition: LoopDefinitionInput): Field[] {
  const result: Field[] = authoredFields(LoopSettingsSchema, definition.settings).map((field) => ({
    ...field,
    scope: 'thread',
    location: { path: ['settings', ...field.segments].join('.') },
  }));
  definition.nodes.forEach((node, nodeIndex) => {
    for (const field of authoredFields(NodeConfigSchemas[node.kind], node.config)) {
      const scope = referenceScope(node.kind, field.segments);
      result.push({
        ...field,
        ...(scope ? { scope } : {}),
        location: { nodeId: node.id, path: ['config', ...field.segments].join('.') },
        nodeIndex,
      });
    }
  });
  return result;
}

function pointerReferences(field: Field): SourceReferences {
  const result: SourceReferences = { sites: [], uncertain: false };
  if (!JsonPointerSchema.safeParse(field.source).success) return result;
  const map = nodeMap(parsePointer(field.source), 0);
  if (!map) return result;
  // Gates and visits are protected. Their only typed mutation pointer is Coerce's read source.
  if (map.map !== 'outputs' && field.segments.at(-1) !== 'source') return result;
  const tokens = field.source.split('/');
  const keyIndex = map.keyIndex + 1;
  const raw = tokens[keyIndex];
  if (!raw) return result;
  const parsed = SlugSchema.safeParse(raw);
  if (!parsed.success) return result;
  const start = tokens.slice(0, keyIndex).join('/').length + 1;
  result.sites.push({
    id: parsed.data,
    map: map.map,
    optional: false,
    span: { start, end: start + raw.length, spelling: 'bare' },
  });
  return result;
}

/** Static root/whole-entry writes may define independently named output data. */
function authoredOutputKeys(sources: Field[]): Set<string> {
  const keys = new Set<string>();
  for (const field of sources) {
    if (!field.scope || field.kind !== 'pointer' || field.segments.at(-1) === 'source') continue;
    const match = /^\/outputs(?:\/([A-Za-z][A-Za-z0-9_-]{0,63}))?$/.exec(field.source);
    if (match) keys.add(match[1] ?? '');
  }
  return keys;
}

function canProduceGate(node: NodeInput | undefined): boolean {
  return node?.kind === 'decision' && node.config.maxPasses !== undefined;
}

function canProduceOutput(node: NodeInput | undefined): boolean {
  switch (node?.kind) {
    case 'trigger':
    case 'decision':
    case 'inference':
    case 'wait':
    case 'heartbeat':
      return true;
    case 'script':
      return node.config.stdout === undefined || node.config.stdout === 'last-output';
    case 'subloop':
      return (
        node.config.output?.mode !== 'custom' && node.config.output?.resultTo?.lastOutput !== false
      );
    default:
      return false;
  }
}

function mapEntryMayExist(index: DefinitionIndex, map: NodeMap, id: string): boolean {
  const node = index.nodes.get(id);
  if (map === 'gates') return canProduceGate(node);
  if (map === 'outputs') return canProduceOutput(node) || index.customOutputs.has(id);
  return node !== undefined;
}

function uncertainty(location: Location, message: string): ValidationIssue {
  return { ...location, severity: 'warning', code: 'NODE_REFERENCE_UNCERTAIN', message };
}

export function authoredSourceIssues(definition: LoopDefinitionInput): ValidationIssue[] {
  const sourceFields = fields(definition);
  const index: DefinitionIndex = {
    nodes: new Map(definition.nodes.map((node) => [node.id, node])),
    customOutputs: authoredOutputKeys(sourceFields),
  };
  const syntax: ValidationIssue[] = [];
  const issues: ValidationIssue[] = [];
  for (const field of sourceFields) {
    const { kind, source, scope } = field;
    if (kind === 'pointer' && !scope) continue;
    const analyzed =
      kind === 'pointer' ? pointerReferences(field) : sourceAnalysis(kind, source, scope);
    if (kind !== 'pointer' && 'problem' in analyzed && typeof analyzed.problem === 'string') {
      syntax.push(
        syntaxIssue(
          { kind, path: field.segments.join('.') },
          analyzed.problem,
          field.location.nodeId,
        ),
      );
      continue;
    }
    if (!scope) continue;
    const { sites, uncertain } = analyzed;
    const seen = new Map<string, ValidationIssue>();
    for (const { id, map, optional } of sites) {
      if (mapEntryMayExist(index, map, id)) continue;
      if (field.kind === 'pointer' && field.segments.at(-1) !== 'source' && map === 'outputs')
        continue;
      const name = map + '.' + id;
      const warning = map === 'outputs' || optional;
      if (seen.get(name)?.severity === 'error') continue;
      seen.set(name, {
        ...field.location,
        severity: warning ? 'warning' : 'error',
        code:
          map === 'outputs'
            ? 'NODE_REFERENCE_OUTPUT_UNVERIFIED'
            : optional
              ? 'NODE_REFERENCE_OPTIONAL_MISSING'
              : 'NODE_REFERENCE_MISSING',
        message:
          map === 'outputs'
            ? 'The origin of ' +
              name +
              ' is unverified. It may be inherited or supplied by an authored patch.'
            : 'No ' + (map === 'gates' ? 'decision gate' : 'node') + ' defines ' + name + '.',
      });
    }
    issues.push(...seen.values());
    if (uncertain)
      issues.push(
        uncertainty(
          field.location,
          'A dynamic or scoped expression may use a node ID. Review the reference manually.',
        ),
      );
  }
  return [...syntax, ...issues];
}

function rewrite(field: Field, sites: ReferenceSite[], nextId: string): string | undefined {
  let text = field.source;
  let boundary = text.length;
  const spans = new Map(sites.map(({ span }) => [span.start, span]));
  for (const { start, end, spelling } of [...spans.values()].sort((a, b) => b.start - a.start)) {
    if (end > boundary) return undefined;
    text = text.slice(0, start) + spellReference(nextId, spelling) + text.slice(end);
    boundary = start;
  }
  if (field.kind !== 'pointer' && sourceAnalysis(field.kind, text, field.scope).problem !== null)
    return undefined;
  return text;
}

function fieldPath(field: Field): string[] {
  return field.nodeIndex === undefined
    ? ['settings', ...field.segments]
    : ['nodes', String(field.nodeIndex), 'config', ...field.segments];
}

/** Rename one node and its understood references without mutating or reparsing the draft. */
export function renameLoopNode(
  definition: LoopDefinitionInput,
  oldId: string,
  nextId: string,
): NodeRenameResult {
  const matches = definition.nodes.filter((node) => node.id === oldId);
  if (matches.length === 0) return { kind: 'missing-node' };
  if (matches.length !== 1) return { kind: 'ambiguous-node' };
  if (oldId === nextId) return { kind: 'unchanged' };
  if (!SlugSchema.safeParse(nextId).success) return { kind: 'invalid-id' };
  if (definition.nodes.some((node) => node.id === nextId)) return { kind: 'duplicate-id' };

  const sourceFields = fields(definition);
  const customKeys = authoredOutputKeys(sourceFields);
  const outputMayBeCustom = customKeys.has('') || customKeys.has(oldId) || customKeys.has(nextId);
  let repairedReferences = 0;
  let updated = definition;
  const warnings: ValidationIssue[] = [];
  for (const field of sourceFields) {
    if (!field.scope) continue;
    const { sites, uncertain } =
      field.kind === 'pointer'
        ? pointerReferences(field)
        : sourceAnalysis(field.kind, field.source, field.scope);
    const matching = sites.filter((site) => site.id === oldId);
    const patchable = matching.filter(
      ({ map }) => map !== 'outputs' || (canProduceOutput(matches[0]) && !outputMayBeCustom),
    );
    const location =
      field.location.nodeId === oldId ? { ...field.location, nodeId: nextId } : field.location;
    if (uncertain || matching.length > patchable.length)
      warnings.push(
        uncertainty(
          location,
          'This field may depend on a dynamic, inherited, or authored node ID. Review it after renaming.',
        ),
      );
    if (patchable.length === 0) continue;
    const text = rewrite(field, patchable, nextId);
    if (text === undefined) {
      warnings.push(
        uncertainty(location, 'Could not verify the edited source. Review it after renaming.'),
      );
      continue;
    }
    updated = updateAtPointer(
      updated,
      formatPointer(fieldPath(field)),
      'replace',
      text,
    ) as LoopDefinitionInput;
    repairedReferences += new Set(patchable.map(({ span }) => span.start)).size;
  }
  const nodes = updated.nodes.map((node) => (node.id === oldId ? { ...node, id: nextId } : node));
  const edges = updated.edges.map((edge) => {
    const from = edge.from.node === oldId;
    const to = edge.to.node === oldId;
    repairedReferences += Number(from) + Number(to);
    return from || to
      ? {
          ...edge,
          from: from ? { ...edge.from, node: nextId } : edge.from,
          to: to ? { ...edge.to, node: nextId } : edge.to,
        }
      : edge;
  });
  if (
    nodes.some(
      (node) =>
        node.kind === 'script' && (node.config.stdin !== 'none' || node.config.stdout === 'patch'),
    ) ||
    nodes.some((node) => node.kind === 'subloop' && node.config.output?.mode === 'custom')
  ) {
    warnings.push(
      uncertainty({}, 'Check scripts and generated patches for references to the old ID.'),
    );
  }
  return {
    kind: 'renamed',
    definition: { ...updated, nodes, edges },
    repairedReferences,
    warnings,
  };
}
