import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('Ollama process configuration', () => {
  it('enables initial read-only local discovery without selecting a model', () => {
    const config = loadConfig({});
    expect(config.ollamaEnabled).toBe(true);
    expect(config.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(config.defaults.byHarness.ollama).toBeUndefined();
  });

  it.each(['false', '0', 'no'])('accepts explicit disabled discovery: %s', (value) => {
    expect(loadConfig({ GG_OLLAMA_ENABLED: value }).ollamaEnabled).toBe(false);
  });

  it.each(['true', '1', 'yes'])('accepts explicit enabled discovery: %s', (value) => {
    expect(loadConfig({ GG_OLLAMA_ENABLED: value }).ollamaEnabled).toBe(true);
  });

  it('canonicalizes the configured origin and retains an exact authored model identifier', () => {
    const config = loadConfig({
      GG_OLLAMA_URL: 'HTTPS://MODELS.EXAMPLE:443/',
      GG_DEFAULTS: JSON.stringify({
        byHarness: { ollama: { model: 'team/qwen3.5:9b-q4_K_M', effort: 'none' } },
      }),
    });
    expect(config.ollamaUrl).toBe('https://models.example');
    expect(config.defaults.byHarness.ollama).toEqual({
      model: 'team/qwen3.5:9b-q4_K_M',
      effort: 'none',
    });
  });

  it.each([
    '',
    'not a URL',
    'file:///private/model',
    'ftp://models.example',
    'http://user:secret@models.example',
    'http://models.example/api',
    'http://models.example/?token=secret',
    'http://models.example/#secret',
  ])('rejects an invalid or non-origin URL before composing services: %s', (value) => {
    expect(() => loadConfig({ GG_OLLAMA_URL: value })).toThrow(
      /invalid configuration: GG_OLLAMA_URL/,
    );
    expect(() => loadConfig({ GG_OLLAMA_ENABLED: 'false', GG_OLLAMA_URL: value })).toThrow(
      /GG_OLLAMA_URL/,
    );
  });

  it('rejects an invalid enablement value', () => {
    expect(() => loadConfig({ GG_OLLAMA_ENABLED: 'sometimes' })).toThrow(/GG_OLLAMA_ENABLED/);
  });
});
