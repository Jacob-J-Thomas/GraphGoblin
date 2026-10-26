# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: issue-170-qa.spec.ts >> conflict inside Context JSON retains pending text; overwrite saves applied values; reload closes dialog
- Location: e2e\issue-170-qa.spec.ts:1079:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByTestId('node-approve').locator(':scope > div:has([data-kind])')

```

# Test source

```ts
  1   | import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
  2   | import {
  3   |   test as base,
  4   |   expect,
  5   |   type APIRequestContext,
  6   |   type Locator,
  7   |   type Page,
  8   | } from '@playwright/test';
  9   | import { manualTriggerConfig } from '../src/__fixtures__/triggers.js';
  10  | export type { TriggerFields } from '../src/__fixtures__/triggers.js';
  11  | export { triggerConfig, manualTriggerConfig } from '../src/__fixtures__/triggers.js';
  12  |
  13  | /** Tests run against the server global-setup started; its URL arrives through the environment. */
  14  | export const test = base.extend({
  15  |   // Playwright fixtures must destructure their dependencies, even when there are none.
  16  |   // eslint-disable-next-line no-empty-pattern
  17  |   baseURL: async ({}, use) => {
  18  |     const url = process.env['GG_E2E_BASE_URL'];
  19  |     if (!url) throw new Error('GG_E2E_BASE_URL is not set; the global setup did not run');
  20  |     await use(url);
  21  |   },
  22  | });
  23  |
  24  | export { expect };
  25  |
  26  | /** Initialize an explicitly active editor tab before another tab can edit its draft. */
  27  | export async function openDraftTab(page: Page, loopId: string, name: string): Promise<void> {
  28  |   // Multi-page traces show renderer work stalled until explicit activation, even while the
  29  |   // headless page reports visible/focused. A heading alone can also precede reconciliation.
  30  |   // These are state synchronization waits; their timeouts are failure budgets, not delays
  31  |   // or assertions about how fast the editor must render.
  32  |   await page.bringToFront();
  33  |   await page.goto(`/app/loops/${loopId}/edit`);
  34  |   await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  35  |   await expect(
  36  |     page.getByText(
  37  |       'The editor is available. Checking the server and this device before saving changes.',
  38  |       { exact: true },
  39  |     ),
  40  |   ).toBeHidden();
  41  | }
  42  |
  43  | /** A manual trigger, a wait-for-input node, and an exit. */
  44  | export function approvalLoop(name: string) {
  45  |   return {
  46  |     schemaVersion: CURRENT_DEFINITION_FORMAT,
  47  |     name,
  48  |     nodes: [
  49  |       {
  50  |         id: 'start',
  51  |         kind: 'trigger',
  52  |         label: 'Start',
  53  |         config: manualTriggerConfig(),
  54  |         ui: { x: 0, y: 80 },
  55  |       },
  56  |       {
  57  |         id: 'approve',
  58  |         kind: 'wait',
  59  |         label: 'Approve',
  60  |         config: { mode: 'input', prompt: 'Approve?' },
  61  |         ui: { x: 260, y: 80 },
  62  |       },
  63  |       { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
  64  |     ],
  65  |     edges: [
  66  |       { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
  67  |       { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
  68  |     ],
  69  |   };
  70  | }
  71  |
  72  | /** Drive the E2E server's control port, for example to script the fake harness. */
  73  | export async function control(request: APIRequestContext, path: string, body: unknown = {}) {
  74  |   const base = process.env['GG_E2E_CONTROL_URL'];
  75  |   if (!base) throw new Error('GG_E2E_CONTROL_URL is not set; the global setup did not run');
  76  |   const res = await request.post(`${base}${path}`, { data: body });
  77  |   expect(res.ok()).toBe(true);
  78  |   return (await res.json()) as Record<string, unknown>;
  79  | }
  80  |
  81  | /**
  82  |  * Expand the editor's loop panel (the loop's name, description, settings, and variables) unless it
  83  |  * is already open. With nothing remembered it starts expanded at 1280 px and wider, collapsed below.
  84  |  */
  85  | export async function showLoopPanel(page: Page): Promise<void> {
  86  |   await expect(page.getByRole('button', { name: /^(Show|Hide) loop settings$/ })).toBeVisible();
  87  |   const show = page.getByRole('button', { name: 'Show loop settings' });
  88  |   if (await show.isVisible()) await show.click();
  89  |   await expect(page.getByRole('button', { name: 'Hide loop settings' })).toHaveAttribute(
  90  |     'aria-expanded',
  91  |     'true',
  92  |   );
  93  | }
  94  |
  95  | /** Open a node's editor by clicking its card (on the header band, away from port handles). */
  96  | export async function openNode(page: Page, nodeId: string) {
  97  |   // Target the rendered header box: a fixed pixel offset can leave the card after zooming.
> 98  |   await page.getByTestId(`node-${nodeId}`).locator(':scope > div:has([data-kind])').click();
      |                                                                                     ^ Error: locator.click: Test timeout of 60000ms exceeded.
  99  |   const dialog = page.getByRole('dialog');
  100 |   await expect(dialog).toBeVisible();
  101 |   return dialog;
  102 | }
  103 |
  104 | /**
  105 |  * Expand the node editor's Advanced options (#14) unless they are open already, and return the
  106 |  * toggle. Advanced fields stay collapsed under it until then.
  107 |  */
  108 | export async function openAdvanced(scope: Page | Locator) {
  109 |   const toggle = scope.getByRole('button', { name: /^Advanced\b/ });
  110 |   if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  111 |   await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  112 |   return toggle;
  113 | }
  114 |
  115 | /** Expand a collapsed list item, such as "Operations 1" of a mutate node (#14). */
  116 | export async function openItem(scope: Page | Locator, name: string) {
  117 |   const toggle = scope.getByRole('button', { name: new RegExp(`^${name}\\b`) });
  118 |   if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  119 |   await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  120 |   return toggle;
  121 | }
  122 |
  123 | /** Close the open node editor with its Done button. */
  124 | export async function closeNode(page: Page): Promise<void> {
  125 |   await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  126 |   await expect(page.getByRole('dialog')).toHaveCount(0);
  127 | }
  128 |
  129 | /** Create and publish a loop through the API; returns its id. */
  130 | export async function publishLoop(
  131 |   request: APIRequestContext,
  132 |   definition: unknown,
  133 |   baseURL = '',
  134 | ): Promise<string> {
  135 |   const created = await request.post(`${baseURL}/loops`, { data: { definition } });
  136 |   expect(created.status()).toBe(201);
  137 |   const { loop } = (await created.json()) as { loop: { id: string } };
  138 |   const published = await request.post(`${baseURL}/loops/${loop.id}/publish`);
  139 |   expect(published.status()).toBe(200);
  140 |   return loop.id;
  141 | }
  142 |
  143 | /** Publish one Event entry per type and return a sender targeting that loop. */
  144 | export async function publishEventLoop(
  145 |   request: APIRequestContext,
  146 |   types: readonly string[],
  147 |   baseURL = '',
  148 | ) {
  149 |   const loopId = await publishLoop(
  150 |     request,
  151 |     {
  152 |       schemaVersion: CURRENT_DEFINITION_FORMAT,
  153 |       name: 'Browser Events',
  154 |       nodes: [
  155 |         ...types.map((eventType, index) => ({
  156 |           id: `event-${index}`,
  157 |           kind: 'trigger',
  158 |           label: eventType,
  159 |           config: { type: 'event', eventType },
  160 |           ui: { x: 0, y: index * 100 },
  161 |         })),
  162 |         { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 260, y: 0 } },
  163 |       ],
  164 |       edges: types.map((_, index) => ({
  165 |         id: `edge-${index}`,
  166 |         from: { node: `event-${index}`, port: 'out' },
  167 |         to: { node: 'done' },
  168 |       })),
  169 |     },
  170 |     baseURL,
  171 |   );
  172 |   return async (type: string, payload: unknown, dedupeKey?: string) => {
  173 |     const response = await request.post(`${baseURL}/events`, {
  174 |       data: { loopId, type, payload, dedupeKey },
  175 |     });
  176 |     expect(response.status()).toBe(202);
  177 |     return response;
  178 |   };
  179 | }
  180 |
```
