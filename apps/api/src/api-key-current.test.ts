import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyListResponseSchema, type ApiKeyListResponse } from '@graphgoblin/contracts';
import { buildApp } from './app.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
afterEach(async () => {
  await t.close();
});

async function seed() {
  const a = await t.container.repos.apiKeys.create('local', 'A', ['*']);
  const response = await t.app.inject({
    method: 'POST',
    url: '/api-keys',
    headers: { authorization: `Bearer ${a.token}` },
    payload: { label: 'current=true', current: true, scopes: ['api-keys:write'] },
  });
  expect(response.statusCode).toBe(201);
  const b = response.json<{ key: { id: string }; token: string }>();
  expect(b.key).not.toHaveProperty('current');
  const revoked = await t.container.repos.apiKeys.create('local', 'revoked', ['*']);
  await t.container.repos.apiKeys.revoke('local', revoked.record.id);
  const foreign = await t.container.repos.apiKeys.create('other-owner', 'foreign', ['*']);
  return { a, b, revoked, foreign };
}

async function list(token?: string) {
  const response = await t.app.inject({
    method: 'GET',
    url: '/api-keys',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<ApiKeyListResponse>();
  expect(ApiKeyListResponseSchema.parse(body)).toEqual(body);
  return body.items;
}

describe('current API key in required-key mode', () => {
  beforeEach(async () => {
    t = await createTestApp({ requireApiKey: true });
  });

  it('flags exactly the authenticated key for two clients, with revoked and foreign-owner records', async () => {
    const { a, b, revoked, foreign } = await seed();
    for (const client of [
      { token: a.token, id: a.record.id },
      { token: b.token, id: b.key.id },
    ]) {
      const items = await list(client.token);
      expect(items.map((key) => key.id).sort()).toEqual(
        [a.record.id, b.key.id, revoked.record.id].sort(),
      );
      expect(items.filter((key) => key.current).map((key) => key.id)).toEqual([client.id]);
      expect(items.find((key) => key.id === revoked.record.id)).toMatchObject({
        current: false,
        revokedAt: expect.any(String),
      });
      for (const key of items) {
        expect(key).not.toHaveProperty('token');
        expect(key).not.toHaveProperty('hash');
      }
      const serialized = JSON.stringify(items);
      for (const token of [a.token, b.token, revoked.token, foreign.token])
        expect(serialized).not.toContain(token);
    }
    expect((await list(foreign.token)).map((key) => [key.id, key.current])).toEqual([
      [foreign.record.id, true],
    ]);
    const stored = await t.container.repos.apiKeys.list('local');
    for (const key of stored) expect(key).not.toHaveProperty('current');
    expect(
      (
        await t.app.inject({
          url: '/api-keys',
          headers: { authorization: `Bearer ${revoked.token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect((await t.app.inject('/api-keys')).statusCode).toBe(401);
  });

  it.each(['header', 'query', 'body', 'label', 'client'] as const)(
    'cannot spoof current with a %s',
    async (source) => {
      const { a, b } = await seed();
      const response = await t.app.inject({
        method: 'GET',
        url: source === 'query' ? `/api-keys?current=true&id=${b.key.id}` : '/api-keys',
        headers: {
          authorization: `Bearer ${a.token}`,
          ...(source === 'header'
            ? { current: 'true', 'x-api-key-id': b.key.id, 'x-current-api-key': b.key.id }
            : {}),
          ...(source === 'client' ? { 'x-graphgoblin-client': b.key.id } : {}),
        },
        ...(source === 'body' ? { payload: { current: true, id: b.key.id } } : {}),
      });
      expect(response.statusCode).toBe(200);
      const items = response.json<ApiKeyListResponse>().items;
      expect(items.filter((key) => key.current).map((key) => key.id)).toEqual([a.record.id]);
      expect(items.find((key) => key.id === b.key.id)).toMatchObject({
        label: 'current=true',
        current: false,
      });
    },
  );

  it('flags nothing for a non-key actor, even when its id matches a key', async () => {
    const { a } = await seed();
    const app = await buildApp(t.container, { logger: false });
    app.addHook('preHandler', (request, _reply, done) => {
      request.auth.actor = { kind: 'user', id: a.record.id };
      done();
    });
    try {
      const response = await app.inject({
        url: '/api-keys',
        headers: { authorization: `Bearer ${a.token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<ApiKeyListResponse>().items.every((key) => key.current === false)).toBe(
        true,
      );
    } finally {
      await app.close();
    }
  });
});

describe('current API key in trusted mode', () => {
  beforeEach(async () => {
    t = await createTestApp();
  });
  it('flags nothing with or without a valid bearer key', async () => {
    const { a, b } = await seed();
    for (const token of [undefined, a.token, b.token]) {
      const items = await list(token);
      expect(items).toHaveLength(3);
      expect(items.every((key) => key.current === false)).toBe(true);
    }
  });
});
