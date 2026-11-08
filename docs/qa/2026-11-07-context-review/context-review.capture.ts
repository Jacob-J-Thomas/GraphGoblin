/**
 * #441 evidence: inference Prompt/Session on Context and the Settings Defaults alignment.
 *
 * Runs on the E2E server (real API, in-memory database, fake harnesses, built apps/web/dist,
 * ephemeral ports, LIVE unset). Copy this file to apps/web/e2e/, then from apps/web:
 *
 *   pnpm exec playwright test -c playwright.capture.config.ts e2e/context-review.capture.ts
 *
 * Screenshots go to GG_CAPTURE_OUT (default: this folder's screens/), measurements to
 * measurements.json beside them. GG_CAPTURE_SET=before writes only the Defaults shots, with a
 * "before-" prefix, for a build without the Defaults change.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { control, expect, openNode, test } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  process.env['GG_CAPTURE_OUT'] ??
    join(here, '..', '..', '..', 'docs', 'qa', '2026-11-07-context-review', 'screens'),
);
const BEFORE = process.env['GG_CAPTURE_SET'] === 'before';
const measurements: Record<string, unknown> = {};

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not rendered');
  return found;
}

async function inferenceLoop(request: Parameters<typeof control>[0], session: unknown) {
  const created = await request.post('/loops', {
    data: {
      definition: {
        schemaVersion: 4,
        name: 'Context review ' + JSON.stringify(session),
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Start',
            config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] },
            ui: { x: 0, y: 80 },
          },
          {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: {
              prompt: { template: 'Summarise the latest review notes:\n{{ lastMessage.content }}' },
              session,
              input: [{ op: 'delete', path: '/vars/scratch' }],
              contextFiles: [{ path: 'notes.md', template: '{{ vars.notes }}' }],
            },
            ui: { x: 260, y: 80 },
          },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: { outcome: 'success', returns: 'none', destinations: [] },
            ui: { x: 520, y: 80 },
          },
        ],
        edges: [
          { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
          { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
        ],
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
test.afterAll(() => {
  if (Object.keys(measurements).length)
    writeFileSync(
      join(OUT, BEFORE ? 'before-measurements.json' : 'measurements.json'),
      JSON.stringify(measurements, null, 2) + '\n',
    );
});

test.use({ reducedMotion: 'reduce', colorScheme: 'light' });

for (const [name, viewport] of [
  ['desktop-1440', DESKTOP],
  ['narrow-390', NARROW],
] as const) {
  test(`inference Context placement and Session help, ${name}`, async ({ page, request }) => {
    test.skip(BEFORE, 'Defaults only');
    await page.setViewportSize(viewport);
    const policies = [
      ['fresh', { policy: 'fresh' }],
      ['resume-previous', { policy: 'resume-previous' }],
      ['resume-named', { policy: 'resume-named', key: 'review-notes' }],
      ['resume-own', { policy: 'resume-own', resetAfterVisits: 2 }],
    ] as const;
    const record: Record<string, unknown> = {};
    for (const [policy, session] of policies) {
      const id = await inferenceLoop(request, session);
      await page.goto(`/app/loops/${id}/edit`);
      const dialog = await openNode(page, 'infer');
      if (policy === 'fresh') {
        await expect(dialog.getByRole('group', { name: 'Session', exact: true })).toBeHidden();
        await expect(dialog.getByRole('group', { name: 'Prompt', exact: true })).toBeHidden();
        await page.screenshot({ path: join(OUT, `settings-tab-${name}.png`) });
      }
      await dialog.getByRole('tab', { name: /^Context\b/ }).click();
      const session_ = dialog.getByRole('group', { name: 'Session', exact: true });
      const select = session_.getByRole('combobox', { name: 'Conversation', exact: true });
      await expect(select).toHaveValue(policy);
      const order = await dialog
        .locator('[role="tabpanel"]:not([hidden]) [data-field]')
        .evaluateAll((elements) => [
          ...new Set(
            elements
              .map((element) => element.getAttribute('data-field') ?? '')
              .filter((path) => ['prompt', 'session', 'input', 'contextFiles'].includes(path)),
          ),
        ]);
      const selectBox = await box(select);
      const dialogBox = await box(dialog);
      await session_.scrollIntoViewIfNeeded();
      record[policy] = {
        contextOrder: order,
        promptVisible: await dialog.getByRole('group', { name: 'Prompt', exact: true }).isVisible(),
        sessionVisible: await session_.isVisible(),
        advancedExpanded: await dialog
          .locator('[role="tabpanel"]:not([hidden])')
          .getByRole('button', { name: /^Advanced\b/ })
          .getAttribute('aria-expanded'),
        selectedLabel: await select.locator('option:checked').textContent(),
        optionLabels: await select.locator('option').allTextContents(),
        selectDescription: await select.evaluate((element) =>
          (element.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent ?? `(missing ${id})`),
        ),
        conversationName: await session_
          .getByRole('textbox', { name: 'Conversation name', exact: true })
          .count(),
        resetAfterVisits: await session_
          .getByRole('spinbutton', { name: 'Reset after visits', exact: true })
          .count(),
        selectBox,
        selectInsideDialog:
          selectBox.x >= dialogBox.x && selectBox.x + selectBox.width <= dialogBox.x + dialogBox.width,
        overflow: await overflow(page),
      };
      if (policy !== 'resume-previous')
        await page.screenshot({ path: join(OUT, `context-${policy}-${name}.png`) });
    }
    measurements[`context-${name}`] = record;
  });
}

for (const [name, viewport] of [
  ['desktop-1440', DESKTOP],
  ['narrow-390', NARROW],
] as const) {
  test(`Settings Defaults model and effort, ${name}`, async ({ page, request }) => {
    const created = await control(request, '/apps', { claude: true });
    const url = String(created['url']);
    const saved = await request.put(url + '/settings', {
      data: { defaults: { byHarness: { claude: { model: 'claude-opus-5-5', effort: 'xhigh' } } } },
    });
    expect(saved.status()).toBe(200);
    await page.setViewportSize(viewport);
    await page.goto(url + '/app/settings');
    const record: Record<string, unknown> = {};
    for (const [harness, suffix] of [
      ['codex', ''],
      ['claude', ' (claude)'],
    ] as const) {
      const section = page.getByRole('region', { name: `${harness} defaults`, exact: true });
      const model = section.getByRole('combobox', { name: `Default model${suffix}`, exact: true });
      const effort = section.getByRole('combobox', { name: `Default effort${suffix}`, exact: true });
      await expect(model).toBeEnabled();
      await expect(effort).toBeEnabled();
      const modelBox = await box(model);
      const effortBox = await box(effort);
      record[harness] = {
        modelBox,
        effortBox,
        topsEqual: modelBox.y === effortBox.y,
        effortDescription: await effort.evaluate((element) =>
          (element.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent ?? `(missing ${id})`),
        ),
      };
    }
    record['overflow'] = await overflow(page);
    measurements[`${BEFORE ? 'before-' : ''}defaults-${name}`] = record;
    const card = page.getByRole('region', { name: 'Defaults', exact: true });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: join(OUT, `${BEFORE ? 'before-' : ''}defaults-${name}.png`) });
  });
}
