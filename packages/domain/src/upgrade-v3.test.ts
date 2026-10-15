import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  InvocationSchema,
  LoopDefinitionSchema,
  LoopExportSchema,
  PollItemsSchema,
  RunEventSchema,
  RunRecordSchema,
  WebhookConfigSchema,
  V3ContextThreadSchema,
  V3InvocationSchema,
  V3LoopDefinitionSchema,
  V3LoopExportSchema,
  V3PollItemsSchema,
  V3RunEventSchema,
  V3RunRecordSchema,
  V3WebhookConfigSchema,
} from '@graphgoblin/contracts';

const schemas = {
  LoopDefinitionSchema: [LoopDefinitionSchema, V3LoopDefinitionSchema],
  LoopExportSchema: [LoopExportSchema, V3LoopExportSchema],
  ContextThreadSchema: [ContextThreadSchema, V3ContextThreadSchema],
  InvocationSchema: [InvocationSchema, V3InvocationSchema],
  RunEventSchema: [RunEventSchema, V3RunEventSchema],
  RunRecordSchema: [RunRecordSchema, V3RunRecordSchema],
  WebhookConfigSchema: [WebhookConfigSchema, V3WebhookConfigSchema],
  PollItemsSchema: [PollItemsSchema, V3PollItemsSchema],
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
    const result = parse(schemas[fixture.schema][1], fixture.input);
    expect(result.success).toBe(fixture.success);
    expect(createHash('sha256').update(JSON.stringify(result)).digest('hex')).toBe(fixture.sha256);
  });

  // When current contracts move to format 4, replace only this live comparison with the
  // expected current-format differences. Retain the capture tests, inputs and hashes above
  // as "frozen equals the 12e5b87 capture"; never refresh them from the changed contracts.
  it.each(capture.cases)('matches current contracts for $schema: $name', (fixture) => {
    const [current, frozen] = schemas[fixture.schema];
    expect(parse(frozen, fixture.input)).toEqual(parse(current, fixture.input));
  });
});
