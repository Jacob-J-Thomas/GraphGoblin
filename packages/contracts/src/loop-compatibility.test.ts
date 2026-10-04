import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LoopDefinitionSchema,
  LoopExportSchema,
  LoopVersionRecordSchema,
  LoopSettingsSchema,
} from './loop.js';
import { LoopDefinitionCompatibilitySchema, resolveLegacyHarness } from './loop-compatibility.js';
import { fakeUlid, FIXTURE_TS, legacyHarnessLoop, minimalLoop } from './testing/index.js';

describe('legacy loop harness compatibility', () => {
  it('normalises legacy input without mutation, and is idempotent', () => {
    const legacy = legacyHarnessLoop();
    const before = structuredClone(legacy);
    const def = LoopDefinitionCompatibilitySchema.parse(legacy);
    expect(def.settings.defaults).not.toHaveProperty('harness');
    expect(def.nodes[1]).toMatchObject({ config: { harness: 'codex' } });
    expect(legacy).toEqual(before);
    expect(LoopDefinitionCompatibilitySchema.parse(def)).toEqual(def);
    expect(LoopDefinitionSchema.safeParse(legacy).success).toBe(false);
  });

  it('defaults omitted node harnesses to Codex without a legacy value', () => {
    const { settings: _legacy, ...input } = legacyHarnessLoop();
    expect(LoopDefinitionCompatibilitySchema.parse(input).nodes[1]).toMatchObject({
      config: { harness: 'codex' },
    });
    expect(LoopSettingsSchema.parse({}).defaults).toEqual({});
    expect(LoopDefinitionCompatibilitySchema.parse(minimalLoop()).settings.defaults).toEqual({});
  });

  it('inherits only omitted inference values using a test-only second identifier', () => {
    const input = {
      settings: { defaults: { harness: 'test-harness', model: 'test-model' } },
      nodes: [
        { kind: 'inference', config: { prompt: {} } },
        { kind: 'inference', config: { harness: 'codex' } },
        { kind: 'exit', config: {} },
      ],
    };
    const before = structuredClone(input);
    const resolved = resolveLegacyHarness(input);
    expect(resolved.nodes.map((node) => node.config['harness'])).toEqual([
      'test-harness',
      'codex',
      undefined,
    ]);
    expect(resolved.settings.defaults).toEqual({ model: 'test-model' });
    expect(input).toEqual(before);
    expect(resolveLegacyHarness(resolved)).toEqual(resolved);
    const legacy = legacyHarnessLoop();
    expect(
      LoopDefinitionCompatibilitySchema.safeParse({ ...legacy, settings: input.settings }).success,
    ).toBe(false);
    expect(
      LoopDefinitionSchema.safeParse({
        ...legacy,
        settings: {},
        nodes: [
          { ...legacy.nodes[1], config: { prompt: { template: 'Hi' }, harness: 'test-harness' } },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([null, 3, '', 'claude'])(
    'rejects invalid legacy values at the field path even with explicit nodes (%j)',
    (harness) => {
      const legacy = legacyHarnessLoop();
      const parsed = LoopDefinitionCompatibilitySchema.safeParse({
        ...legacy,
        settings: { defaults: { harness } },
        nodes: legacy.nodes.map((node) =>
          node.kind === 'inference'
            ? { ...node, config: { ...node.config, harness: 'codex' } }
            : node,
        ),
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues[0]?.path).toEqual(['settings', 'defaults', 'harness']);
    },
  );

  it('rejects invalid inference harnesses at the node path', () => {
    const input = legacyHarnessLoop();
    const parsed = LoopDefinitionCompatibilitySchema.safeParse({
      ...input,
      nodes: input.nodes.map((node) =>
        node.kind === 'inference'
          ? { ...node, config: { ...node.config, harness: 'wrong' } }
          : node,
      ),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues[0]?.path).toEqual(['nodes', 1, 'config', 'harness']);
  });

  it('advertises deprecated optional legacy input and canonical encodable responses', () => {
    const schema = z.toJSONSchema(LoopDefinitionCompatibilitySchema, { io: 'input' });
    const text = JSON.stringify(schema);
    expect(text).toContain('"deprecated":true');
    const settings = schema.properties?.['settings'];
    const defaults = typeof settings === 'object' ? settings.properties?.['defaults'] : undefined;
    if (typeof defaults !== 'object') throw new Error('missing defaults schema');
    expect(defaults.required ?? []).not.toContain('harness');
    expect(defaults.properties?.['harness']).not.toHaveProperty('default');
    const canonical = LoopDefinitionCompatibilitySchema.parse(legacyHarnessLoop());
    const version = {
      id: fakeUlid('v'),
      loopId: fakeUlid('l'),
      version: 1,
      status: 'published' as const,
      definition: canonical,
      createdAt: FIXTURE_TS,
      publishedAt: FIXTURE_TS,
    };
    expect(z.encode(LoopVersionRecordSchema, version).definition).toEqual(canonical);
    expect(
      z.encode(LoopExportSchema, {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: FIXTURE_TS,
        loop: canonical,
      }).loop,
    ).toEqual(canonical);
    for (const response of [LoopDefinitionSchema, LoopExportSchema, LoopVersionRecordSchema]) {
      expect(JSON.stringify(z.toJSONSchema(response))).not.toContain('deprecated');
    }
  });
});
