import { describe, expect, it } from 'vitest';
import {
  OllamaBaseUrlSchema,
  OllamaConnectionViewSchema,
  OllamaModelDiscoverySchema,
} from './ollama.js';
import { InferenceConfigSchema } from './nodes.js';
import { HarnessIdSchema } from './common.js';

const policy = {
  harness: 'ollama',
  prompt: { template: 'Hello' },
  harnessOptions: { sandbox: 'read-only', approval: 'never' },
};
describe('native Ollama contracts', () => {
  it('accepts exact harness identities, service origins and serializable discovery views', () => {
    expect(HarnessIdSchema.parse('ollama')).toBe('ollama');
    for (const url of [
      'http://127.0.0.1:11434',
      'https://models.example/',
      'HTTPS://MODELS.EXAMPLE:443/',
      'http://[::1]:11434',
    ])
      expect(OllamaBaseUrlSchema.safeParse(url).success).toBe(true);
    for (const url of [
      'file:///tmp/x',
      'http://user:secret@host',
      'http://host/api',
      'http://host?key=x',
      'http://host#secret',
      'not a url',
    ])
      expect(OllamaBaseUrlSchema.safeParse(url).success).toBe(false);
    const view = {
      connection: { enabled: true, baseUrl: 'http://localhost:11434', revision: 1 },
      discovery: { state: 'ready' as const, lastSuccessAt: '2026-11-07T00:00:00.000Z' },
    };
    expect(OllamaConnectionViewSchema.encode(view)).toEqual(view);
    expect(
      OllamaModelDiscoverySchema.parse({
        model: 'namespace/qwen:tag',
        digest: 'sha256:x',
        connectionRevision: 1,
        availability: { state: 'available', checkedAt: '2026-11-07T00:00:00.000Z' },
        thinkingByEffort: { none: false, high: 'high' },
      }).model,
    ).toBe('namespace/qwen:tag');
  });
  it('requires fresh text-only policy and disables same-session repair', () => {
    expect(InferenceConfigSchema.safeParse(policy).success).toBe(true);
    for (const change of [
      { session: { policy: 'resume-own' } },
      { harnessOptions: { sandbox: 'workspace-write', approval: 'on-request' } },
      {
        harnessOptions: {
          sandbox: 'read-only',
          approval: 'never',
          networkAccess: true,
          webSearch: true,
          configOverrides: { x: true },
        },
      },
      { capabilities: { skills: ['personal'], mcpServers: ['server'], plugins: ['plugin'] } },
      { contextFiles: [{ path: 'context.txt', template: 'text' }] },
      { output: { schema: { jsonSchema: {}, repair: { enabled: true } } } },
    ])
      expect(InferenceConfigSchema.safeParse({ ...policy, ...change }).success).toBe(false);
    expect(
      InferenceConfigSchema.safeParse({
        ...policy,
        harnessOptions: {
          ...policy.harnessOptions,
          networkAccess: false,
          webSearch: false,
          configOverrides: {},
        },
        capabilities: { skills: [] },
        contextFiles: [],
        output: { schema: { jsonSchema: {}, repair: { enabled: false } } },
      }).success,
    ).toBe(true);
  });
});
