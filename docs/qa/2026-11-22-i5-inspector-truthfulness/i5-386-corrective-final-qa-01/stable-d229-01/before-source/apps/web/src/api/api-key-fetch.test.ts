import { afterEach, describe, expect, it } from 'vitest';
import { useApiKeyStore, withApiKey } from './api-key.js';

afterEach(() => useApiKeyStore.setState({ key: undefined, rejected: false }));

describe('API key rejection belongs to the request credentials', () => {
  it.each(['gg_A', undefined])('ignores a late 401 after changing from %s to B', async (key) => {
    useApiKeyStore.setState({ key });
    let finish!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const request = new Request('http://graphgoblin.test/api-keys');
    const pending = withApiKey(() => held)(request);
    expect(request.headers.get('authorization')).toBe(key ? `Bearer ${key}` : null);
    useApiKeyStore.setState({ key: 'gg_B', rejected: false });
    finish(new Response(null, { status: 401 }));
    expect((await pending).status).toBe(401);
    expect(useApiKeyStore.getState().rejected).toBe(false);
  });

  it.each(['Bearer gg_other', 'Basic other'])(
    'does not reject the stored key for explicit %s',
    async (authorization) => {
      useApiKeyStore.setState({ key: 'gg_stored' });
      const request = new Request('http://graphgoblin.test/api-keys', {
        headers: { authorization },
      });
      await withApiKey(() => Promise.resolve(new Response(null, { status: 401 })))(request);
      expect(request.headers.get('authorization')).toBe(authorization);
      expect(useApiKeyStore.getState().rejected).toBe(false);
    },
  );

  it.each([undefined, 'Bearer gg_stored', 'bearer   gg_stored'])(
    'rejects the matching stored key with header=%s',
    async (authorization) => {
      useApiKeyStore.setState({ key: 'gg_stored' });
      const request = new Request('http://graphgoblin.test/api-keys', {
        headers: authorization ? { authorization } : {},
      });
      await withApiKey(() => Promise.resolve(new Response(null, { status: 401 })))(request);
      expect(useApiKeyStore.getState().rejected).toBe(true);
    },
  );

  it.each([undefined, '', '   '])(
    'asks for a key on a current anonymous request, stored=%s',
    async (key) => {
      useApiKeyStore.setState({ key });
      await withApiKey(() => Promise.resolve(new Response(null, { status: 401 })))(
        new Request('http://graphgoblin.test/api-keys'),
      );
      expect(useApiKeyStore.getState().rejected).toBe(true);
    },
  );

  it('keeps the key accepted on a non-401 response', async () => {
    useApiKeyStore.setState({ key: 'gg_stored' });
    await withApiKey(() => Promise.resolve(new Response(null, { status: 403 })))(
      new Request('http://graphgoblin.test/api-keys'),
    );
    expect(useApiKeyStore.getState().rejected).toBe(false);
  });
});
