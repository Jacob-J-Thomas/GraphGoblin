/**
 * Zod 4 schema introspection for the schema-driven form renderer. It reads `schema._zod.def`, the
 * structural definition Zod keeps on every schema, and reduces it to the handful of field shapes the
 * renderer knows. Refinements (`superRefine`, `refine`) are not introspected; they surface as
 * validation messages through the resolver instead.
 */
import { ExpressionSchema, JsonSchemaSchema, TemplateSchema } from '@graphgoblin/contracts';
import type { z } from 'zod';

export type Schema = z.ZodType;

interface Def {
  type: string;
  innerType?: Schema;
  defaultValue?: unknown;
  shape?: Record<string, Schema>;
  element?: Schema;
  keyType?: Schema;
  valueType?: Schema;
  options?: Schema[];
  discriminator?: string;
  entries?: Record<string, string | number>;
  values?: unknown[];
  in?: Schema;
  checks?: { _zod: { def: CheckDef } }[];
}

interface CheckDef {
  check: string;
  format?: string;
  value?: number;
  inclusive?: boolean;
  minimum?: number;
  maximum?: number;
}

export function defOf(schema: Schema): Def {
  return schema._zod.def;
}

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'readonly',
  'nonoptional',
  'catch',
  'default',
  'prefault',
]);

export interface Unwrapped {
  /** The schema under optional, default, prefault, and similar wrappers. */
  base: Schema;
  /** `undefined` is accepted: optional, or a default or prefault fills it in. */
  optional: boolean;
  /** The output default (`default`) or input default (`prefault`), when present. */
  defaultValue?: unknown;
  hasDefault: boolean;
}

export function unwrap(schema: Schema): Unwrapped {
  let current = schema;
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;
  for (;;) {
    const def = defOf(current);
    if (def.type === 'pipe' && def.in) {
      current = def.in;
      continue;
    }
    if (!WRAPPERS.has(def.type) || !def.innerType) break;
    if (def.type === 'optional' || def.type === 'nullable') optional = true;
    if ((def.type === 'default' || def.type === 'prefault') && !hasDefault) {
      hasDefault = true;
      optional = true;
      defaultValue = structuredClone(def.defaultValue);
    }
    current = def.innerType;
  }
  return { base: current, optional, hasDefault, ...(hasDefault ? { defaultValue } : {}) };
}

export type StringFormat = 'text' | 'template' | 'expression';

export type FieldShape =
  | { kind: 'string'; format: StringFormat; minLength?: number }
  | { kind: 'number'; integer: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: string[] }
  | { kind: 'literal'; value: unknown }
  | { kind: 'object'; shape: Record<string, Schema> }
  | { kind: 'array'; element: Schema; min?: number; max?: number }
  | { kind: 'record'; key: Schema; value: Schema }
  | { kind: 'union'; options: Schema[]; discriminator?: string }
  | { kind: 'json' };

function checks(def: Def): CheckDef[] {
  return (def.checks ?? []).map((c) => c._zod.def);
}

/** Reduce a (base) schema to the field shape the renderer draws. Unknown shapes become JSON. */
export function shapeOf(schema: Schema): FieldShape {
  const { base } = unwrap(schema);
  if (base === TemplateSchema) return { kind: 'string', format: 'template' };
  if (base === ExpressionSchema) return { kind: 'string', format: 'expression', minLength: 1 };
  if (base === JsonSchemaSchema) return { kind: 'json' };
  const def = defOf(base);
  switch (def.type) {
    case 'string': {
      const min = checks(def).find((c) => c.check === 'min_length')?.minimum;
      return { kind: 'string', format: 'text', ...(min !== undefined ? { minLength: min } : {}) };
    }
    case 'number': {
      let min: number | undefined;
      let max: number | undefined;
      let integer = false;
      for (const c of checks(def)) {
        if (c.check === 'number_format') integer = c.format === 'safeint' || c.format === 'int32';
        if (c.check === 'greater_than' && c.value !== undefined)
          min = c.inclusive ? c.value : c.value + (integer ? 1 : Number.EPSILON);
        if (c.check === 'less_than' && c.value !== undefined)
          max = c.inclusive ? c.value : c.value - (integer ? 1 : Number.EPSILON);
      }
      return {
        kind: 'number',
        integer,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'boolean':
      return { kind: 'boolean' };
    case 'enum':
      return { kind: 'enum', options: Object.values(def.entries ?? {}).map(String) };
    case 'literal': {
      const values = def.values ?? [];
      if (values.length === 1) return { kind: 'literal', value: values[0] };
      return { kind: 'enum', options: values.map(String) };
    }
    case 'object':
      return { kind: 'object', shape: def.shape ?? {} };
    case 'array': {
      let min: number | undefined;
      let max: number | undefined;
      for (const c of checks(def)) {
        if (c.check === 'min_length') min = c.minimum;
        if (c.check === 'max_length') max = c.maximum;
      }
      return {
        kind: 'array',
        element: def.element as Schema,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'record':
      return { kind: 'record', key: def.keyType as Schema, value: def.valueType as Schema };
    case 'union':
      return {
        kind: 'union',
        options: def.options ?? [],
        ...(def.discriminator ? { discriminator: def.discriminator } : {}),
      };
    default:
      return { kind: 'json' };
  }
}

/** A fresh value that satisfies the schema's shape as far as introspection allows. */
export function initialValue(schema: Schema): unknown {
  const unwrapped = unwrap(schema);
  if (unwrapped.hasDefault) return unwrapped.defaultValue;
  if (unwrapped.optional) return undefined;
  const shape = shapeOf(unwrapped.base);
  switch (shape.kind) {
    case 'string':
      return shape.format === 'expression' ? 'true' : '';
    case 'number':
      return shape.min !== undefined
        ? Math.max(shape.min, shape.integer ? 1 : 0)
        : shape.integer
          ? 1
          : 0;
    case 'boolean':
      return false;
    case 'enum':
      return shape.options[0];
    case 'literal':
      return shape.value;
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape.shape)) {
        const unwrappedField = unwrap(field);
        if (!unwrappedField.optional) out[key] = initialValue(field);
      }
      return out;
    }
    case 'array':
      return Array.from({ length: shape.min ?? 0 }, () => initialValue(shape.element));
    case 'record':
      return {};
    case 'union':
      return shape.options[0] ? initialValue(shape.options[0]) : null;
    case 'json':
      return null;
  }
}

/** The discriminator value a discriminated-union option carries. */
export function discriminatorValue(option: Schema, discriminator: string): string {
  const shape = shapeOf(option);
  if (shape.kind !== 'object') return '';
  const field = shape.shape[discriminator];
  if (!field) return '';
  const fieldShape = shapeOf(field);
  return fieldShape.kind === 'literal' ? String(fieldShape.value) : '';
}

/** A short label for a union option, used in the variant picker. */
export function optionLabel(option: Schema, discriminator?: string): string {
  if (discriminator) return discriminatorValue(option, discriminator);
  const shape = shapeOf(option);
  switch (shape.kind) {
    case 'literal':
      return String(shape.value);
    case 'string':
      return shape.format === 'text' ? 'text' : shape.format;
    case 'object':
      return Object.keys(shape.shape).join(', ') || 'object';
    default:
      return shape.kind;
  }
}

/** Which option of a union the current value belongs to. Defaults to the first. */
export function matchOption(options: Schema[], value: unknown, discriminator?: string): number {
  if (discriminator) {
    const tag =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[discriminator]
        : undefined;
    const index = options.findIndex((o) => discriminatorValue(o, discriminator) === tag);
    return Math.max(index, 0);
  }
  const exact = options.findIndex((o) => o.safeParse(value).success);
  if (exact >= 0) return exact;
  // Loose match by JavaScript type, so a half-typed value keeps its variant.
  const loose = options.findIndex((o) => {
    const shape = shapeOf(o);
    if (shape.kind === 'literal') return false;
    if (shape.kind === 'object') return typeof value === 'object' && value !== null;
    if (shape.kind === 'number') return typeof value === 'number';
    return shape.kind === 'string' && typeof value === 'string';
  });
  return Math.max(loose, 0);
}

/** "maxIterations" to "Max iterations". */
export function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
