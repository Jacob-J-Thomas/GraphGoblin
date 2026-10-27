// Exploration only (PR build, fake CLI, no provider): the loop-settings "Add entry" controls, an
// inference node with an inherited model, and the Settings Default effort list. Output:
// explore-ui2.log.txt (not evidence; the check drivers repeat what matters).
import * as L from './lib.mjs';

const rec = new L.Recorder('explore-ui2');
const dir = L.makeStore('explore2');
const fake = L.fakeCli(dir);
let g;
let browser;
const dump = async (scope, label) => {
  const items = await scope.evaluate((root) => {
    const out = [];
    for (const el of root.querySelectorAll('button, input, select, textarea')) {
      const id = el.id;
      const doc = root.ownerDocument ?? root;
      const lab = el.getAttribute('aria-label') || (id && doc.querySelector(`label[for="${id}"]`)?.textContent) || el.closest('label')?.textContent || el.textContent;
      const options = el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.textContent}`) : undefined;
      out.push(`${el.tagName.toLowerCase()} name=${JSON.stringify((lab || '').trim().slice(0, 80))} value=${JSON.stringify(el.value ?? '')}${options ? ' options=' + JSON.stringify(options) : ''}`);
    }
    return out;
  });
  rec.log(`${label}: ${items.length} controls`, items);
};
try {
  g = await L.startGateway({ dir, port: 6699, label: 'explore2', env: fake.env, rec });
  const created = await L.createLoop(g.call, L.single('QA explore 2', L.inferenceNode('infer', {})));
  rec.log('create', { status: created.status, issues: created.json.issues });
  const loopId = created.json.loop.id;
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`${g.origin}/app/loops/${loopId}/edit`);
  await page.getByTestId('node-infer').waitFor({ timeout: 20_000 });
  await L.sleep(1500);
  const dialog = await L.openNode(page, 'infer');
  await dump(dialog, 'inherited-model inference dialog');
  await L.closeNode(page);
  const settingsPanel = page.getByRole('complementary').filter({ has: page.getByLabel('Maximum node visits', { exact: true }) });
  rec.log('settings panel count', await settingsPanel.count());
  const panel = (await settingsPanel.count()) ? settingsPanel.first() : page.locator('body');
  rec.log('panel text', (await panel.innerText()).slice(0, 2000));
  const adds = panel.getByRole('button', { name: 'Add entry', exact: true });
  const n = await adds.count();
  for (let i = n - 1; i >= 0; i--) {
    await adds.nth(i).click();
    await L.sleep(800);
    await dump(panel, `loop settings after Add entry #${i}`);
  }
  await L.shot(page, 'explore-loop-settings');
  await page.goto(`${g.origin}/app/settings`);
  await page.getByLabel('Default effort', { exact: true }).waitFor({ timeout: 20_000 });
  await L.sleep(1500);
  const effort = page.getByLabel('Default effort', { exact: true });
  rec.log('Settings Default effort options', await effort.locator('option').allInnerTexts());
  await effort.selectOption('minimal');
  await L.sleep(2500);
  rec.log('Settings after choosing minimal: GET /settings', (await g.call('/settings')).json);
  rec.log('Settings section text', (await page.getByRole('region', { name: 'codex defaults' }).innerText().catch(() => 'n/a')).slice(0, 1000));
  rec.log('alerts', await page.getByRole('alert').allInnerTexts());
  await L.shot(page, 'explore-settings-minimal');
} catch (error) {
  rec.check('explore completed', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) await g.stop();
  rec.log('fake CLI requests', fake.requests());
  rec.finish();
  L.cleanupStore(dir, rec);
}
