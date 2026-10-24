import { expect, it } from 'vitest';
import { createTestApp } from '../testing/test-app.js';

it('exposes the actual process defaults separately from owner overrides', async () => {
  const defaults = { byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } } };
  const target = await createTestApp({ env: { GG_DEFAULTS: JSON.stringify(defaults) } });
  try {
    await target.app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { defaults: { byHarness: { codex: { effort: 'low' } } } },
    });
    const result = await target.app.inject({ method: 'GET', url: '/system/model-defaults' });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(defaults);
  } finally {
    await target.close();
  }
});
