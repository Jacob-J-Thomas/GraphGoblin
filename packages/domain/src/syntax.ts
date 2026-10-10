/**
 * Authoring-time syntax checks for every Liquid template and JSONata expression in a loop. The
 * schemas in `contracts` mark those strings by reusing `TemplateSchema` and `ExpressionSchema`, so
 * walking a node's config alongside its kind's schema finds them all, wherever they are nested. A
 * field may carry its own metadata (`.meta()`, a copy with the same definition), so the walk
 * recognises them with `sameSchema` rather than `===`.
 */
import {
  ExpressionSchema,
  LoopSettingsSchema,
  NodeConfigSchemas,
  TemplateSchema,
  sameSchema,
  type NodeKind,
} from '@graphgoblin/contracts';
import { checkExpression } from './expression.js';
import { checkTemplate } from './template.js';

/** Same shape as `ValidationIssue` in graph.ts, declared here so graph.ts can import this module. */
interface SyntaxIssue {
  code: 'TEMPLATE_INVALID' | 'EXPRESSION_INVALID';
  severity: 'error';
  message: string;
  nodeId?: string;
  /** The field: `config.<path>` in the node, or `settings.<path>` in the loop's settings. */
  path: string;
}

/** The slice of a Zod 4 schema this walker reads. */
interface SchemaLike {
  _zod: { def: Record<string, unknown> & { type: string } };
  safeParse(value: unknown): { success: boolean };
}

type Found = { kind: 'template' | 'expression'; source: string; path: string };
interface SourceSchemas {
  template: unknown;
  expression: unknown;
}
const currentSources = { template: TemplateSchema, expression: ExpressionSchema };

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
]);

function walk(
  schema: SchemaLike,
  value: unknown,
  path: string,
  found: Found[],
  markers: SourceSchemas,
): void {
  if (value === undefined || value === null) return;
  const template = sameSchema(schema, markers.template as SchemaLike);
  if (template || sameSchema(schema, markers.expression as SchemaLike)) {
    if (typeof value === 'string') {
      const kind = template ? 'template' : 'expression';
      found.push({ kind, source: value, path });
    }
    return;
  }
  const def = schema._zod.def;
  if (WRAPPERS.has(def.type)) {
    walk(def['innerType'] as SchemaLike, value, path, found, markers);
  } else if (def.type === 'object' && typeof value === 'object') {
    const shape = def['shape'] as Record<string, SchemaLike>;
    for (const [key, child] of Object.entries(shape)) {
      walk(
        child,
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        found,
        markers,
      );
    }
  } else if (def.type === 'array' && Array.isArray(value)) {
    value.forEach((item, index) =>
      walk(def['element'] as SchemaLike, item, `${path}.${index}`, found, markers),
    );
  } else if (def.type === 'record' && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walk(def['valueType'] as SchemaLike, item, `${path}.${key}`, found, markers);
    }
  } else if (def.type === 'union') {
    const option = (def['options'] as SchemaLike[]).find((o) => o.safeParse(value).success);
    if (option) walk(option, value, path, found, markers);
  }
}

/** Every template and expression in `value` as described by `schema`, with its dotted path. */
export function findAuthoredSources(
  schema: unknown,
  value: unknown,
  markers: SourceSchemas = currentSources,
): Found[] {
  const found: Found[] = [];
  walk(schema as SchemaLike, value, '', found, markers);
  return found;
}

/**
 * One error per template that does not parse and per expression that does not compile. Runs would
 * otherwise fail on them only when the node executes.
 */
export function syntaxIssues(
  def: { settings: unknown; nodes: readonly { id: string; kind: NodeKind; config: unknown }[] },
  schemas: SourceSchemas & { settings: unknown; nodes: Record<NodeKind, unknown> } = {
    ...currentSources,
    settings: LoopSettingsSchema,
    nodes: NodeConfigSchemas,
  },
): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  const report = (item: Found, nodeId?: string) => {
    const problem =
      item.kind === 'expression' && item.source.trim() === ''
        ? 'expression is required; a blank expression is not valid'
        : item.kind === 'template'
          ? checkTemplate(item.source)
          : checkExpression(item.source);
    if (problem === null) return;
    const where = nodeId ? `node "${nodeId}"` : 'loop settings';
    issues.push({
      code: item.kind === 'template' ? 'TEMPLATE_INVALID' : 'EXPRESSION_INVALID',
      severity: 'error',
      message: `${item.kind} at ${where} ${item.path}: ${problem}`,
      ...(nodeId ? { nodeId } : {}),
      path: [nodeId ? 'config' : 'settings', item.path].filter(Boolean).join('.'),
    });
  };
  for (const item of findAuthoredSources(schemas.settings, def.settings, schemas)) report(item);
  for (const node of def.nodes) {
    for (const item of findAuthoredSources(schemas.nodes[node.kind], node.config, schemas)) {
      report(item, node.id);
    }
  }
  return issues;
}
