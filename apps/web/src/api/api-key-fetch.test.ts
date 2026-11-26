import { afterEach, describe, expect, it } from 'vitest';
import { currentCredential, isCurrentCredential, useApiKeyStore, withApiKey } from './api-key.js';
import { createAppClient } from './context.js';
import { bindCredential, CredentialChangedError } from './credential-dispatch.js';

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

  it.each([false, true])(
    'ignores an old same-key 401 after recovery, independently of cancellation=%s',
    async (cancelled) => {
      useApiKeyStore.getState().save('gg_same');
      let finish!: (response: Response) => void;
      const held = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      const controller = new AbortController();
      const request = new Request('http://graphgoblin.test/api-keys', {
        signal: controller.signal,
      });
      const pending = withApiKey(() => held)(request);
      useApiKeyStore.getState().markRejected();
      useApiKeyStore.getState().save('gg_same');
      const recoveredGeneration = useApiKeyStore.getState().generation;
      if (cancelled) controller.abort();
      finish(new Response(null, { status: 401 }));
      expect((await pending).status).toBe(401);
      expect(useApiKeyStore.getState()).toMatchObject({
        key: 'gg_same',
        rejected: false,
        generation: recoveredGeneration,
      });
      // A request actually sent in the recovered generation still rejects that generation.
      await withApiKey(() => Promise.resolve(new Response(null, { status: 401 })))(
        new Request('http://graphgoblin.test/api-keys'),
      );
      expect(useApiKeyStore.getState()).toMatchObject({
        rejected: true,
        generation: recoveredGeneration + 1,
      });
    },
  );

  it('does not treat cancellation alone as a new credential generation', async () => {
    useApiKeyStore.getState().save('gg_same');
    const sentGeneration = useApiKeyStore.getState().generation;
    let finish!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const controller = new AbortController();
    const pending = withApiKey(() => held)(
      new Request('http://graphgoblin.test/api-keys', { signal: controller.signal }),
    );
    controller.abort();
    finish(new Response(null, { status: 401 }));
    await pending;
    expect(useApiKeyStore.getState()).toMatchObject({
      rejected: true,
      generation: sentGeneration + 1,
    });
  });

  it('ignores a retired anonymous 401 after a fresh anonymous credential generation', async () => {
    useApiKeyStore.getState().forget();
    let finish!: (response: Response) => void;
    const pending = withApiKey(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )(new Request('http://graphgoblin.test/api-keys'));
    useApiKeyStore.getState().markRejected();
    useApiKeyStore.getState().forget();
    const generation = useApiKeyStore.getState().generation;
    finish(new Response(null, { status: 401 }));
    await pending;
    expect(useApiKeyStore.getState()).toMatchObject({
      key: undefined,
      rejected: false,
      generation,
    });
  });

  it('keeps the key accepted on a non-401 response', async () => {
    useApiKeyStore.setState({ key: 'gg_stored' });
    await withApiKey(() => Promise.resolve(new Response(null, { status: 403 })))(
      new Request('http://graphgoblin.test/api-keys'),
    );
    expect(useApiKeyStore.getState().rejected).toBe(false);
  });
});

describe('a credential-bound request is compared where the key is read (#562)', () => {
  /** A request a bound client would send under `credential`, through `withApiKey`. */
  function bound(credential: { generation: number; rejected: boolean }) {
    let request!: Request;
    const client = bindCredential(
      createAppClient('http://graphgoblin.test', (sent) => {
        request = sent;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
      credential,
    );
    return { client, sent: () => request };
  }

  it('sends under the accepted credential it was bound to', async () => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = bound(currentCredential());
    expect(isCurrentCredential(currentCredential())).toBe(true);
    await client.POST('/runs/{id}/pause', { params: { path: { id: 'run-1' } } });
    expect(sent().headers.get('authorization')).toBe('Bearer gg_A');
  });

  it.each([
    ['an earlier generation', -1, false],
    ['the same generation in another accepted state', 0, true],
  ])('refuses %s before calling fetch', async (_name, offset, rejected) => {
    useApiKeyStore.getState().forget();
    const changed = { generation: useApiKeyStore.getState().generation + offset, rejected };
    expect(isCurrentCredential(changed)).toBe(false);
    const { client, sent } = bound(changed);
    await expect(
      client.POST('/runs/{id}/pause', { params: { path: { id: 'run-1' } } }),
    ).rejects.toMatchObject({ cause: expect.any(CredentialChangedError) });
    expect(sent()).toBeUndefined();
  });

  it('leaves an unbound request ordinary under any credential', async () => {
    useApiKeyStore.getState().save('gg_B');
    let sent: Request | undefined;
    await withApiKey((request) => {
      sent = request;
      return Promise.resolve(new Response(null, { status: 204 }));
    })(new Request('http://graphgoblin.test/runs/run-1/pause', { method: 'POST' }));
    expect(sent?.headers.get('authorization')).toBe('Bearer gg_B');
  });
});
