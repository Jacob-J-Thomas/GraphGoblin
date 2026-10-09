import { afterEach, describe, expect, it } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { LOCAL_OWNER } from '../container.js';
import { createTestApp, type TestApp } from '../testing/test-app.js';

describe('owner-scoped loop template origin', () => {
  let app: TestApp | undefined;
  afterEach(async () => app?.close());

  it('returns the persisted instance ID with loops:read and resolves the existing instance route', async () => {
    app = await createTestApp({ requireApiKey: true });
    const entry = await app.container.templates.entry(LOCAL_OWNER, 'starter');
    if (!entry.defaultSettings) throw new Error('missing starter defaults');
    const { instance } = await app.container.templates.instantiate(LOCAL_OWNER, 'starter', {
      settings: entry.defaultSettings,
    });
    const key = await app.container.repos.apiKeys.create(LOCAL_OWNER, 'reader', ['loops:read']);
    const headers = { authorization: 'Bearer ' + key.token };
    const detail = await app.app.inject({
      method: 'GET',
      url: '/loops/' + instance.parentLoopId,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      templateInstanceId: instance.id,
      loop: { id: instance.parentLoopId },
    });
    const origin = await app.app.inject({
      method: 'GET',
      url:
        '/template-instances/' + detail.json<{ templateInstanceId: string }>().templateInstanceId,
      headers,
    });
    expect(origin.statusCode).toBe(200);
    expect(origin.json()).toEqual(instance);
  });

  it('does not infer a binding from an ordinary loop name or description', async () => {
    app = await createTestApp();
    const created = await app.app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: {
          ...minimalLoop(),
          name: 'Post-merge QA',
          description: 'qa template instance',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const loopId = created.json<{ loop: { id: string } }>().loop.id;
    const detail = await app.app.inject({ method: 'GET', url: '/loops/' + loopId });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).not.toHaveProperty('templateInstanceId');
  });

  it('refuses another owner’s loop and instance without exposing the origin ID', async () => {
    app = await createTestApp({ requireApiKey: true });
    const entry = await app.container.templates.entry('other', 'starter');
    if (!entry.defaultSettings) throw new Error('missing starter defaults');
    const { instance } = await app.container.templates.instantiate('other', 'starter', {
      settings: entry.defaultSettings,
    });
    const key = await app.container.repos.apiKeys.create(LOCAL_OWNER, 'reader', ['loops:read']);
    const headers = { authorization: 'Bearer ' + key.token };
    for (const url of ['/loops/' + instance.parentLoopId, '/template-instances/' + instance.id]) {
      const response = await app.app.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(404);
      expect(response.json()).not.toHaveProperty('templateInstanceId');
      expect(response.body).not.toContain(instance.id);
    }
  });
});
