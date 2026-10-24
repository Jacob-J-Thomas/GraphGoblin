import { createRequire } from 'node:module';
import {
  assert,
  api,
  create,
  startRun,
  waitDefinition,
  cycleDefinition,
  newStore,
  launch,
  stop,
  removeStore,
  report,
} from './qa-lib.mjs';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url)),
  { chromium, expect } = require('@playwright/test');
const r = report('edge-extra'),
  data = await newStore('edge-extra');
let server, browser, context, page;
const layout = () =>
  page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
try {
  server = await launch(data);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    baseURL: 'http://127.0.0.1:5905',
  });
  page = await context.newPage();
  await r.check('390px Settings defaults and no budget controls', async () => {
    await page.goto('/app/settings');
    const card = page.getByText(
      /Maximum node visits: 10. No run deadline unless the loop sets one/,
    );
    await expect(card).toBeVisible();
    const controls = await page
      .locator('input,select,button')
      .evaluateAll((es) => es.map((e) => e.getAttribute('aria-label') || e.textContent).join(' '));
    assert(
      !/spending budget|token (quota|budget)|provider.turn budget|subscription ceiling/i.test(
        controls,
      ),
    );
    const l = await layout();
    assert.equal(l.width, 390);
    return { layout: l, card: await card.innerText() };
  });
  await r.check('390px Loop defaults, keyboard Unlimited and warning', async () => {
    const c = await create(waitDefinition('QA narrow loop'), 5905, false);
    await page.goto(`/app/loops/${c.loop.id}/edit`);
    await expect(page.getByRole('button', { name: /^(Show|Hide) loop settings$/ })).toBeVisible();
    const show = page.getByRole('button', { name: 'Show loop settings' });
    if (await show.isVisible()) await show.click();
    await expect(
      page.getByRole('spinbutton', { name: 'Maximum node visits', exact: true }),
    ).toHaveValue('10');
    await expect(page.getByRole('combobox', { name: 'Run deadline seconds mode' })).toHaveValue(
      'unlimited',
    );
    const mode = page.getByRole('combobox', { name: 'Maximum node visits mode' });
    await mode.focus();
    await page.keyboard.press('u');
    await page.keyboard.press('Enter');
    await expect(mode).toHaveValue('unlimited');
    await expect(page.getByText(/this guardrail will not stop execution/)).toBeVisible();
    const l = await layout();
    assert.equal(l.width, 390);
    return { layout: l, warning: true };
  });
  await r.check('390px published default pin inspector', async () => {
    const run = await startRun(await create(waitDefinition('QA narrow published')));
    await page.goto('/app/runs/' + run.id);
    const text = 'Maximum node visits: 10. Run deadline: none.';
    await expect(page.getByText(text)).toBeVisible();
    assert.deepEqual(run.pinned.limits, { maxNodeVisits: 10, runDeadlineSeconds: null });
    const l = await layout();
    assert.equal(l.width, 390);
    await api('POST', `/runs/${run.id}/cancel`, {});
    return { layout: l, pin: run.pinned.limits, card: text };
  });
  await r.check('gate warning above finite visit cap, narrow Unlimited passes', async () => {
    const d = cycleDefinition({ maxNodeVisits: 3 });
    d.name = 'QA finite gate warning';
    d.nodes.find((x) => x.id === 'gate').config.maxPasses = 4;
    d.nodes.forEach((n, i) => (n.ui = { x: i * 260, y: 80 }));
    const c = await create(d, 5905, false);
    const validation = await api('POST', `/loops/${c.loop.id}/validate`, { definition: d });
    assert(validation.issues.some((x) => x.code === 'GATE_PASSES_ABOVE_VISIT_CAP'));
    await page.goto(`/app/loops/${c.loop.id}/edit`);
    await page.locator('.react-flow__node[data-id=gate]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('spinbutton', { name: 'Maximum passes', exact: true }),
    ).toHaveValue('4');
    await dialog.getByRole('combobox', { name: 'Maximum passes mode' }).selectOption('unlimited');
    await expect(dialog.getByText(/this guardrail will not stop execution/)).toBeVisible();
    const l = await layout();
    assert.equal(l.width, 390);
    return { validation, layout: l };
  });
  await r.check('OpenAPI has no substitute usage budget fields', async () => {
    const schema = JSON.stringify(await api('GET', '/openapi.json'));
    const matches =
      schema.match(
        /maxTokens|tokenBudget|spendingBudget|providerTurnBudget|subscriptionLimit|usageCeiling/gi,
      ) || [];
    assert.deepEqual(matches, []);
    return { matches };
  });
} finally {
  if (browser) await browser.close();
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = await removeStore(data);
  await r.finish();
}
