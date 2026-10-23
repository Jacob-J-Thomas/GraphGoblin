import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@graphgoblin/api/testing';
import { createGraphGoblinClient, loops, templates, type GraphGoblinClient } from './index.js';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
async function setup(): Promise<GraphGoblinClient> {
  app = await createTestApp();
  await app.app.listen({ port: 0, host: '127.0.0.1' });
  return createGraphGoblinClient({
    baseUrl: `http://127.0.0.1:${(app.app.server.address() as AddressInfo).port}`,
  });
}

it('creates an ordinary editable draft with the generated client without automation setup', async () => {
  const client = await setup();
  app!.harness.preflightResult = {
    state: 'unknown',
    ok: false,
    authenticated: false,
    problems: ['not configured'],
  };
  const first = await templates.createDraft(client, 'review');
  const second = await templates.createDraft(client, 'review', { name: 'My editable review' });
  expect(first.loop.id).not.toBe(second.loop.id);
  expect(second.loop.name).toBe('My editable review');
  const detail = await loops.get(client, first.loop.id);
  expect(detail.current).toBeUndefined();
  expect(detail.draft?.status).toBe('draft');
  expect(detail).not.toHaveProperty('templateInstanceId');
  expect(detail.draft?.definition.nodes.filter((node) => node.kind === 'inference')).toHaveLength(
    2,
  );
  await expect(templates.createDraft(client, 'absent-template')).rejects.toMatchObject({
    code: 'TEMPLATE_NOT_FOUND',
    status: 404,
  });
  expect(app!.harness.started).toHaveLength(0);
});

it('reads manifest-only catalogue entries through the generated API', async () => {
  const client = await setup();
  const entries = await templates.list(client);
  expect(entries).toHaveLength(4);
  expect(await templates.get(client, 'starter')).toEqual(entries[0]);
  expect(Object.keys(entries[0]!)).toEqual(['manifest']);
  await expect(templates.get(client, 'absent-template')).rejects.toMatchObject({
    status: 404,
    code: 'TEMPLATE_NOT_FOUND',
  });
});
