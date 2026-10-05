import { field, JsonSchemaSchema, NodeConfigSchemas, TemplateSchema } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { itemSummary } from './fields.js';
import { shapeOf, type Schema } from './introspect.js';
import {
  formLayout,
  isCustomized,
  isOwned,
  labelOf,
  placementsOf,
  type FormLayout,
  type LayoutItem,
} from './layout.js';
import { UNSET } from './unset.js';

const names = (items: readonly LayoutItem[]) => placementsOf(items).map((p) => p.name);
const shape = (schema: Schema) => {
  const s = shapeOf(schema);
  if (s.kind !== 'object') throw new Error('not an object');
  return s.shape;
};
const sections = (layout: FormLayout) =>
  layout.advanced.map((section) => [section.heading, names(section.items)]);

describe('formLayout', () => {
  it('keeps every field in schema order when nothing is advanced', () => {
    const layout = formLayout(shape(NodeConfigSchemas.heartbeat));
    expect(names(layout.basic)).toEqual([
      'intervalSeconds',
      'probe',
      'until',
      'maxBeats',
      'deadline',
      'onExhausted',
      'record',
    ]);
    expect(layout.advanced).toEqual([]);
  });

  it('places inference fields: basic first, a split object, groups by first appearance', () => {
    const layout = formLayout(shape(NodeConfigSchemas.inference));
    expect(names(layout.basic)).toEqual([
      'harness',
      'model',
      'effort',
      'session',
      'prompt',
      'harnessOptions.sandbox',
    ]);
    expect(sections(layout)).toEqual([
      ['Context', ['input', 'contextFiles']],
      [
        'Harness options',
        [
          'harnessOptions.approval',
          'harnessOptions.networkAccess',
          'harnessOptions.webSearch',
          'harnessOptions.configOverrides',
          'capabilities',
        ],
      ],
      [
        'Output',
        ['output.captureTranscript', 'output.toMessages', 'output.transforms', 'output.schema'],
      ],
      ['Limits', ['timeoutSeconds']],
    ]);
    // A split object's blocks: the basic one shows its own message, the advanced one does not.
    const sandbox = layout.basic.find(isOwned);
    expect(sandbox).toMatchObject({ owner: 'harnessOptions', showsError: true });
    const harness = layout.advanced[1]!.items.find(isOwned);
    expect(harness).toMatchObject({ owner: 'harnessOptions', showsError: false });
    // All of `output` is advanced: its first block shows its message.
    expect(layout.advanced[2]!.items[0]).toMatchObject({ owner: 'output', showsError: true });
  });

  it('labels split subloop modes by their titles, and nests paths under a base', () => {
    const layout = formLayout(shape(NodeConfigSchemas.subloop), 'config');
    expect(placementsOf(layout.basic).map((p) => [p.name, p.label])).toEqual([
      ['config.loopRef', 'Loop ref'],
      ['config.input.mode', 'Input mode'],
      ['config.output.mode', 'Output mode'],
    ]);
    expect(sections(layout).map(([heading]) => heading)).toEqual([
      'Input mapping',
      'Output mapping',
      'Limits',
    ]);
  });

  it('leaves out a skipped key, places optional objects whole, and groups split fields', () => {
    const schema = z.object({
      kind: z.literal('a'),
      // Optional without a default: drawn with Add and Remove, so never split.
      extra: z
        .object({ a: z.string().meta(field('A.', { advanced: true })) })
        .optional()
        .meta(field('Extra.', { advanced: true, group: 'More' })),
      // Fields of their own groups, and one that falls back to the object's label.
      opts: z
        .object({
          x: z
            .string()
            .optional()
            .meta(field('X.', { advanced: true, group: 'Xs' })),
          y: z
            .string()
            .optional()
            .meta(field('Y.', { advanced: true })),
          z: z
            .string()
            .optional()
            .meta(field('Z.', { advanced: false })),
        })
        .prefault({}),
      plain: z
        .string()
        .optional()
        .meta(field('Plain.', { advanced: true })),
    });
    const layout = formLayout(shape(schema), '', 'kind');
    expect(names(layout.basic)).toEqual(['opts.z']);
    expect(sections(layout)).toEqual([
      ['More', ['extra']],
      ['Xs', ['opts.x']],
      ['Opts', ['opts.y']],
      [undefined, ['plain']],
    ]);
    expect(layout.basic[0]).toMatchObject({ owner: 'opts', showsError: true });
  });

  it('reads labels from titles', () => {
    expect(labelOf('maxIterations', z.number())).toBe('Max iterations');
    expect(labelOf('mode', z.string().meta(field('M.', { title: 'Input mode' })))).toBe(
      'Input mode',
    );
  });
});

describe('isCustomized', () => {
  const object = z.object({
    on: z.boolean().default(true),
    name: z.string().optional(),
    list: z.array(z.string()).optional(),
    items: z.array(z.string()).default([]),
    channels: z.array(z.string()).default(['caller']),
  });

  it('counts a value of its own, not unset, a default, or an empty collection', () => {
    expect(isCustomized(z.string().optional(), undefined)).toBe(false);
    expect(isCustomized(z.string().optional(), UNSET)).toBe(false);
    expect(isCustomized(z.string().optional(), 'x')).toBe(true);
    expect(isCustomized(z.string().optional(), '')).toBe(true);
    expect(isCustomized(z.number().optional(), 0)).toBe(true);
    expect(isCustomized(z.boolean().default(true), true)).toBe(false);
    expect(isCustomized(z.boolean().default(true), false)).toBe(true);
    expect(isCustomized(TemplateSchema, '')).toBe(true);
  });

  it('looks inside objects and collections', () => {
    const prefaulted = object.prefault({});
    expect(isCustomized(prefaulted, {})).toBe(false);
    expect(isCustomized(prefaulted, { on: true, name: UNSET, list: [], items: [] })).toBe(false);
    expect(isCustomized(prefaulted, { on: false })).toBe(true);
    expect(isCustomized(prefaulted, { name: 'n' })).toBe(true);
    expect(isCustomized(prefaulted, { list: ['a'] })).toBe(true);
    // A collection emptied below its non-empty default differs from it.
    expect(isCustomized(prefaulted, { channels: [] })).toBe(true);
    expect(isCustomized(prefaulted, { channels: ['caller'] })).toBe(false);
    // An unknown key holds a value too.
    expect(isCustomized(prefaulted, { unknown: 1 })).toBe(true);
    expect(isCustomized(z.record(z.string(), z.string()).optional(), {})).toBe(false);
    expect(isCustomized(z.record(z.string(), z.string()).optional(), { a: '' })).toBe(true);
    expect(isCustomized(z.unknown(), null)).toBe(true);
    // An opaque JSON value counts once supplied, even `{}`: an empty JSON Schema is a choice.
    expect(isCustomized(JsonSchemaSchema.optional(), {})).toBe(true);
    expect(isCustomized(z.unknown(), {})).toBe(true);
    expect(isCustomized(z.json().optional(), [])).toBe(true);
    const schema = shape(NodeConfigSchemas.inference.shape.output)['schema']!;
    expect(isCustomized(schema, { jsonSchema: {} })).toBe(true);
    expect(isCustomized(schema, {})).toBe(false);
    expect(isCustomized(z.object({ a: z.array(z.number()) }), { a: [1, { b: 2 }] })).toBe(true);
  });

  it('compares defaults deeply', () => {
    const session = NodeConfigSchemas.inference.shape.session;
    expect(isCustomized(session, { policy: 'fresh' })).toBe(false);
    expect(isCustomized(session, { policy: 'resume-previous' })).toBe(true);
    const nested = z.object({ a: z.array(z.object({ b: z.number() })) }).default({ a: [{ b: 1 }] });
    expect(isCustomized(nested, { a: [{ b: 1 }] })).toBe(false);
    expect(isCustomized(nested, { a: [{ b: 2 }] })).toBe(true);
    expect(isCustomized(nested, { a: [{ b: 1 }, { b: 1 }] })).toBe(true);
    expect(isCustomized(nested, { a: [{ b: 1, c: 1 }] })).toBe(true);
    expect(isCustomized(nested, { a: { 0: { b: 1 } } })).toBe(true);
  });
});

describe('itemSummary', () => {
  const element = NodeConfigSchemas.mutate.shape.operations.element;

  it('names an item by its kind and its first short text or number, its path', () => {
    expect(itemSummary(element, { op: 'set', path: '/vars/a', value: {} })).toEqual({
      kind: 'set',
      detail: '/vars/a',
    });
    expect(itemSummary(element, { op: 'inject', position: 0, messages: [] })).toEqual({
      kind: 'inject',
      detail: '0',
    });
    expect(itemSummary(element, { op: 'set', path: '  ' })).toEqual({
      kind: 'set',
      detail: undefined,
    });
  });

  it('has nothing to say for anything but a tagged item', () => {
    expect(itemSummary(element, null)).toBeUndefined();
    expect(itemSummary(element, { path: '/x' })).toBeUndefined();
    expect(itemSummary(z.string(), 'x')).toBeUndefined();
    expect(itemSummary(z.union([z.string(), z.number()]), { a: 1 })).toBeUndefined();
    const literals = z.discriminatedUnion('kind', [z.object({ kind: z.literal('a') })]);
    expect(itemSummary(literals, { kind: 'a' })).toEqual({ kind: 'a', detail: undefined });
  });
});
