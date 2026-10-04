import { test as base, expect, type APIRequestContext } from '@playwright/test';

/** Tests run against the server global-setup started; its URL arrives through the environment. */
export const test = base.extend({
  // Playwright fixtures must destructure their dependencies, even when there are none.
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    const url = process.env['GG_E2E_BASE_URL'];
    if (!url) throw new Error('GG_E2E_BASE_URL is not set; the global setup did not run');
    await use(url);
  },
});

export { expect };

/** A manual trigger, a wait-for-input node, and an exit. */
export function approvalLoop(name: string) {
  return {
    schemaVersion: 1,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'approve',
        kind: 'wait',
        label: 'Approve',
        config: { mode: 'input', prompt: 'Approve?' },
        ui: { x: 260, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
      { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/** Drive the E2E server's control port, for example to script the fake harness. */
export async function control(request: APIRequestContext, path: string, body: unknown = {}) {
  const base = process.env['GG_E2E_CONTROL_URL'];
  if (!base) throw new Error('GG_E2E_CONTROL_URL is not set; the global setup did not run');
  const res = await request.post(`${base}${path}`, { data: body });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Record<string, unknown>;
}

/** Create and publish a loop through the API; returns its id. */
export async function publishLoop(
  request: APIRequestContext,
  definition: unknown,
): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const published = await request.post(`/loops/${loop.id}/publish`);
  expect(published.status()).toBe(200);
  return loop.id;
}
