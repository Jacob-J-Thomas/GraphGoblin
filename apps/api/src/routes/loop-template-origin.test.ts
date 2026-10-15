import { afterEach, describe, expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { LOCAL_OWNER } from '../container.js';
import { createTestApp, type TestApp } from '../testing/test-app.js';

describe('loop detail without template storage', () => {
  let app: TestApp | undefined;
  afterEach(async () => app?.close());

  it('omits the binding without reading template storage and retains the instance route', async () => {
    app = await createTestApp({ requireApiKey: true });
    const entry = await app.container.templates.entry(LOCAL_OWNER, 'starter');
    if (!entry.defaultSettings) throw new Error('missing starter defaults');
    const { instance } = await app.container.templates.instantiate(LOCAL_OWNER, 'starter', {
      settings: entry.defaultSettings,
    });
    const key = await app.container.repos.apiKeys.create(LOCAL_OWNER, 'reader', ['loops:read']);
    const headers = { authorization: 'Bearer ' + key.token };
    const binding = vi
      .spyOn(app.container.templates.store, 'bindingForLoop')
      .mockRejectedValue(new Error('unavailable'));
    const detail = await app.app.inject({
      method: 'GET',
      url: '/loops/' + instance.parentLoopId,
      headers,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      loop: { id: instance.parentLoopId },
    });
    expect(detail.json()).not.toHaveProperty('templateInstanceId');
    expect(binding).not.toHaveBeenCalled();
    const origin = await app.app.inject({
      method: 'GET',
      url: '/template-instances/' + instance.id,
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
