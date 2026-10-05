import { describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, LoopExportSchema, NodeConfigSchemas } from './index.js';
import { FIXTURE_TS, everyFieldLoop, kitchenSinkLoop, minimalLoop } from './testing/index.js';

/**
 * Parsing stays byte-for-byte the same while the schemas change around it (field metadata, say):
 * the golden files were written by the schemas before the change and are compared as JSON text,
 * so a change of key order, a default, or a dropped field fails here.
 */
const golden = (name: string) => `./__golden__/${name}.json`;
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The slice of a Zod 4 schema this test reads. */
interface Walkable {
  _zod: {
    def: {
      type: string;
      discriminator?: string;
      options?: Walkable[];
      shape?: Record<string, Walkable>;
      values?: unknown[];
    };
  };
}

describe('the every-field loop', () => {
  it('sets every config field of every node kind and subtype', () => {
    const nodes = everyFieldLoop().nodes;
    for (const [kind, schema] of Object.entries(NodeConfigSchemas)) {
      const def = (schema as unknown as Walkable)._zod.def;
      const configs = nodes
        .filter((node) => node.kind === kind)
        .map((node) => node.config as Record<string, unknown>);
      for (const option of def.options ?? [schema as unknown as Walkable]) {
        const shape = option._zod.def.shape ?? {};
        const tag = def.discriminator;
        const value = tag ? shape[tag]?._zod.def.values?.[0] : undefined;
        const set = new Set(
          configs.filter((config) => !tag || config[tag] === value).flatMap(Object.keys),
        );
        for (const key of Object.keys(shape))
          expect(set, `${kind} ${String(value)}`).toContain(key);
      }
    }
  });
});

describe('parsing is unchanged', () => {
  it.each([
    ['minimal', minimalLoop],
    ['kitchen-sink', kitchenSinkLoop],
    ['every-field', everyFieldLoop],
  ] as const)('parses the %s loop to the golden value', async (name, loop) => {
    await expect(text(LoopDefinitionSchema.parse(loop()))).toMatchFileSnapshot(
      golden(`loop-${name}`),
    );
  });

  it('parses an export envelope to the golden value', async () => {
    const envelope = {
      format: 'graphgoblin-loop',
      formatVersion: 1,
      exportedAt: FIXTURE_TS,
      loop: everyFieldLoop(),
    };
    await expect(text(LoopExportSchema.parse(envelope))).toMatchFileSnapshot(
      golden('export-every-field'),
    );
  });

  it('parses each node config left at its defaults to the golden value', async () => {
    const empty: Record<string, unknown> = {
      trigger: { subtype: 'manual' },
      decision: {
        routes: [
          { label: 'a', description: '' },
          { label: 'b', description: '' },
        ],
        question: '',
        strategy: ['codex'],
      },
      inference: { prompt: { template: '' } },
      script: { command: 'true' },
      mutate: { operations: [{ op: 'delete', path: '/vars/x' }] },
      subloop: { loopRef: { loopId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } },
      wait: { mode: 'duration', seconds: 1 },
      heartbeat: { intervalSeconds: 1, maxBeats: 1 },
      exit: {},
    };
    const parsed = Object.fromEntries(
      Object.entries(NodeConfigSchemas).map(([kind, schema]) => [kind, schema.parse(empty[kind])]),
    );
    await expect(text(parsed)).toMatchFileSnapshot(golden('config-defaults'));
  });
});
