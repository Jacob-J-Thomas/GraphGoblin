import { describe, expect, it } from 'vitest';
import { HarnessOptionsSchema } from '@graphgoblin/contracts';
import { claudePolicy, policyArgs, resolvedClaudeSettings } from './policy.js';
const options = (sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' = 'read-only') =>
  HarnessOptionsSchema.parse({ sandbox, approval: 'never' });
describe('approved native Windows Claude policy', () => {
  it('exposes exactly the verified read-only tools without an OS confinement claim', () => {
    const policy = claudePolicy(options(), undefined, 'win32');
    expect(policy).toMatchObject({
      sandbox: 'read-only',
      approval: 'never',
      billingMode: 'claude.ai-account',
      authMethod: 'claude.ai',
      boundary: 'builtin-tools',
      tools: ['Read', 'Glob', 'Grep'],
    });
    expect(policyArgs(policy)).toEqual([
      '--safe-mode',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--restricted',
      '--tools',
      'Read,Glob,Grep',
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
    ]);
  });
  it('uses dontAsk plus explicit allowed full-access tools, never bypass or restricted', () => {
    const policy = claudePolicy(
      options('danger-full-access'),
      { mcpServers: [], plugins: [], skills: [] },
      'win32',
    );
    const args = policyArgs(policy);
    expect(policy.boundary).toBe('unconfined');
    expect(args).toContain('Read,Glob,Grep,Edit,Write,Bash(*)');
    expect(args).not.toContain('--restricted');
    expect(args.join(' ')).not.toMatch(/bypass|bare|skip-permission/);
  });
  it.each(['read-only', 'workspace-write', 'danger-full-access'] as const)(
    'rejects on-request %s',
    (sandbox) =>
      expect(() =>
        claudePolicy({ ...options(sandbox), approval: 'on-request' }, undefined, 'win32'),
      ).toThrow(/approval/),
  );
  it('rejects workspace-write, non-Windows assumptions, explicit network isolation and web search', () => {
    expect(() => claudePolicy(options('workspace-write'), undefined, 'win32')).toThrow(
      /workspace-write/,
    );
    expect(() => claudePolicy(options(), undefined, 'linux')).toThrow(/Windows/);
    expect(() => claudePolicy({ ...options(), networkAccess: false }, undefined, 'win32')).toThrow(
      /network/,
    );
    expect(() => claudePolicy({ ...options(), webSearch: true }, undefined, 'win32')).toThrow(
      /web search/,
    );
    expect(
      claudePolicy({ ...options(), networkAccess: true, webSearch: false }, undefined, 'win32')
        .tools,
    ).toHaveLength(3);
  });
  it('fails closed on customizations rather than ignoring them', () => {
    for (const capabilities of [
      { mcpServers: ['server'] },
      { plugins: ['plugin'] },
      { skills: ['skill'] },
    ])
      expect(() => claudePolicy(options(), capabilities, 'win32')).toThrow(/capabilit/);
    expect(() =>
      claudePolicy(
        { ...options(), configOverrides: { permissionMode: 'bypassPermissions' } },
        undefined,
        'win32',
      ),
    ).toThrow(/configuration/);
    expect(claudePolicy({ ...options(), configOverrides: {} }, {}, 'win32').sandbox).toBe(
      'read-only',
    );
  });
  it('binds the exact initial model and supported effort without a competing inheritance resolver', () => {
    expect(() => resolvedClaudeSettings({})).toThrow(/model/);
    expect(() => resolvedClaudeSettings({ model: 'claude-opus-5-5' })).toThrow(/effort/);
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const)
      expect(resolvedClaudeSettings({ model: 'claude-opus-5-5', effort }).effort).toBe(effort);
    for (const model of ['gpt-6-luna', 'opus', 'claude-sonnet-5', ''])
      expect(() => resolvedClaudeSettings({ model, effort: 'xhigh' })).toThrow(/model/);
    expect(() => resolvedClaudeSettings({ model: 'claude-opus-5-5', effort: 'minimal' })).toThrow(
      /effort/,
    );
  });
});

it('refuses invalid runtime option shapes before selecting a policy', () => {
  expect(() =>
    claudePolicy(
      Object.assign(HarnessOptionsSchema.parse({ sandbox: 'read-only' }), { extra: true }),
      undefined,
      'win32',
    ),
  ).toThrow(/configuration/);
  expect(() =>
    claudePolicy(
      HarnessOptionsSchema.parse({ sandbox: 'read-only' }),
      Object.assign({ mcpServers: [] }, { hooks: ['marker'] }),
      'win32',
    ),
  ).toThrow(/configuration/);
});
