import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;

afterEach(async () => {
  await t.close();
});

async function expectCreated(scopes: string[] | undefined, token?: string): Promise<void> {
  const response = await t.app.inject({
    method: 'POST',
    url: '/api-keys',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: { label: 'delegated', ...(scopes === undefined ? {} : { scopes }) },
  });
  expect(response.statusCode).toBe(201);
  const created = response.json<{ key: { ownerId: string; scopes: string[] }; token: string }>();
  expect(created.key).toMatchObject({ ownerId: 'local', scopes: scopes ?? ['*'] });
  const stored = await t.container.repos.apiKeys.authenticate(created.token);
  expect(stored?.scopes).toEqual(scopes ?? ['*']);
}

describe('API-key creation in local trusted mode', () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  it.each([
    { name: 'omitted scopes default to wildcard', scopes: undefined },
    { name: 'explicit wildcard', scopes: ['*'] },
    { name: 'arbitrary scopes', scopes: ['loops:write', 'runs:read', 'custom:write'] },
    { name: 'empty scopes', scopes: [] },
  ])('allows $name without credentials', async ({ scopes }) => {
    await expectCreated(scopes);
  });
});

describe('API-key creation by a wildcard caller', () => {
  beforeEach(async () => {
    t = await createTestApp({ requireApiKey: true });
  });

  it.each([
    { name: 'omitted scopes default to wildcard', scopes: undefined },
    { name: 'explicit wildcard', scopes: ['*'] },
    { name: 'arbitrary scopes', scopes: ['loops:write', 'runs:read', 'custom:write'] },
    { name: 'empty scopes', scopes: [] },
  ])('allows $name', async ({ scopes }) => {
    const caller = await t.container.repos.apiKeys.create('local', 'admin', ['*']);
    await expectCreated(scopes, caller.token);
  });

  it('recognizes wildcard alongside other scopes', async () => {
    const caller = await t.container.repos.apiKeys.create('local', 'admin', [
      'api-keys:write',
      '*',
    ]);
    await expectCreated(undefined, caller.token);
  });
});

describe.each([false, true])('scoped API-key delegation with requireApiKey=%s', (requireApiKey) => {
  let token: string;
  const callerScopes = ['api-keys:write', 'loops:write', 'runs:read'];

  beforeEach(async () => {
    t = await createTestApp({ requireApiKey });
    const caller = await t.container.repos.apiKeys.create('local', 'delegator', callerScopes);
    token = caller.token;
  });

  it.each([
    { name: 'a held subset', scopes: ['runs:read'] },
    { name: 'all held scopes', scopes: callerScopes },
    { name: 'read implied by write', scopes: ['loops:read', 'api-keys:read'] },
    { name: 'write and its implied read together', scopes: ['loops:write', 'loops:read'] },
    { name: 'an explicit empty list', scopes: [] },
  ])('allows $name', async ({ scopes }) => {
    await expectCreated(scopes, token);
  });

  it.each([
    {
      name: 'a superset with multiple unheld scopes',
      scopes: [...callerScopes, 'loops:read', 'secrets:write', 'settings:read'],
      offending: ['secrets:write', 'settings:read'],
    },
    { name: 'wildcard', scopes: ['*'], offending: ['*'] },
    { name: 'wildcard mixed with held scopes', scopes: ['api-keys:write', '*'], offending: ['*'] },
    { name: 'write when only read is held', scopes: ['runs:write'], offending: ['runs:write'] },
  ])('rejects $name without creating a key', async ({ scopes, offending }) => {
    const before = await t.container.repos.apiKeys.list('local');
    const response = await t.app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'forbidden', scopes },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = response.json<{ detail: string }>();
    expect(body).toMatchObject({
      type: 'https://graphgoblin.dev/problems/scope-not-delegable',
      status: 403,
      code: 'SCOPE_NOT_DELEGABLE',
      errors: { scopes: offending },
    });
    for (const scope of offending) expect(body.detail).toContain(scope);
    expect((await t.container.repos.apiKeys.list('local')).map((key) => key.id)).toEqual(
      before.map((key) => key.id),
    );
    expect(body).not.toHaveProperty('token');
  });

  it('requires scopes explicitly without creating a key', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'implicit wildcard' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.json()).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'scoped API keys must list scopes explicitly when creating a key',
      errors: [{ path: '/scopes', message: 'scopes is required for scoped API-key callers' }],
    });
    expect(await t.container.repos.apiKeys.list('local')).toHaveLength(1);
  });

  it('does not let api-keys:write alone create an administrative key', async () => {
    const caller = await t.container.repos.apiKeys.create('local', 'key manager', [
      'api-keys:write',
    ]);
    const response = await t.app.inject({
      method: 'POST',
      url: '/api-keys',
      headers: { authorization: `Bearer ${caller.token}` },
      payload: { label: 'admin', scopes: ['*', 'loops:write'] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'SCOPE_NOT_DELEGABLE',
      errors: { scopes: ['*', 'loops:write'] },
    });
    expect(await t.container.repos.apiKeys.list('local')).toHaveLength(2);
  });
});
