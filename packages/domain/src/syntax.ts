/**
 * Locate typed authored sources without parsing or materializing defaults in the draft.
 * Metadata copies retain their marker's identity through sameSchema. The diagnostics for sources
 * that do not parse come from graph validation (`authoredSourceIssues` in node-references.ts),
 * which walks with authoredFields and renders each through syntaxIssue.
 */
import {
  ExpressionSchema,
  JsonPointerSchema,
  TemplateSchema,
  sameSchema,
} from '@graphgoblin/contracts';
import type { SourceKind } from './source-analysis.js';

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

/** Render graph validation's diagnostic for a template or expression that does not parse. */
export function syntaxIssue(
  { kind, path }: Pick<Found, 'kind' | 'path'>,
  problem: string,
  nodeId?: string,
): SyntaxIssue {
  const where = nodeId ? 'node "' + nodeId + '"' : 'loop settings';
  return {
    code: kind === 'template' ? 'TEMPLATE_INVALID' : 'EXPRESSION_INVALID',
    severity: 'error',
    message: kind + ' at ' + where + ' ' + path + ': ' + problem,
    ...(nodeId ? { nodeId } : {}),
    path: [nodeId ? 'config' : 'settings', path].filter(Boolean).join('.'),
  };
}
