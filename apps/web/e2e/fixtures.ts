import {
  test as base,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

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

/**
 * Expand the editor's loop panel (the loop's name, description, settings, and variables) unless it
 * is already open. With nothing remembered it starts expanded at 1280 px and wider, collapsed below.
 */
export async function showLoopPanel(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /^(Show|Hide) loop settings$/ })).toBeVisible();
  const show = page.getByRole('button', { name: 'Show loop settings' });
  if (await show.isVisible()) await show.click();
  await expect(page.getByRole('button', { name: 'Hide loop settings' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
}

/** Open a node's editor by clicking its card (on the header band, away from port handles). */
export async function openNode(page: Page, nodeId: string) {
  await page.getByTestId(`node-${nodeId}`).click({ position: { x: 60, y: 12 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Expand the node editor's Advanced options (#14) unless they are open already, and return the
 * toggle. Advanced fields stay collapsed under it until then.
 */
export async function openAdvanced(scope: Page | Locator) {
  const toggle = scope.getByRole('button', { name: /^Advanced\b/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return toggle;
}

/** Expand a collapsed list item, such as "Operations 1" of a mutate node (#14). */
export async function openItem(scope: Page | Locator, name: string) {
  const toggle = scope.getByRole('button', { name: new RegExp(`^${name}\\b`) });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return toggle;
}

/** Close the open node editor with its Done button. */
export async function closeNode(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
