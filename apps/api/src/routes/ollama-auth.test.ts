import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '../testing/test-app.js';

let testApp: TestApp;
beforeEach(async () => {
  testApp = await createTestApp({ requireApiKey: true });
});
afterEach(async () => {
  await testApp.close();
});

async function headers(scopes: string[]) {
  const key = await testApp.container.repos.apiKeys.create('local', scopes.join(','), scopes);
  return { authorization: `Bearer ${key.token}` };
}

describe('Ollama gateway settings authority', () => {
  it('maps the connection read to Settings scope rather than the harness System alias', async () => {
    const view = vi.spyOn(testApp.container.ollama, 'view');
    const url = '/harness/ollama/connection';
    expect((await testApp.app.inject(url)).statusCode).toBe(401);
    expect(
      (await testApp.app.inject({ url, headers: await headers(['system:read']) })).statusCode,
    ).toBe(403);
    expect(view).not.toHaveBeenCalled();
    for (const scopes of [['settings:read'], ['settings:write'], ['*']]) {
      const response = await testApp.app.inject({ url, headers: await headers(scopes) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ connection: { enabled: false } });
    }
    expect(view).toHaveBeenCalledTimes(3);
  });

  it('requires Settings write for refresh before parsing its body', async () => {
    const refresh = vi.spyOn(testApp.container.ollama, 'refresh');
    const input = { method: 'POST' as const, url: '/model-catalog/refresh' };
    expect((await testApp.app.inject({ ...input, payload: { invalid: true } })).statusCode).toBe(
      401,
    );
    expect(
      (
        await testApp.app.inject({
          ...input,
          headers: await headers(['settings:read']),
          payload: { invalid: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
    for (const scopes of [['settings:write'], ['*']]) {
      const response = await testApp.app.inject({
        ...input,
        headers: await headers(scopes),
        payload: { harness: 'ollama' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ state: 'idle' });
    }
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('requires wildcard gateway-owner authority for a connection change', async () => {
    const configure = vi.spyOn(testApp.container.ollama, 'configure');
    const input = { method: 'PUT' as const, url: '/harness/ollama/connection' };
    expect((await testApp.app.inject({ ...input, payload: { invalid: true } })).statusCode).toBe(
      401,
    );
    for (const scopes of [['settings:read'], ['settings:write'], ['system:write']])
      expect(
        (
          await testApp.app.inject({
            ...input,
            headers: await headers(scopes),
            payload: { invalid: true },
          })
        ).statusCode,
      ).toBe(403);
    expect(configure).not.toHaveBeenCalled();
    const payload = { enabled: false, baseUrl: 'https://models.example.test' };
    const response = await testApp.app.inject({ ...input, headers: await headers(['*']), payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ connection: { ...payload, revision: 2 } });
    expect(configure).toHaveBeenCalledExactlyOnceWith(payload);
  });
});
