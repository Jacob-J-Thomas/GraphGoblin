import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  V3DecisionConfigSchema,
  V3ContextThreadSchema,
  V3InvocationSchema,
  V3LoopDefinitionSchema,
  V3LoopExportSchema,
  V3PollItemsSchema,
  V3RunEventSchema,
  V3RunRecordSchema,
  V3WebhookConfigSchema,
} from '@graphgoblin/contracts';
import { minimalLoopV3, sampleThreadV3 } from './__fixtures__/upgrade-v3.js';

const schemas = {
  LoopDefinitionSchema: V3LoopDefinitionSchema,
  LoopExportSchema: V3LoopExportSchema,
  ContextThreadSchema: V3ContextThreadSchema,
  InvocationSchema: V3InvocationSchema,
  RunEventSchema: V3RunEventSchema,
  RunRecordSchema: V3RunRecordSchema,
  WebhookConfigSchema: V3WebhookConfigSchema,
  PollItemsSchema: V3PollItemsSchema,
} as const;

/** Inputs and complete parse-result hashes recorded from live contracts at 12e5b87. */
const capture = JSON.parse(
  readFileSync(new URL('./upgrade-v3-fixtures.json', import.meta.url), 'utf8'),
) as {
  revision: string;
  cases: {
    schema: keyof typeof schemas;
    name: string;
    input: unknown;
    success: boolean;
    sha256: string;
  }[];
};

function parse(
  schema: {
    safeParse(
      input: unknown,
    ): { success: true; data: unknown } | { success: false; error: { issues: unknown } };
  },
  input: unknown,
) {
  const result = schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: result.error.issues };
}

describe('frozen format-3 fixture parity', () => {
  // The raw fixtures include minimalLoop, kitchenSinkLoop, everyFieldLoop, sampleThread,
  // sampleInvocation and run/event/webhook cases from contracts tests. They are pinned data,
  // not calls to fixture factories that will move to format 4.
  it.each(capture.cases)('matches the 12e5b87 capture for $schema: $name', (fixture) => {
    expect(capture.revision).toBe('12e5b87');
    const result = parse(schemas[fixture.schema], fixture.input);
    expect(result.success).toBe(fixture.success);
    expect(createHash('sha256').update(JSON.stringify(result)).digest('hex')).toBe(fixture.sha256);
  });

  it('keeps historical fixture factories equal to captured inputs and independently mutable', () => {
    const minimal = capture.cases.find(
      (fixture) => fixture.schema === 'LoopDefinitionSchema' && fixture.name === 'minimal',
    );
    const thread = capture.cases.find(
      (fixture) => fixture.schema === 'ContextThreadSchema' && fixture.name === 'sample thread',
    );
    expect(minimalLoopV3()).toEqual(minimal?.input);
    expect(sampleThreadV3()).toEqual(thread?.input);
    const loopCopy = minimalLoopV3();
    const threadCopy = sampleThreadV3();
    loopCopy.nodes.splice(0);
    threadCopy.vars.changed = true;
    expect(minimalLoopV3()).toEqual(minimal?.input);
    expect(sampleThreadV3()).toEqual(thread?.input);
  });

  it.each([
    {
      kind: 'expression',
      jsonata: '"done"',
      routes: [
        { id: 'done', label: 'Done' },
        { id: 'repeat', label: 'Repeat' },
      ],
    },
    {
      kind: 'llm',
      instructions: 'Choose done when all checks passed, otherwise repeat.',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      routes: [
        { id: 'done', label: 'Done' },
        { id: 'repeat', label: 'Repeat' },
      ],
    },
    {
      kind: 'classifier',
      model: 'jev',
      question: 'Choose',
      answer: {
        type: 'choice',
        options: [
          { id: 'done', label: 'Done', criteria: 'All checks passed' },
          { id: 'repeat', label: 'Repeat', criteria: 'Checks remain' },
        ],
      },
    },
  ])('refuses evaluator-specific $kind configs in frozen V3', (config) => {
    expect(V3DecisionConfigSchema.safeParse(config).success).toBe(false);
    const loop = minimalLoopV3();
    expect(
      V3LoopDefinitionSchema.safeParse({
        ...loop,
        nodes: [...loop.nodes, { id: 'decide', kind: 'decision', label: 'Decide', config }],
      }).success,
    ).toBe(false);
  });
});
