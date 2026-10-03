import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { exportLoop, importLoop, LoopImportError } from './loop-io.js';

describe('exportLoop / importLoop', () => {
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
