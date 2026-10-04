import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, legacyHarnessLoop, minimalLoop } from '@graphgoblin/contracts/testing';
import { exportLoop, importLoop, LoopImportError } from './loop-io.js';

describe('exportLoop / importLoop', () => {
  it.each([false, true])(
    'imports legacy definitions and envelopes (%j) and exports canonically',
    (envelope) => {
      const legacy = legacyHarnessLoop();
      const input = envelope
        ? { format: 'graphgoblin-loop', formatVersion: 1, exportedAt: FIXTURE_TS, loop: legacy }
        : legacy;
      const imported = importLoop(input);
      expect(imported.issues).toEqual([]);
      expect(imported.definition.settings.defaults).not.toHaveProperty('harness');
      expect(imported.definition.nodes[1]).toMatchObject({ config: { harness: 'codex' } });
      const first = exportLoop(imported.definition, FIXTURE_TS);
      expect(exportLoop(importLoop(first).definition, FIXTURE_TS)).toEqual(first);
      // Old in-memory callers of exportLoop also receive a canonical export.
      const old = {
        ...imported.definition,
        settings: {
          ...imported.definition.settings,
          defaults: { harness: 'codex', ...imported.definition.settings.defaults },
        },
      };
      expect(exportLoop(old, FIXTURE_TS)).toEqual(first);
    },
  );

  it.each(['format', 'formatVersion', 'exportedAt', 'loop'])(
    'reports invalid envelope %s using its own path',
    (field) => {
      const input = {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: FIXTURE_TS,
        loop: legacyHarnessLoop(),
        [field]: null,
      };
      try {
        importLoop(input);
        expect.fail('expected import rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(LoopImportError);
        expect((error as LoopImportError).details).toMatchObject({
          errors: expect.arrayContaining([expect.stringMatching(new RegExp(`^${field}:`))]),
        });
      }
    },
  );

  it.each([false, true])('preserves invalid legacy harness paths (%j)', (envelope) => {
    const legacy = { ...legacyHarnessLoop(), settings: { defaults: { harness: 'wrong' } } };
    const input = envelope
      ? { format: 'graphgoblin-loop', formatVersion: 1, exportedAt: FIXTURE_TS, loop: legacy }
      : legacy;
    try {
      importLoop(input);
      expect.fail('expected import rejection');
    } catch (error) {
      expect((error as LoopImportError).details).toMatchObject({
        errors: expect.arrayContaining([
          expect.stringContaining(`${envelope ? 'loop.' : ''}settings.defaults.harness:`),
        ]),
      });
    }
  });
  it('round-trips an export document', () => {
    const def = LoopDefinitionSchema.parse(minimalLoop());
    const exported = exportLoop(def, FIXTURE_TS);
    expect(exported.format).toBe('graphgoblin-loop');
    const imported = importLoop(JSON.parse(JSON.stringify(exported)));
    expect(imported.definition.name).toBe('minimal');
    expect(imported.issues).toEqual([]);
  });

  it('accepts a bare definition and reports structural issues', () => {
    const bare = minimalLoop();
    bare.edges = [];
    const imported = importLoop(bare);
    expect(imported.issues.map((i) => i.code)).toContain('PORT_UNCONNECTED');
  });

  it('rejects documents that are neither', () => {
    expect(() => importLoop({ hello: 'world' })).toThrow(LoopImportError);
    try {
      importLoop({ hello: 'world' });
    } catch (error) {
      expect((error as LoopImportError).details).toMatchObject({ errors: expect.any(Array) });
    }
  });
});
