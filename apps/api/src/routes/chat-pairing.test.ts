import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChatConversation,
  ChatPairingCreated,
  ChatPairingReadiness,
  ChatSession,
  ChatTurn,
} from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from '../testing/test-app.js';

let test: TestApp;
afterEach(async () => {
  await test?.close();
});
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function owner() {
  return test.container.repos.apiKeys.create('local', 'Owner', ['*']);
}
async function readiness(token: string, headers: Record<string, string> = {}) {
  return test.app.inject({
    url: '/chat/pairings/readiness',
    headers: { ...auth(token), ...headers },
  });
}
async function create(token: string, headers: Record<string, string> = {}) {
  return test.app.inject({
    method: 'POST',
    url: '/chat/pairings',
    payload: {},
    headers: { ...auth(token), ...headers },
  });
}

describe('pairing prerequisites and same-computer enrollment', () => {
  it('uses the real loopback listener port with no public URL, ignores hostile authority, and supports claim/chat/revoke', async () => {
    test = await createTestApp({
      requireApiKey: true,
      env: { GG_HOST: '127.0.0.1', GG_PORT: '0' },
    });
    await test.app.listen({ host: test.container.config.host, port: test.container.config.port });
    const key = await owner();
    const hostile = {
      host: 'evil.example:4444',
      forwarded: 'host=evil.example;proto=https',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    };
    const state = await readiness(key.token, hostile);
    expect(state.statusCode, state.body).toBe(200);
    const value = state.json<ChatPairingReadiness>();
    const address = test.app.server.address();
    expect(address && typeof address !== 'string').toBe(true);
    if (!address || typeof address === 'string') throw new Error('missing listener');
    expect(value).toMatchObject({
      ready: true,
      mode: 'same-machine',
      url: `http://127.0.0.1:${address.port}/goblin/`,
    });
    expect(value.url).not.toContain('#');
    expect(await test.container.repos.chat.listDevices('local')).toEqual([]);
    const enrollment = await create(key.token, hostile);
    expect(enrollment.statusCode, enrollment.body).toBe(201);
    const pairing = enrollment.json<ChatPairingCreated>();
    expect(pairing.url).toBe(`${value.url}#pair=${pairing.code}`);
    expect(pairing.url).not.toContain('evil.example');
    expect(Date.parse(pairing.expiresAt) - test.clock.now().getTime()).toBe(600_000);
    const token = `ggd_${randomBytes(32).toString('base64url')}`;
    const claim = {
      code: pairing.code,
      claimId: randomUUID(),
      deviceToken: token,
      label: 'This Mac browser',
    };
    const claimed = await test.app.inject({
      method: 'POST',
      url: '/chat/pairings/claim',
      payload: claim,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const deviceId = claimed.json<{ deviceId: string }>().deviceId;
    const session = await test.app.inject({ url: '/chat/session', headers: auth(token) });
    expect(session.json<ChatSession>()).toMatchObject({ audience: { kind: 'device', deviceId } });
    const devices = await test.container.repos.chat.listDevices('local');
    expect(devices).toHaveLength(1);
    expect(devices[0]?.loopId).toBe(
      (
        await test.container.repos.chat.getBinding({
          ownerId: 'local',
          audienceKey: `device:${deviceId}`,
        })
      )?.loopId,
    );
    expect((await readiness(token)).statusCode).toBe(403);
    const scoped = await test.container.repos.apiKeys.create('local', 'Read only', ['chat:read']);
    expect((await readiness(scoped.token)).statusCode).toBe(403);
    const conversation = await test.app.inject({
      method: 'POST',
      url: '/chat/conversations',
      payload: {},
      headers: auth(token),
    });
    expect(conversation.statusCode).toBe(201);
    const conversationId = conversation.json<ChatConversation>().id;
    test.harness.script([{ finalText: 'Hello from the device loop' }]);
    const turn = await test.app.inject({
      method: 'POST',
      url: `/chat/conversations/${conversationId}/turns`,
      headers: auth(token),
      payload: { requestId: randomUUID(), input: { kind: 'text', text: 'Hello' } },
    });
    expect(turn.statusCode, turn.body).toBe(202);
    await test.idle();
    const result = await test.app.inject({
      url: `/chat/turns/${turn.json<ChatTurn>().id}`,
      headers: auth(token),
    });
    expect(result.json<ChatTurn>()).toMatchObject({
      runStatus: 'succeeded',
      response: { reply: 'Hello from the device loop' },
    });
    expect(
      (
        await test.app.inject({
          method: 'POST',
          url: `/chat/devices/${deviceId}/revoke`,
          payload: {},
          headers: auth(key.token),
        })
      ).statusCode,
    ).toBe(200);
    expect((await test.app.inject({ url: '/chat/session', headers: auth(token) })).statusCode).toBe(
      401,
    );
    expect(
      (await test.app.inject({ method: 'POST', url: '/chat/pairings/claim', payload: claim }))
        .statusCode,
    ).toBe(401);
    expect((await test.container.repos.chat.listDevices('local'))[0]?.loopId).toBe(
      devices[0]?.loopId,
    );
  });

  it.each(['0.0.0.0', '::', '192.168.1.12', 'localhost.evil.example'])(
    'requires explicit HTTPS address for configured host %s',
    async (host) => {
      test = await createTestApp({ requireApiKey: true, env: { GG_HOST: host } });
      const key = await owner();
      const result = await readiness(key.token);
      expect(result.json()).toMatchObject({
        ready: false,
        mode: 'unavailable',
        code: 'CHAT_PAIRING_ADDRESS_REQUIRED',
      });
      expect((await create(key.token)).statusCode).toBe(409);
    },
  );

  it('refuses fallback when the real listener is not loopback even if configured host says loopback', async () => {
    test = await createTestApp({ requireApiKey: true });
    await test.app.listen({ host: '0.0.0.0', port: 0 });
    const key = await owner();
    expect((await readiness(key.token)).json()).toMatchObject({
      ready: false,
      code: 'CHAT_PAIRING_ADDRESS_REQUIRED',
    });
  });

  it.each([
    '',
    'http://phone.example',
    'https://u:p@gateway.example',
    'https://gateway.example/#pair=secret',
    'not a URL',
  ])('does not fall back from explicit invalid public URL %s', async (publicUrl) => {
    test = await createTestApp({ requireApiKey: true, env: { GG_PUBLIC_URL: publicUrl } });
    await test.app.listen({ host: '127.0.0.1', port: 0 });
    const key = await owner();
    expect((await readiness(key.token)).json()).toMatchObject({
      ready: false,
      code: 'CHAT_PAIRING_ADDRESS_INVALID',
    });
    expect((await create(key.token)).statusCode).toBe(409);
  });

  it('reports missing required authentication before code generation and preserves owner-only reads', async () => {
    test = await createTestApp();
    const key = await owner();
    const result = await readiness(key.token);
    expect(result.json()).toMatchObject({ ready: false, code: 'CHAT_PAIRING_AUTH_REQUIRED' });
    expect(result.json<ChatPairingReadiness>().message).toContain('GG_REQUIRE_API_KEY=true');
    expect((await create(key.token)).statusCode).toBe(409);
  });

  it('uses an explicit HTTPS address for network pairing without trusting request headers', async () => {
    test = await createTestApp({
      requireApiKey: true,
      env: { GG_HOST: '0.0.0.0', GG_PUBLIC_URL: 'https://gateway.home:9443' },
    });
    const key = await owner();
    expect((await readiness(key.token, { host: 'evil.example' })).json()).toMatchObject({
      ready: true,
      mode: 'network',
      url: 'https://gateway.home:9443/goblin/',
    });
    expect((await readiness('missing-key')).statusCode).toBe(401);
    expect((await test.app.inject('/chat/pairings/readiness')).statusCode).toBe(401);
  });
  it.each(['localhost', '::1'])(
    'uses an actual %s loopback listener and a correctly formatted URL',
    async (host) => {
      test = await createTestApp({ requireApiKey: true, env: { GG_HOST: host, GG_PORT: '0' } });
      await test.app.listen({ host, port: 0 });
      const key = await owner();
      const value = (await readiness(key.token)).json<ChatPairingReadiness>();
      const address = test.app.server.address();
      if (!address || typeof address === 'string') throw new Error('missing listener');
      expect(value).toMatchObject({
        ready: true,
        mode: 'same-machine',
        url: `http://${host === '::1' ? '[::1]' : host}:${address.port}/goblin/`,
      });
      expect((await create(key.token)).statusCode).toBe(201);
      const connected = await fetch(value.url!);
      expect(connected.status).toBeLessThan(500);
    },
  );
  it.each(['127.0.0.1', '0.0.0.0'])(
    'refuses non-loopback configured host while actually listening on %s',
    async (boundHost) => {
      test = await createTestApp({
        requireApiKey: true,
        env: { GG_HOST: '0.0.0.0', GG_PORT: '0' },
      });
      await test.app.listen({ host: boundHost, port: 0 });
      const key = await owner();
      expect((await readiness(key.token)).json()).toMatchObject({
        ready: false,
        code: 'CHAT_PAIRING_ADDRESS_REQUIRED',
      });
    },
  );
  it('labels an explicitly configured loopback HTTP URL as same-computer pairing', async () => {
    test = await createTestApp({
      requireApiKey: true,
      env: { GG_PUBLIC_URL: 'http://localhost:4747' },
    });
    const key = await owner();
    expect((await readiness(key.token)).json()).toMatchObject({
      ready: true,
      mode: 'same-machine',
      url: 'http://localhost:4747/goblin/',
    });
  });
});
