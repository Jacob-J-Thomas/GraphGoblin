// #209 phase 2: the browser's computed accessibility tree (Playwright ariaSnapshot) for each refusal surface, plus the
// live-region and description wiring that DOM attributes alone do not prove. This is NOT assistive-technology speech:
// no screen reader was driven or recorded. It shows roles, accessible names, descriptions and live regions as Chromium computes them.
import { writeFileSync } from 'node:fs';
import { QA, startNative, api, approvalLoop, equivalent, launchEdge, contextFor, stamp } from './lib.mjs';

const g = await startNative({ port: 4795, dataDir: `${QA}/native/data-aria`, label: 'aria' });
process.on('exit', () => g.stop());
const out = { at: stamp(), surfaces: {} };
const mk = async (n) => (await api(g.url, 'POST', '/loops', { definition: approvalLoop(n) })).json.loop;
const nightly = await mk('Nightly triage');
const mine = await mk('Weekly report');
await mk('Daily report');
await api(g.url, 'POST', '/templates/starter/draft', {});
const exported = (await api(g.url, 'GET', `/loops/${nightly.id}/export?draft=true`)).json;

const browser = await launchEdge();
const ctx = await contextFor(browser, { theme: 'dark', width: 1440, height: 900, url: g.url });
const page = await ctx.newPage();

/** Live-region and description wiring as the browser resolves it (ids to their rendered text). */
async function liveFacts(locator) {
  return locator.evaluate((el) => {
    const live = el.closest('[aria-live],[role=alert],[role=status]') ?? el;
    const refs = (id) => (id ?? '').split(/\s+/).filter(Boolean).map((i) => document.getElementById(i)?.innerText.replace(/\s+/g, ' ').slice(0, 140));
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      ariaLive: live.getAttribute('aria-live'),
      liveRole: live.getAttribute('role'),
      ariaInvalid: el.getAttribute('aria-invalid'),
      describedBy: el.getAttribute('aria-describedby'),
      describedByText: refs(el.getAttribute('aria-describedby')),
    };
  });
}

// Create
await page.goto('/app/loops');
const field = page.getByRole('textbox', { name: 'New loop name' });
await field.fill(equivalent('Nightly triage'));
await field.press('Enter');
await page.getByRole('alert').waitFor();
out.surfaces.create = {
  ariaSnapshot: await page.locator('form[aria-label="Create loop"]').ariaSnapshot(),
  field: await liveFacts(field),
  alert: await liveFacts(page.getByRole('alert')),
};

// Import
await page.goto('/app/loops');
await page.getByLabel('Import an exported loop (JSON)').setInputFiles({ name: 'a.graphgoblin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
const panel = page.getByRole('region', { name: 'Import under another name' });
await panel.waitFor();
out.surfaces.import = { ariaSnapshot: await panel.ariaSnapshot(), field: await liveFacts(panel.getByRole('textbox')), picker: await liveFacts(page.getByLabel('Import an exported loop (JSON)')) };

// Template
await page.goto('/app/loops');
await page.getByRole('button', { name: 'New from template' }).click();
const card = page.getByRole('region', { name: 'Starter assistant', exact: true });
await card.getByRole('button', { name: 'Use Starter assistant', exact: true }).click();
await card.getByRole('textbox', { name: 'Name for the new draft' }).waitFor();
out.surfaces.template = { ariaSnapshot: await card.ariaSnapshot(), field: await liveFacts(card.getByRole('textbox')) };

// Editor
await page.goto(`/app/loops/${mine.id}/edit`);
await page.getByRole('heading', { name: mine.name, exact: true }).waitFor();
await page.getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true }).waitFor({ state: 'hidden' });
const show = page.getByRole('button', { name: 'Show loop settings' });
if (await show.isVisible()) await show.click();
const name = page.getByRole('textbox', { name: 'Name', exact: true });
await name.fill(' daily  report ');
const notice = page.getByRole('status').filter({ hasText: 'Another loop already has this name' });
await notice.waitFor();
out.surfaces.editor = {
  noticeAriaSnapshot: await notice.ariaSnapshot(),
  nameField: await liveFacts(name),
  noticeLive: await liveFacts(notice),
  alertsOnPage: await page.getByRole('alert').count(),
  statusRegionsWithName: await page.getByRole('status').filter({ hasText: 'Another loop already has this name' }).count(),
  saveState: await page.getByTestId('save-state').innerText(),
};
writeFileSync(`${QA}/native/aria-snapshots.json`, JSON.stringify(out, null, 2));
await browser.close();
g.stop();
console.log('aria snapshots written');
