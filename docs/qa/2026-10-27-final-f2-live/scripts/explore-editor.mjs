// Exploration only (fake CLI, no provider): list the editor's controls for a new loop so the
// authoring driver can use accessible names. Output: explore-editor.log.txt (not evidence).
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('explore-editor');
const dir = L.makeStore('explore');
const fake = L.fakeCli(dir);
let g;
let browser;
const dump = async (scope, label) => {
  const items = await scope.evaluate((root) => {
    const out = [];
    for (const el of root.querySelectorAll('button, input, select, textarea, [role="radio"], [role="textbox"], [role="combobox"], [role="tab"]')) {
      const id = el.id;
      const lab = el.getAttribute('aria-label') || (id && root.ownerDocument.querySelector(`label[for="${id}"]`)?.textContent) || el.closest('label')?.textContent || el.textContent;
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} name=${JSON.stringify((lab || '').trim().slice(0, 80))} field=${el.closest('[data-field]')?.getAttribute('data-field') ?? ''} value=${JSON.stringify(el.value ?? '')}`);
    }
    return out;
  });
  rec.log(`${label}: ${items.length} controls`, items);
};
try {
  g = await L.startGateway({ dir, port: 6646, label: 'explore', env: fake.env, rec });
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${g.origin}/app/loops`);
  await page.getByLabel('New loop name').fill('F2 explore');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/loops\/[0-9A-Z]{26}\/edit$/);
  const loopId = page.url().split('/').at(-2);
  await L.sleep(1500);
  rec.log('draft after create', (await g.call(`/loops/${loopId}`)).json);
  const palette = page.getByRole('complementary', { name: 'Palette' });
  rec.log('palette buttons', await palette.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent)));
  for (const kind of ['Inference']) {
    const b = page.getByRole('button', { name: new RegExp(`^Add ${kind}`) });
    rec.log(`add ${kind}`, { count: await b.count() });
    if (await b.count()) await b.first().click();
    await L.sleep(800);
  }
  const nodes = await page.locator('[data-testid^="node-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  rec.log('nodes on canvas', nodes);
  for (const t of nodes) {
    const id = t.replace(/^node-/, '');
    await page.getByTestId(t).locator(':scope > div:has([data-kind])').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    rec.log(`dialog ${id} name`, await dialog.getAttribute('aria-label'));
    await dump(dialog, `dialog ${id}`);
    await L.shot(page, `explore-${id}`);
    if (id.startsWith('infer')) {
      rec.log('tabs', await dialog.getByRole('tab').allInnerTexts());
      const claude = dialog.getByRole('radio', { name: 'claude', exact: true });
      if (await claude.count()) {
        await claude.focus();
        await page.keyboard.press('Space');
        await L.sleep(800);
        await dump(dialog, `dialog ${id} after choosing claude`);
        const effort = dialog.getByLabel('Effort', { exact: true });
        rec.log('claude effort options', await effort.locator('option').allInnerTexts());
        rec.log('claude model options', await dialog.getByLabel('Model', { exact: true }).locator('option').allInnerTexts());
        rec.log('policy options', await dialog.getByLabel('Sandbox and approval policy', { exact: true }).locator('option').allInnerTexts().catch(() => 'n/a'));
        await dialog.getByRole('radio', { name: 'codex', exact: true }).focus();
        await page.keyboard.press('Space');
        await L.sleep(800);
        rec.log('codex effort options', await effort.locator('option').allInnerTexts());
        rec.log('codex model options', await dialog.getByLabel('Model', { exact: true }).locator('option').allInnerTexts());
      }
    }
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await L.sleep(400);
  }
  rec.log('draft after adds', (await g.call(`/loops/${loopId}`)).json);
} catch (error) {
  rec.check('explore completed', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) await g.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
