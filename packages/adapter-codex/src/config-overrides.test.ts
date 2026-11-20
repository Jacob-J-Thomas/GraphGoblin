import { describe, expect, it } from 'vitest';
import { clientOptions } from './options.js';

describe('authored Codex override admission (#429)', () => {
  it('keeps ordinary tables and dotted overrides in the effective configuration', () => {
    const result = clientOptions(
      {
        sandbox: 'read-only',
        approval: 'never',
        configOverrides: {
          service_tier: 'fast',
          features: { plugins: false },
          'sandbox_workspace_write.network_access': false,
          list: [1, { 'team-docs': { enabled: true } }],
          toString: 'ordinary key',
        },
      },
      undefined,
      undefined,
    );
    expect(result.config).toMatchObject({
      service_tier: 'fast',
      features: { plugins: false, apps: false, memories: false, hooks: false },
      sandbox_workspace_write: { network_access: false },
      list: [1, { 'team-docs': { enabled: true } }],
      toString: 'ordinary key',
      notify: [],
    });
  });

  it.each([
    JSON.parse('{"__proto__":{"enabled":true}}') as Record<string, unknown>,
    { 'features.constructor.enabled': true },
    { features: { prototype: false } },
    { 'features..plugins': false },
    { list: [false, { 'not plain': true }] },
  ])('refuses an invalid authored key before client construction: %j', (configOverrides) => {
    expect(() =>
      clientOptions(
        { sandbox: 'read-only', approval: 'never', configOverrides },
        undefined,
        undefined,
      ),
    ).toThrow(expect.objectContaining({ code: 'HARNESS_INVALID_CONFIGURATION', retriable: false }));
  });
});
