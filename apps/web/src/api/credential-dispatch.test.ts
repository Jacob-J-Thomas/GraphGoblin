import { GraphGoblinApiError, runs } from '@graphgoblin/api-client';
import { afterEach, describe, expect, it } from 'vitest';
import { currentCredential, useApiKeyStore } from './api-key.js';
import { createAppClient } from './context.js';
import {
  bindCredential,
  CredentialChangedError,
  expectedCredential,
  sendUnder,
} from './credential-dispatch.js';

afterEach(() => useApiKeyStore.getState().forget());

/** An app client over a recording fetch that answers every POST with an accepted run. */
function recordingClient() {
  const sent: Request[] = [];
  const client = createAppClient('http://graphgoblin.test', (request) => {
    sent.push(request);
    return Promise.resolve(Response.json({ run: { id: 'run-new' } }, { status: 202 }));
  });
  return { client, sent };
}

describe('credential-bound dispatch (#562)', () => {
  it('sends under the credential it was bound to, with the app client’s headers and key', async () => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = recordingClient();
    const bound = bindCredential(client, currentCredential());
    await runs.pause(bound, 'run-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('http://graphgoblin.test/runs/run-1/pause');
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer gg_A');
    expect(sent[0]!.headers.get('x-graphgoblin-client')).toBe('ui');
    expect(expectedCredential(sent[0]!)).toEqual(currentCredential());
  });

  it('refuses at the key read, after a middleware await the check before it cannot see', async () => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = recordingClient();
    const bound = bindCredential(client, currentCredential());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = false;
    // An awaited request step between the caller's own checks and the outgoing fetch.
    bound.use({
      onRequest: async () => {
        waiting = true;
        await held;
      },
    });
    const pending = runs.replay(bound, 'run-1', 'node', { observedSeq: 3 });
    await expect.poll(() => waiting).toBe(true);
    // Another tab stores a second key while the request waits.
    useApiKeyStore.getState().save('gg_B');
    release();
    const error = await pending.catch((caught: unknown) => caught);
    // The typed client reports what its fetch throws as a transport failure; it was never sent.
    expect(error).toBeInstanceOf(GraphGoblinApiError);
    expect((error as GraphGoblinApiError).cause).toBeInstanceOf(CredentialChangedError);
    expect(sent).toHaveLength(0);
  });

  it.each([
    [
      'the same key accepted again after a rejection',
      () => {
        useApiKeyStore.getState().markRejected();
        useApiKeyStore.getState().save('gg_A');
      },
    ],
    ['a rejection', () => useApiKeyStore.getState().markRejected()],
    ['forgetting the key', () => useApiKeyStore.getState().forget()],
    [
      'A→B→A',
      () => {
        useApiKeyStore.getState().save('gg_B');
        useApiKeyStore.getState().save('gg_A');
      },
    ],
  ])('sends nothing bound before %s', async (_name, change) => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = recordingClient();
    const credential = currentCredential();
    change();
    await expect(
      sendUnder(client, credential, (bound) => runs.cancel(bound, 'run-1')),
    ).rejects.toBeInstanceOf(CredentialChangedError);
    expect(sent).toHaveLength(0);
  });

  it('keeps the credential when the accepted key is saved again', async () => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = recordingClient();
    const credential = currentCredential();
    useApiKeyStore.getState().save('gg_A');
    expect(currentCredential()).toEqual(credential);
    await sendUnder(client, credential, (bound) => runs.cancel(bound, 'run-1'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer gg_A');
  });

  it('sends a credential captured while rejected under that same rejected state', async () => {
    useApiKeyStore.getState().save('gg_A');
    useApiKeyStore.getState().markRejected();
    const { client, sent } = recordingClient();
    await sendUnder(client, currentCredential(), (bound) => runs.pause(bound, 'run-1'));
    expect(sent).toHaveLength(1);
  });

  it('leaves an unbound send and every other failure unchanged', async () => {
    useApiKeyStore.getState().save('gg_A');
    const { client, sent } = recordingClient();
    const credential = currentCredential();
    useApiKeyStore.getState().save('gg_B');
    // Without a credential the request is ordinary: it is sent with the current key.
    await sendUnder(client, undefined, (unbound) => runs.pause(unbound, 'run-1'));
    expect(sent.at(-1)!.headers.get('authorization')).toBe('Bearer gg_B');

    const offline = createAppClient('http://graphgoblin.test', () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    const transport = await sendUnder(offline, currentCredential(), (bound) =>
      runs.pause(bound, 'run-1'),
    ).catch((caught: unknown) => caught);
    expect(transport).toBeInstanceOf(GraphGoblinApiError);
    expect((transport as GraphGoblinApiError).status).toBe(0);

    const refused = createAppClient('http://graphgoblin.test', () =>
      Promise.resolve(
        Response.json({ status: 409, code: 'CONFLICT', detail: 'no' }, { status: 409 }),
      ),
    );
    const conflict = await sendUnder(refused, currentCredential(), (bound) =>
      runs.pause(bound, 'run-1'),
    ).catch((caught: unknown) => caught);
    expect((conflict as GraphGoblinApiError).code).toBe('CONFLICT');

    const own = new Error('caller');
    await expect(sendUnder(client, credential, () => Promise.reject(own))).rejects.toBe(own);
  });
});
