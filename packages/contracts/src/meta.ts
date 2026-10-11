import { z } from 'zod';

/**
 * What a config field says about itself beyond its type. Defined once, here, as Zod registry
 * metadata (`.meta(field(...))`), and read through `fieldMeta` by the editor's forms and by the
 * generated node reference (`docs/reference/nodes.md`); `z.toJSONSchema` emits it too.
 *
 * Metadata never changes parsing: `.meta()` returns a copy of the schema with the same definition
 * (`_zod.def`), so a value parses exactly as before. Code that recognises a shared schema by
 * identity (a Liquid template, a JSONata expression) compares with `sameSchema`, which sees through
 * the copy.
 */
export type FieldMeta = {
  /** What the field is for: help under it in the forms, its description in the reference. */
  description?: string;
  /** The form's label, when the field's humanized key would not say it ("Input mode"). */
  title?: string;
  /**
   * Shown under the form's collapsed Advanced disclosure rather than with the basic fields. On the
   * fields of an object that is always present (it has a default), it splits the object: its basic
   * fields join the basic ones and its advanced fields go under Advanced, in the object's group.
   */
  advanced?: boolean;
  /** Carries context into the turn; shown on the node editor's Context tab. */
  context?: boolean;
  /** The heading the field is grouped under inside Advanced. */
  group?: string;
  /** A control the web app registers under this name draws the field instead of the default. */
  control?: string;
  /** Each item of this list collapses to a one-line summary: its kind and its path. */
  collapseItems?: boolean;
};

/** Field metadata for `.meta()`: what the field is for, and where and how the forms show it. */
export function field(
  description: string,
  options: Omit<FieldMeta, 'description'> = {},
): FieldMeta {
  return { description, ...options };
}

/** The slice of a Zod 4 schema the readers below walk. */
interface SchemaLike {
  _zod: { def: { type: string; innerType?: unknown; in?: unknown } };
}

/** Wrappers that leave a field's meaning alone: optional, default, prefault, and the like. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
]);

/** The schema itself, then each schema it wraps, outermost first. */
function layers(schema: SchemaLike): SchemaLike[] {
  const out: SchemaLike[] = [];
  for (let current: SchemaLike | undefined = schema; current;) {
    out.push(current);
    const def = current._zod.def;
    const inner = WRAPPERS.has(def.type) ? def.innerType : def.type === 'pipe' ? def.in : undefined;
    current = inner as SchemaLike | undefined;
  }
  return out;
}

const STRINGS = ['description', 'title', 'group', 'control'] as const;
const FLAGS = ['advanced', 'context', 'collapseItems'] as const;

/**
 * A field's metadata, merged along its wrapper chain (the base schema, then each optional,
 * default, or prefault around it, a layer further out winning), so metadata may sit at any layer:
 * `TemplateSchema.optional().meta(...)` and `TemplateSchema.meta(...).optional()` read the same.
 * Only the keys of `FieldMeta`, with the right types, are returned; an undescribed field gives `{}`.
 */
export function fieldMeta(schema: z.core.$ZodType): FieldMeta {
  const merged: Record<string, unknown> = {};
  for (const layer of layers(schema).reverse()) {
    Object.assign(merged, z.globalRegistry.get(layer as z.core.$ZodType));
  }
  const meta: FieldMeta = {};
  for (const key of STRINGS) {
    const value = merged[key];
    if (typeof value === 'string') meta[key] = value;
  }
  for (const key of FLAGS) {
    const value = merged[key];
    if (typeof value === 'boolean') meta[key] = value;
  }
  return meta;
}

/**
 * Whether `schema` is `marker`, or a copy of it that differs only in metadata: `.meta()` and
 * `.describe()` copy a schema and keep its definition. Use it instead of `===` to recognise a
 * shared schema, such as `TemplateSchema`, that a field may carry with metadata of its own.
 */
export function sameSchema(schema: SchemaLike, marker: SchemaLike): boolean {
  return schema === marker || schema._zod.def === marker._zod.def;
}
