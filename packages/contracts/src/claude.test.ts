import { describe, expect, it } from 'vitest';
import {
  DecisionEvaluationSchema,
  HarnessPreflightSchema,
  ClaudeModelCapabilitySchema,
  HarnessDefaultsSchema,
  HarnessIdSchema,
  InferenceConfigSchema,
} from './index.js';
const config = { harness: 'claude', prompt: { template: 'Return a result.' } };
describe('Claude inference contract', () => {
  it('admits exact harness families and strict independent defaults', () => {
    expect(HarnessIdSchema.parse('claude')).toBe('claude');
    expect(HarnessIdSchema.safeParse('other').success).toBe(false);
    expect(
      HarnessDefaultsSchema.parse({
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
        },
      }).byHarness.claude?.effort,
    ).toBe('xhigh');
    expect(
      HarnessDefaultsSchema.safeParse({ byHarness: { claude: { extra: true } } }).success,
    ).toBe(false);
    expect(HarnessDefaultsSchema.safeParse({ byHarness: { other: {} } }).success).toBe(false);
  });
  it.each(['read-only', 'danger-full-access'])(
    'admits only explicit supported %s/never policy',
    (sandbox) => {
      expect(
        InferenceConfigSchema.parse({
          ...config,
          harnessOptions: {
            sandbox,
            approval: 'never',
            networkAccess: true,
            webSearch: false,
            configOverrides: {},
          },
          capabilities: { mcpServers: [], plugins: [], skills: [] },
        }).harnessOptions.sandbox,
      ).toBe(sandbox);
    },
  );
  it.each([
    [{}, 'harnessOptions.sandbox'],
    [{ harnessOptions: { sandbox: 'workspace-write' } }, 'harnessOptions.sandbox'],
    [
      { harnessOptions: { sandbox: 'read-only', approval: 'on-request' } },
      'harnessOptions.approval',
    ],
    [
      { harnessOptions: { sandbox: 'danger-full-access', approval: 'on-request' } },
      'harnessOptions.approval',
    ],
    [
      { harnessOptions: { sandbox: 'read-only', networkAccess: false } },
      'harnessOptions.networkAccess',
    ],
    [{ harnessOptions: { sandbox: 'read-only', webSearch: true } }, 'harnessOptions.webSearch'],
    [
      { harnessOptions: { sandbox: 'read-only', configOverrides: { tools: 'Bash' } } },
      'harnessOptions.configOverrides',
    ],
    [
      { harnessOptions: { sandbox: 'read-only' }, capabilities: { mcpServers: ['server'] } },
      'capabilities.mcpServers',
    ],
    [
      { harnessOptions: { sandbox: 'read-only' }, capabilities: { plugins: ['plugin'] } },
      'capabilities.plugins',
    ],
    [
      { harnessOptions: { sandbox: 'read-only' }, capabilities: { skills: ['skill'] } },
      'capabilities.skills',
    ],
  ])('refuses unsupported policy at %s', (extra, path) => {
    const parsed = InferenceConfigSchema.safeParse({ ...config, ...extra });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(path);
  });
  it('preserves Codex policy and Codex-only Choice evaluation', () => {
    expect(InferenceConfigSchema.parse({ prompt: { template: 'Hi' } }).harnessOptions.sandbox).toBe(
      'workspace-write',
    );
    expect(DecisionEvaluationSchema.safeParse({ kind: 'llm', harness: 'claude' }).success).toBe(
      false,
    );
  });
});

describe('Claude public readiness contracts', () => {
  it('exposes technical model capabilities and rejects removed fields on current responses', () => {
    const model = { model: 'claude-fable-5-1', efforts: ['high'] };
    expect(ClaudeModelCapabilitySchema.parse(model)).toEqual(model);
    const preflight = {
      ok: false,
      version: '2.1.287',
      authenticated: true,
      problems: ['Missing --restricted'],
      authMethod: 'claude.ai',
      models: [model],
    };
    expect(HarnessPreflightSchema.parse(preflight)).toEqual(preflight);
    expect(
      ClaudeModelCapabilitySchema.safeParse({ ...model, admission: 'supported' }).success,
    ).toBe(false);
    expect(
      HarnessPreflightSchema.safeParse({ ...preflight, billingMode: 'claude.ai-account' }).success,
    ).toBe(false);
  });
});
