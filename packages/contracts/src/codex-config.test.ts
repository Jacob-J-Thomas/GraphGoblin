import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HarnessOptionsSchema, InferenceConfigSchema } from './nodes.js';

const prompt = { template: 'Summarise the supplied text.' };

describe('Codex config override keys (#429)', () => {
  it('preserves ordinary scalar, table, dotted and array values through decode and encode', () => {
    const configOverrides = {
      service_tier: 'fast',
      'features.plugins': false,
      sandbox_workspace_write: { network_access: true },
      list: [false, 3, 'plain text', null, { 'team-docs': { enabled: true } }],
      toString: true,
      '0': 0,
    };
    const parsed = InferenceConfigSchema.parse({ prompt, harnessOptions: { configOverrides } });
    expect(parsed.harnessOptions.configOverrides).toEqual(configOverrides);
    expect(z.encode(InferenceConfigSchema, parsed).harnessOptions?.configOverrides).toEqual(
      configOverrides,
    );
  });

  it.each([
    ['top-level reserved key', JSON.parse('{"__proto__":{"enabled":true}}'), ['__proto__']],
    ['constructor', { constructor: true }, ['constructor']],
    ['prototype', { prototype: true }, ['prototype']],
    [
      'dotted reserved segment',
      { 'features.prototype.enabled': true },
      ['features.prototype.enabled'],
    ],
    [
      'nested reserved segment',
      JSON.parse('{"features":{"__proto__":true}}'),
      ['features', '__proto__'],
    ],
    ['space', { 'team docs': true }, ['team docs']],
    ['quoted segment', { 'features."plugins"': true }, ['features."plugins"']],
    ['empty segment', { 'features..plugins': true }, ['features..plugins']],
    ['leading dot', { '.features': true }, ['.features']],
    ['trailing dot', { 'features.': true }, ['features.']],
    ['empty key', { '': true }, ['']],
    ['non-ASCII key', { équipe: true }, ['équipe']],
    ['array table', { list: [1, { 'not plain': true }] }, ['list', 1, 'not plain']],
  ])('rejects %s without discarding authored input', (_name, configOverrides, path) => {
    const before = JSON.stringify(configOverrides);
    const parsed = InferenceConfigSchema.safeParse({ prompt, harnessOptions: { configOverrides } });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['harnessOptions', 'configOverrides', ...(path as (string | number)[])],
          message: expect.stringContaining('every key segment'),
        }),
      );
    expect(JSON.stringify(configOverrides)).toBe(before);
    expect(() =>
      z.encode(HarnessOptionsSchema, { sandbox: 'read-only', approval: 'never', configOverrides }),
    ).toThrow();
  });

  it('keeps the normal generated object schema in both directions', () => {
    const schema = HarnessOptionsSchema.shape.configOverrides;
    for (const io of ['input', 'output'] as const)
      expect(z.toJSONSchema(schema, { io })).toMatchObject({
        allOf: [{ type: 'object', additionalProperties: {} }, {}],
      });
  });

  it.each([null, [], false, 'not a table'])('refuses a non-record override value: %j', (value) => {
    expect(HarnessOptionsSchema.safeParse({ configOverrides: value }).success).toBe(false);
  });
});
