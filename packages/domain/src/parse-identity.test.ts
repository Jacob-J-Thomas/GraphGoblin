import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  NodeConfigSchemas,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import { FIXTURE_TS, everyFieldLoop, kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { exportLoop, importLoop } from './loop-io.js';
import { findAuthoredSources } from './syntax.js';

/**
 * Exports, imports, and the authoring checks stay the same while the schemas change around them
 * (field metadata, say): the golden files were written before the change and are compared as
 * JSON text.
 */
const golden = (name: string) => `./__golden__/${name}.json`;
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function roundTrip(definition: LoopDefinition): LoopDefinition {
  const exported = JSON.parse(JSON.stringify(exportLoop(definition, FIXTURE_TS))) as unknown;
  return importLoop(exported).definition;
}

describe('exports and imports are unchanged', () => {
  it.each([
    ['kitchen-sink', kitchenSinkLoop],
    ['every-field', everyFieldLoop],
  ] as const)('round-trips the %s loop to the golden value', async (name, loop) => {
    const definition = LoopDefinitionSchema.parse(loop());
    const imported = roundTrip(definition);
    expect(imported).toEqual(definition);
    await expect(text(exportLoop(imported, FIXTURE_TS))).toMatchFileSnapshot(
      golden(`export-${name}`),
    );
  });

  it('finds the same templates and expressions in every config field', async () => {
    const definition = LoopDefinitionSchema.parse(everyFieldLoop());
    const found = definition.nodes.map((node) => ({
      node: node.id,
      sources: findAuthoredSources(NodeConfigSchemas[node.kind], node.config),
    }));
    await expect(text(found)).toMatchFileSnapshot(golden('authored-sources'));
  });
});
