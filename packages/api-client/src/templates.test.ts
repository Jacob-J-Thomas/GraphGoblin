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

it('creates an ordinary editable draft with the generated client before automation setup', async () => {
  const client = await setup();
  app!.harness.preflightResult = { ok: false, authenticated: false, problems: ['not configured'] };
  const first = await templates.createDraft(client, 'review');
  const second = await templates.createDraft(client, 'review', { name: 'My editable review' });
  expect(first.loop.id).not.toBe(second.loop.id);
  expect(second.loop.name).toBe('My editable review');
  const detail = await loops.get(client, first.loop.id);
  expect(detail.current).toBeUndefined();
  expect(detail.draft?.status).toBe('draft');
  expect(detail.templateInstanceId).toBeUndefined();
  expect(detail.draft?.definition.nodes.filter((node) => node.kind === 'inference')).toHaveLength(
    2,
  );
  await expect(templates.createDraft(client, 'absent-template')).rejects.toMatchObject({
    code: 'TEMPLATE_NOT_FOUND',
    status: 404,
  });
  expect(app!.harness.started).toHaveLength(0);
});

it('instantiates independent starter drafts through the generated API and retains settings as data', async () => {
  const client = await setup();
  const entries = await templates.list(client);
  const listed = entries.find((entry) => entry.manifest.id === 'starter');
  expect(listed).toBeDefined();
  const entry = await templates.get(client, 'starter');
  expect(entry.manifest).toEqual(listed!.manifest);
  const defaults = entry.defaultSettings;
  if (defaults?.kind !== 'starter')
    throw new Error('The fake harness must supply starter defaults');
  const settings = {
    ...defaults,
    instruction: '{{ vars.secret }}; $(no_command); "quoted"',
    maxIterations: 7,
  };
  const report = await templates.prerequisites(client, 'starter', { settings });
  expect(report).toMatchObject({ canInstantiate: true, canRun: true });
  const first = await templates.instantiate(client, 'starter', {
    settings,
    name: 'Client-created draft',
  });
  const second = await templates.instantiate(client, 'starter', {
    settings,
    name: 'Client-created draft',
  });
  expect(first.prerequisites).toEqual(report);
  expect(second.instance.id).not.toBe(first.instance.id);
  expect(second.instance.parentLoopId).not.toBe(first.instance.parentLoopId);
  expect(await templates.instance(client, first.instance.id)).toEqual(first.instance);
  const detail = await loops.get(client, first.instance.parentLoopId);
  expect(detail.current).toBeUndefined();
  expect(detail.draft?.status).toBe('draft');
  expect(detail.draft?.definition.settings.maxIterations).toBe(7);
  const literal = detail.draft?.definition.nodes.find((node) => node.id === 'settings');
  expect(literal).toMatchObject({
    kind: 'mutate',
    config: {
      operations: [
        {
          op: 'set',
          path: '/vars/templateSettings',
          value: { kind: 'literal', value: settings },
        },
      ],
    },
  });
  expect(app!.harness.started).toHaveLength(0);
});

it('rechecks prerequisites at creation and propagates typed missing-template errors', async () => {
  const client = await setup();
  const entry = await templates.get(client, 'starter');
  if (entry.defaultSettings?.kind !== 'starter') throw new Error('Expected starter defaults');
  const settings = entry.defaultSettings;
  await expect(templates.prerequisites(client, 'starter', { settings })).resolves.toMatchObject({
    canInstantiate: true,
  });
  app!.harness.preflightResult = {
    ok: false,
    authenticated: false,
    problems: ['Synthetic account unavailable'],
  };
  const before = await loops.list(client);
  await expect(templates.instantiate(client, 'starter', { settings })).rejects.toMatchObject({
    status: 409,
    code: 'TEMPLATE_PREREQUISITES_MISSING',
  });
  expect(await loops.list(client)).toEqual(before);
  await expect(templates.get(client, 'absent-template')).rejects.toMatchObject({
    status: 404,
    code: 'TEMPLATE_NOT_FOUND',
  });
  expect(app!.harness.started).toHaveLength(0);
});
