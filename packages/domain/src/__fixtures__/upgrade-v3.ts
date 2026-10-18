import { readFileSync } from 'node:fs';
import {
  V3ContextThreadSchema,
  type V3ContextThread,
  type V3LoopDefinitionInput,
} from '@graphgoblin/contracts';

// Historical stage inputs must not follow the current-format fixture factories.
const capture = JSON.parse(
  readFileSync(new URL('../upgrade-v3-fixtures.json', import.meta.url), 'utf8'),
) as { cases: { schema: string; name: string; input: unknown }[] };
const thread = V3ContextThreadSchema.parse(
  capture.cases.find(
    (fixture) => fixture.schema === 'ContextThreadSchema' && fixture.name === 'sample thread',
  )?.input,
);

/** Raw format-3 input, including the omitted defaults in the original minimal fixture. */
export function minimalLoopV3(): V3LoopDefinitionInput {
  return {
    schemaVersion: 3,
    name: 'minimal',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

/** Fresh copy of the stopped-store thread captured at 12e5b87. */
export function sampleThreadV3(): V3ContextThread {
  return structuredClone(thread);
}
