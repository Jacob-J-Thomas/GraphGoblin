import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ExpressionSchema,
  InferenceConfigSchema,
  MutationListSchema,
  NodeConfigSchemas,
  SubloopConfigSchema,
  TemplateSchema,
  field,
  fieldMeta,
  sameSchema,
} from './index.js';

/** The slice of a Zod 4 schema these tests walk. */
interface Walkable {
  _zod: {
    def: {
      type: string;
      innerType?: Walkable;
      in?: Walkable;
      shape?: Record<string, Walkable>;
      options?: Walkable[];
      element?: Walkable;
      valueType?: Walkable;
    };
    parent?: Walkable;
  };
}

/** Every schema reachable from `root`: wrappers, object fields, union options, items, values. */
function* schemasIn(root: Walkable, seen = new Set<Walkable>()): Generator<Walkable> {
  if (seen.has(root)) return;
  seen.add(root);
  yield root;
  const def = root._zod.def;
  const children = [
    def.innerType,
    def.in,
    def.element,
    def.valueType,
    ...Object.values(def.shape ?? {}),
    ...(def.options ?? []),
  ];
  for (const child of children) if (child) yield* schemasIn(child, seen);
}

const shapeOf = (schema: unknown) =>
  (schema as Walkable)._zod.def.shape as Record<string, z.ZodType>;

describe('field metadata', () => {
  it('builds metadata from a description and options', () => {
    expect(field('What it is.')).toEqual({ description: 'What it is.' });
    expect(field('What it is.', { advanced: true, group: 'Limits' })).toEqual({
      description: 'What it is.',
      advanced: true,
      group: 'Limits',
    });
  });

  it('reads metadata at any layer of the wrapper chain, the outer layer winning', () => {
    const inner = z
      .string()
      .meta(field('Inner.', { group: 'A', advanced: true }))
      .optional();
    expect(fieldMeta(inner)).toEqual({ description: 'Inner.', group: 'A', advanced: true });
    const outer = z
      .string()
      .meta(field('Inner.', { group: 'A' }))
      .default('x')
      .meta(field('Outer.', { title: 'Shown' }));
    expect(fieldMeta(outer)).toEqual({ description: 'Outer.', group: 'A', title: 'Shown' });
    expect(fieldMeta(z.string().describe('Described.').optional())).toEqual({
      description: 'Described.',
    });
    const piped = z.string().meta(field('Piped.')).pipe(z.string());
    expect(fieldMeta(piped)).toEqual({ description: 'Piped.' });
    expect(fieldMeta(z.number())).toEqual({});
  });

  it('keeps only the keys of FieldMeta, with their types', () => {
    const schema = z.string().meta({
      description: 'Kept.',
      control: 'model',
      collapseItems: true,
      advanced: 'yes',
      group: 3,
      id: 'not-a-field-key',
      examples: ['x'],
    });
    expect(fieldMeta(schema)).toEqual({
      description: 'Kept.',
      control: 'model',
      collapseItems: true,
    });
  });

  it('inherits list metadata through checks: every mutation list collapses its items', () => {
    expect(fieldMeta(MutationListSchema).collapseItems).toBe(true);
    expect(fieldMeta(NodeConfigSchemas.mutate.shape.operations).collapseItems).toBe(true);
    expect(fieldMeta(InferenceConfigSchema.shape.input)).toMatchObject({
      collapseItems: true,
      advanced: true,
      group: 'Context',
    });
  });

  it('marks the advanced fields and the basic ones of a split object', () => {
    const inference = InferenceConfigSchema.shape;
    expect(fieldMeta(inference.prompt).advanced).toBeUndefined();
    expect(fieldMeta(inference.timeoutSeconds)).toMatchObject({ advanced: true, group: 'Limits' });
    expect(fieldMeta(inference.model).control).toBe('model');
    const harness = shapeOf(inference.harnessOptions._zod.def.innerType);
    expect(fieldMeta(harness['sandbox']!).advanced).toBeUndefined();
    expect(fieldMeta(harness['approval']!).advanced).toBe(true);
    const input = shapeOf(SubloopConfigSchema.shape.input._zod.def.innerType);
    expect(fieldMeta(input['mode']!)).toMatchObject({ title: 'Input mode' });
  });

  it('describes every config field of every node kind', () => {
    for (const [kind, schema] of Object.entries(NodeConfigSchemas)) {
      const def = (schema as unknown as Walkable)._zod.def;
      for (const option of def.options ?? [schema as unknown as Walkable]) {
        const shape = option._zod.def.shape ?? {};
        for (const [key, child] of Object.entries(shape)) {
          if (key === 'subtype' || key === 'mode') continue; // the variant's tag, named by its table
          expect(fieldMeta(child as unknown as z.ZodType).description, `${kind}.${key}`).toEqual(
            expect.any(String),
          );
        }
      }
    }
  });

  it('only ever copies a schema with its definition: metadata never changes parsing', () => {
    let copies = 0;
    for (const schema of Object.values(NodeConfigSchemas)) {
      for (const node of schemasIn(schema as unknown as Walkable)) {
        if (z.globalRegistry.has(node as unknown as z.ZodType) && node._zod.parent) {
          copies += 1;
          // A copy made by `.meta()` shares its parent's definition; a check (`.min`, `.refine`)
          // would make a new one and is not metadata.
          expect(node._zod.def).toBe(node._zod.parent._zod.def);
        }
      }
    }
    expect(copies).toBeGreaterThan(60);
  });

  it('reaches z.toJSONSchema, so the reference and API documents can show it', () => {
    const json = z.toJSONSchema(NodeConfigSchemas.script, { io: 'input' }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(json.properties['command']).toMatchObject({ description: 'Program to run.' });
    expect(json.properties['env']).toMatchObject({ advanced: true, group: 'Process' });
  });
});

describe('sameSchema', () => {
  it('sees through metadata copies, and only through them', () => {
    expect(sameSchema(TemplateSchema, TemplateSchema)).toBe(true);
    expect(sameSchema(TemplateSchema.meta(field('A template.')), TemplateSchema)).toBe(true);
    expect(sameSchema(TemplateSchema.describe('A template.'), TemplateSchema)).toBe(true);
    expect(sameSchema(TemplateSchema.max(10), TemplateSchema)).toBe(false);
    expect(sameSchema(TemplateSchema.optional(), TemplateSchema)).toBe(false);
    expect(sameSchema(ExpressionSchema, TemplateSchema)).toBe(false);
  });
});
