import { describe, expect, it } from 'vitest';
import { contextOverflow, contextProfile, OLLAMA_CONTEXT_PROFILE } from './context.js';
import { qwenContextDetail } from './context-fixture.js';

const version = { version: '0.32.15' };
describe('qualified conservative Ollama context admission', () => {
  it('uses a bounded allocation distinct from advertised maximum, including wrapper and output reserve', () => {
    const window = contextProfile(qwenContextDetail, version).window();
    expect(window).toMatchObject({
      contextTokens: 4096,
      outputReserveTokens: 1024,
      profile: OLLAMA_CONTEXT_PROFILE,
    });
    expect(window.fits('a'.repeat(2560))).toBe(true);
    expect(window.fits('a'.repeat(2561))).toBe(false);
    expect(window.fits('🦎'.repeat(640))).toBe(true);
    expect(window.fits('🦎'.repeat(641))).toBe(false);
  });
  it('budgets native schema bytes and caps the selected allocation by the model maximum', () => {
    const profile = contextProfile(
      {
        ...qwenContextDetail,
        model_info: { ...qwenContextDetail.model_info, 'qwen35.context_length': 2048 },
      },
      version,
    );
    expect(profile.contextTokens).toBe(2048);
    const schema = { type: 'object', description: '🦎' };
    const window = profile.window(schema);
    const available = 2048 - 1024 - 512 - Buffer.byteLength(JSON.stringify(schema));
    expect(window.fits('a'.repeat(available))).toBe(true);
    expect(window.fits('a'.repeat(available + 1))).toBe(false);
  });
  it.each([
    null,
    { ...qwenContextDetail, template: '{{ range .Messages }}repeat{{ end }}' },
    { ...qwenContextDetail, renderer: 'qwen3.5' },
    { ...qwenContextDetail, system: 'Hidden instructions' },
    { ...qwenContextDetail, messages: [{ role: 'system', content: 'Hidden' }] },
    { ...qwenContextDetail, messages: 'invalid' },
    { ...qwenContextDetail, model_info: {} },
    {
      ...qwenContextDetail,
      model_info: { ...qwenContextDetail.model_info, 'general.architecture': 'unknown' },
    },
    {
      ...qwenContextDetail,
      model_info: { ...qwenContextDetail.model_info, 'tokenizer.ggml.model': 'llama' },
    },
    {
      ...qwenContextDetail,
      model_info: { ...qwenContextDetail.model_info, 'tokenizer.ggml.pre': 'unknown' },
    },
    {
      ...qwenContextDetail,
      model_info: { ...qwenContextDetail.model_info, 'qwen35.context_length': 1024 },
    },
    {
      ...qwenContextDetail,
      model_info: { ...qwenContextDetail.model_info, 'qwen35.context_length': '4096' },
    },
  ])('refuses unknown capacity/tokenizer/defaults rather than guessing: %j', (detail) => {
    expect(() => contextProfile(detail, version)).toThrow(/no supported context-admission profile/);
  });
  it('requires the qualified runtime and reports required-input overflow as not submitted', () => {
    for (const unsupported of [null, {}, { version: 'future' }])
      expect(() => contextProfile(qwenContextDetail, unsupported)).toThrow(/no supported/);
    expect(contextOverflow()).toMatchObject({
      code: 'HARNESS_CONTEXT_LIMIT',
      submission: 'definitely-not-submitted',
      retriable: false,
    });
    expect(
      contextProfile({ ...qwenContextDetail, system: '', messages: [] }, version).contextTokens,
    ).toBe(4096);
  });
});
