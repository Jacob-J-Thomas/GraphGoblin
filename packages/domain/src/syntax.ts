/**
 * Locate typed authored sources without parsing or materializing defaults in the draft.
 * Metadata copies retain their marker's identity through sameSchema.
 */
import {
  ExpressionSchema,
  JsonPointerSchema,
  LoopSettingsSchema,
  NodeConfigSchemas,
  TemplateSchema,
  sameSchema,
  type NodeKind,
} from '@graphgoblin/contracts';
import { checkExpression } from './expression.js';
import { checkTemplate } from './template.js';

interface SyntaxIssue {
  code: 'TEMPLATE_INVALID' | 'EXPRESSION_INVALID';
  severity: 'error';
  message: string;
  nodeId?: string;
  /** The field: config.<path> in the node, or settings.<path> in the loop's settings. */
  path: string;
}

/** The slice of a Zod 4 schema this walker reads. */
interface SchemaLike {
  _zod: { def: Record<string, unknown> & { type: string } };
  safeParse(value: unknown): { success: boolean };
}

type SourceKind = 'template' | 'expression';
type Found = { kind: SourceKind; source: string; path: string };
type AuthoredField = { kind: SourceKind | 'pointer'; source: string; segments: string[] };
interface SourceSchemas {
  template: unknown;
  expression: unknown;
  pointer?: unknown;
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
  segments: string[],
  found: AuthoredField[],
  markers: SourceSchemas,
): void {
  if (value === undefined || value === null) return;
  const kind = sameSchema(schema, markers.template as SchemaLike)
    ? 'template'
    : sameSchema(schema, markers.expression as SchemaLike)
      ? 'expression'
      : markers.pointer && sameSchema(schema, markers.pointer as SchemaLike)
        ? 'pointer'
        : undefined;
  if (kind) {
    if (typeof value === 'string') found.push({ kind, source: value, segments });
    return;
  }
  const def = schema._zod.def;
  if (WRAPPERS.has(def.type)) {
    walk(def['innerType'] as SchemaLike, value, segments, found, markers);
  } else if (def.type === 'object' && typeof value === 'object') {
    const shape = def['shape'] as Record<string, SchemaLike>;
    for (const [key, child] of Object.entries(shape)) {
      walk(child, (value as Record<string, unknown>)[key], [...segments, key], found, markers);
    }
  } else if (def.type === 'array' && Array.isArray(value)) {
    value.forEach((item, index) =>
      walk(def['element'] as SchemaLike, item, [...segments, String(index)], found, markers),
    );
  } else if (def.type === 'record' && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walk(def['valueType'] as SchemaLike, item, [...segments, key], found, markers);
    }
  } else if (def.type === 'union') {
    const options = def['options'] as SchemaLike[];
    const discriminator = def['discriminator'];
    let option: SchemaLike | undefined;
    if (markers.pointer && typeof discriminator === 'string' && typeof value === 'object') {
      // The rename works on editor input, where another field in a discriminated
      // branch may be temporarily invalid. Its literal discriminator still selects
      // one unambiguous branch without materializing defaults or hiding typed sources.
      const discriminant = (value as Record<string, unknown>)[discriminator];
      option = options.find((candidate) => {
        const shape = candidate._zod.def['shape'] as Record<string, SchemaLike> | undefined;
        return shape?.[discriminator]?.safeParse(discriminant).success === true;
      });
    } else {
      option = options.find((candidate) => candidate.safeParse(value).success);
    }
    if (option) walk(option, value, segments, found, markers);
  }
}

/** Every template and expression in value as described by schema, with its dotted path. */
export function findAuthoredSources(
  schema: unknown,
  value: unknown,
  markers: SourceSchemas = currentSources,
): Found[] {
  return authoredFields(schema, value, markers).flatMap(({ kind, source, segments }) =>
    kind === 'pointer' ? [] : [{ kind, source, path: segments.join('.') }],
  );
}

/** Exact field segments for references, so arbitrary record keys never become dotted paths. */
export function authoredFields(
  schema: unknown,
  value: unknown,
  markers: SourceSchemas = { ...currentSources, pointer: JsonPointerSchema },
): AuthoredField[] {
  const found: AuthoredField[] = [];
  walk(schema as SchemaLike, value, [], found, markers);
  return found;
}

/** One error per template that does not parse and per expression that does not compile. */
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
    const where = nodeId ? 'node "' + nodeId + '"' : 'loop settings';
    issues.push({
      code: item.kind === 'template' ? 'TEMPLATE_INVALID' : 'EXPRESSION_INVALID',
      severity: 'error',
      message: item.kind + ' at ' + where + ' ' + item.path + ': ' + problem,
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
