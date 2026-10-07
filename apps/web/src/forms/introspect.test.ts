import {
  ExpressionSchema,
  field,
  JsonSchemaSchema,
  NodeConfigSchemas,
  TemplateSchema,
} from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { humanize, initialValue, matchOption, optionLabel, shapeOf, unwrap } from './introspect.js';
import { isUnset, stripUnset, UNSET } from './unset.js';

describe('introspect', () => {
  it('unwraps optional, default, prefault, nullable, and pipes', () => {
    expect(unwrap(z.string().optional())).toMatchObject({ optional: true, hasDefault: false });
    expect(unwrap(z.number().default(3))).toMatchObject({
      optional: true,
      hasDefault: true,
      defaultValue: 3,
    });
    expect(unwrap(z.object({}).prefault({}))).toMatchObject({ hasDefault: true, defaultValue: {} });
    expect(unwrap(z.string().nullable()).optional).toBe(true);
    expect(shapeOf(z.string().transform((s) => s.length))).toMatchObject({ kind: 'string' });
  });

  it('classifies every Zod construct the node configs use', () => {
    expect(shapeOf(TemplateSchema.optional())).toEqual({ kind: 'string', format: 'template' });
    expect(shapeOf(ExpressionSchema)).toMatchObject({ kind: 'string', format: 'expression' });
    expect(shapeOf(JsonSchemaSchema)).toEqual({ kind: 'json' });
    // A field's own metadata copies the shared schema with its definition: still recognised.
    expect(shapeOf(TemplateSchema.meta(field('A template.')))).toEqual({
      kind: 'string',
      format: 'template',
    });
    expect(shapeOf(ExpressionSchema.meta(field('An expression.')).optional())).toMatchObject({
      format: 'expression',
    });
    expect(shapeOf(JsonSchemaSchema.describe('A schema.'))).toEqual({ kind: 'json' });
    expect(shapeOf(NodeConfigSchemas.decision.shape.evaluation)).toMatchObject({
      kind: 'union',
      discriminator: 'kind',
    });
    expect(shapeOf(z.string().min(2))).toEqual({ kind: 'string', format: 'text', minLength: 2 });
    expect(shapeOf(z.number().int().positive().max(10))).toEqual({
      kind: 'number',
      integer: true,
      min: 1,
      max: 10,
    });
    expect(shapeOf(z.number().gt(0).lt(1))).toMatchObject({ kind: 'number', integer: false });
    expect(shapeOf(z.number())).toEqual({ kind: 'number', integer: false });
    expect(shapeOf(z.boolean())).toEqual({ kind: 'boolean' });
    expect(shapeOf(z.enum(['a', 'b']))).toEqual({ kind: 'enum', options: ['a', 'b'] });
    expect(shapeOf(z.literal('x'))).toEqual({ kind: 'literal', value: 'x' });
    expect(shapeOf(z.literal(['x', 'y']))).toEqual({ kind: 'enum', options: ['x', 'y'] });
    expect(shapeOf(z.array(z.string()).min(1).max(3))).toMatchObject({
      kind: 'array',
      min: 1,
      max: 3,
    });
    expect(shapeOf(z.record(z.string(), z.number()))).toMatchObject({ kind: 'record' });
    expect(shapeOf(NodeConfigSchemas.trigger)).toMatchObject({
      kind: 'union',
      discriminator: 'subtype',
    });
    expect(shapeOf(z.union([z.string(), z.number()]))).toMatchObject({ kind: 'union' });
    expect(shapeOf(z.date())).toEqual({ kind: 'json' });
    expect(shapeOf(z.json())).toEqual({ kind: 'json' });
  });

  it('builds initial values', () => {
    expect(initialValue(NodeConfigSchemas.wait)).toMatchObject({ mode: 'input', prompt: '' });
    expect(
      initialValue(
        z.object({
          n: z.number(),
          i: z.number().int(),
          m: z.number().min(5),
          b: z.boolean(),
          e: z.enum(['p', 'q']),
        }),
      ),
    ).toEqual({
      n: 0,
      i: 1,
      m: 5,
      b: false,
      e: 'p',
    });
    expect(initialValue(z.array(z.string()).min(2))).toEqual(['', '']);
    expect(initialValue(z.record(z.string(), z.string()))).toEqual({});
    expect(initialValue(z.union([]) as never)).toBeNull();
    expect(initialValue(z.json())).toBeNull();
    expect(initialValue(ExpressionSchema)).toBe('true');
    expect(initialValue(z.literal(7))).toBe(7);
  });

  it('labels and matches union options', () => {
    const union = z.union([
      z.literal('none'),
      z.number(),
      z.strictObject({ where: z.string() }),
      z.string(),
      z.boolean(),
    ]);
    const options = (union._zod.def as unknown as { options: z.ZodType[] }).options;
    expect(options.map((o) => optionLabel(o))).toEqual([
      'none',
      'number',
      'where',
      'text',
      'boolean',
    ]);
    expect(optionLabel(z.object({}))).toBe('object');
    expect(optionLabel(ExpressionSchema)).toBe('expression');
    expect(matchOption(options, 'none')).toBe(0);
    expect(matchOption(options, 3)).toBe(1);
    expect(matchOption(options, { where: 'x' })).toBe(2);
    expect(matchOption(options, { where: 3 })).toBe(2);
    expect(matchOption([z.literal('a'), z.number().min(10)], 3)).toBe(1);
    expect(matchOption([z.literal('a'), z.string().min(5)], 'xy')).toBe(1);
    expect(matchOption([z.literal('a')], Symbol.iterator)).toBe(0);
    const trigger = (NodeConfigSchemas.trigger._zod.def as unknown as { options: z.ZodType[] })
      .options;
    expect(matchOption(trigger, { subtype: 'cron' }, 'subtype')).toBe(1);
    expect(matchOption(trigger, 'junk', 'subtype')).toBe(0);
    expect(optionLabel(z.string(), 'subtype')).toBe('');
    expect(optionLabel(z.object({ other: z.string() }), 'subtype')).toBe('');
    expect(optionLabel(z.object({ subtype: z.string() }), 'subtype')).toBe('');
  });

  it('humanizes keys and strips the unset sentinel', () => {
    expect(humanize('maxIterations')).toBe('Max iterations');
    expect(humanize('on-timeout')).toBe('On timeout');
    expect(isUnset(UNSET)).toBe(true);
    expect(stripUnset({ a: UNSET, b: [UNSET, 1], c: { d: undefined, e: 'x' } })).toEqual({
      b: [undefined, 1],
      c: { e: 'x' },
    });
    expect(stripUnset(UNSET)).toBeUndefined();
  });
});
