import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { exportLoop, importLoop, LoopImportError, LoopFormatUnsupportedError } from './loop-io.js';

describe('exportLoop / importLoop', () => {
  it('carries manual edge routes (#44) through export and import unchanged', () => {
    const base = minimalLoop();
    const definition = LoopDefinitionSchema.parse({
      ...base,
      edges: [{ ...base.edges[0], ui: { route: [240, -80.5, 360] } }],
    });
    const exported = exportLoop(definition, FIXTURE_TS);
    expect(exported.loop.edges[0]?.ui).toEqual({ route: [240, -80.5, 360] });
    const imported = importLoop(JSON.parse(JSON.stringify(exported)));
    expect(imported.definition).toEqual(definition);
    expect(imported.issues).toEqual([]);
    // A bare definition imports the same way; a malformed route is refused with its path.
    expect(importLoop(definition).definition.edges[0]?.ui).toEqual({ route: [240, -80.5, 360] });
    expect(() =>
      importLoop({ ...definition, edges: [{ ...definition.edges[0], ui: { route: [1, 2] } }] }),
    ).toThrow(LoopImportError);
  });

  it.each(['jev', 'kev.local'])(
    'preserves explicit classifier IDs on portable export/import (%s)',
    (model) => {
      const base = minimalLoop();
      const definition = LoopDefinitionSchema.parse({
        ...base,
        nodes: [
          base.nodes[0],
          {
            id: 'decide',
            kind: 'decision',
            label: 'Choose',
            config: {
              kind: 'classifier',
              model,
              question: '?',
              context: {},
              answer: {
                type: 'choice',
                options: [
                  { id: 'yes', label: 'yes', criteria: 'Yes' },
                  { id: 'no', label: 'no', criteria: 'No' },
                ],
              },
            },
          },
          base.nodes[1],
        ],
        edges: [
          { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
          { id: 'e2', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
          { id: 'e3', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
        ],
      });
      expect(importLoop(exportLoop(definition, FIXTURE_TS)).definition).toEqual(definition);
    },
  );
  it.each(['format', 'formatVersion', 'exportedAt', 'loop'])(
    'reports invalid envelope %s using its own path',
    (field) => {
      const input = {
        format: 'graphgoblin-loop',
        formatVersion: CURRENT_DEFINITION_FORMAT,
        exportedAt: FIXTURE_TS,
        loop: minimalLoop(),
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

  it.each([false, true])('rejects removed loop defaults with the field path (%j)', (envelope) => {
    const definition = { ...minimalLoop(), settings: { defaults: { harness: 'codex' } } };
    const input = envelope
      ? {
          format: 'graphgoblin-loop',
          formatVersion: CURRENT_DEFINITION_FORMAT,
          exportedAt: FIXTURE_TS,
          loop: definition,
        }
      : definition;
    try {
      importLoop(input);
      expect.fail('expected import rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(LoopImportError);
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
    expect(imported.definition).toEqual(def);
    expect(exportLoop(imported.definition, FIXTURE_TS)).toEqual(exported);
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

it.each([
  [{ format: 'graphgoblin-loop', formatVersion: 1, exportedAt: 'old', loop: {} }, 1, 'export'],
  [{ format: 'graphgoblin-loop', formatVersion: 3, exportedAt: 'old', loop: {} }, 3, 'export'],
  [{ format: 'graphgoblin-loop', formatVersion: 5, exportedAt: 'new', loop: {} }, 5, 'export'],
  [
    {
      format: 'graphgoblin-loop',
      formatVersion: CURRENT_DEFINITION_FORMAT,
      exportedAt: 'mixed',
      loop: { ...minimalLoop(), schemaVersion: 3 },
    },
    3,
    'export',
  ],
  [{ ...minimalLoop(), schemaVersion: 3 }, 3, 'definition'],
  [{ schemaVersion: 1 }, 1, 'definition'],
])('refuses a document in another format without converting it: %j', (input, found, document) => {
  let refusal: unknown;
  try {
    importLoop(input);
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(LoopFormatUnsupportedError);
  expect(refusal).toMatchObject({
    code: 'LOOP_FORMAT_UNSUPPORTED',
    foundFormat: found,
    message: `This loop ${document} is format ${String(found)}; this build reads only format ${String(CURRENT_DEFINITION_FORMAT)} and does not convert other formats. Re-create the loop in this build, or export it again from a build that writes format ${String(CURRENT_DEFINITION_FORMAT)}.`,
    details: { foundFormat: found, requiredFormat: CURRENT_DEFINITION_FORMAT },
  });
});

it('reports documents without a recognisable format as invalid imports', () => {
  for (const input of [
    { format: 'other', formatVersion: 9 },
    { format: 'graphgoblin-loop', formatVersion: CURRENT_DEFINITION_FORMAT, loop: 'not a loop' },
    { schemaVersion: 'four' },
    null,
  ])
    expect(() => importLoop(input)).toThrow(LoopImportError);
});
