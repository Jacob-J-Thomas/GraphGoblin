import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InferenceConfigSchema } from './nodes.js';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from './loop.js';
import { minimalLoop } from './testing/index.js';

describe('inference text capture contract', () => {
  it('preserves omitted capture and permits explicit auto or text capture', () => {
    const base = { prompt: { template: 'Answer' } };
    const omitted = InferenceConfigSchema.parse(base);
    expect(omitted.output).not.toHaveProperty('capture');
    expect(z.encode(InferenceConfigSchema, omitted).output).not.toHaveProperty('capture');
    expect(
      InferenceConfigSchema.parse({ ...base, output: { capture: 'auto' } }).output.capture,
    ).toBe('auto');
    expect(
      InferenceConfigSchema.parse({ ...base, output: { capture: 'text' } }).output.capture,
    ).toBe('text');
    expect(
      InferenceConfigSchema.safeParse({
        ...base,
        output: { capture: 'text', schema: { jsonSchema: {} } },
      }).success,
    ).toBe(false);
    expect(
      InferenceConfigSchema.safeParse({ ...base, output: { capture: 'unsupported' } }).success,
    ).toBe(false);
  });
  it('continues to refuse an older definition format', () => {
    expect(
      LoopDefinitionSchema.safeParse({
        ...minimalLoop(),
        schemaVersion: CURRENT_DEFINITION_FORMAT - 1,
      }).success,
    ).toBe(false);
  });
});
