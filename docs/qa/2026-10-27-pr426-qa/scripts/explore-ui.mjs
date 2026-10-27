// Exploration only (PR build, fake CLI, no provider): list the editor's and Settings' controls so
// the check drivers can use accessible names. Output: explore-ui.log.txt (not evidence).
import * as L from './lib.mjs';

const rec = new L.Recorder('explore-ui');
const dir = L.makeStore('explore');
const fake = L.fakeCli(dir);
let g;
let browser;
const dump = async (scope, label) => {
  const items = await scope.evaluate((root) => {
    const out = [];
    for (const el of root.querySelectorAll('button, input, select, textarea, [role="radio"], [role="tab"]')) {
      const id = el.id;
      const doc = root.ownerDocument ?? root;
      const lab = el.getAttribute('aria-label') || (id && doc.querySelector(`label[for="${id}"]`)?.textContent) || el.closest('label')?.textContent || el.textContent;
      const options = el.tagName === 'SELECT' ? [...el.options].map((o) => `${o.value}=${o.textContent}`) : undefined;
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} name=${JSON.stringify((lab || '').trim().slice(0, 80))} value=${JSON.stringify(el.value ?? '')}${options ? ' options=' + JSON.stringify(options) : ''}${el.disabled ? ' disabled' : ''}`);
    }
    return out;
  });
  rec.log(`${label}: ${items.length} controls`, items);
};
try {
  g = await L.startGateway({ dir, port: 6699, label: 'explore', env: fake.env, rec });
  const def = L.loop(
    'QA explore',
    [L.inferenceNode('infer', { model: 'gpt-6-luna', effort: 'low' }), { ...L.llmDecisionNode('pick', { model: 'gpt-6-luna', effort: 'low' }), ui: { x: 520, y: 80 } }],
    [L.edge('e1', 'start', 'infer'), L.edge('e2', 'infer', 'pick'), L.edge('e3', 'pick', 'done', 'finish'), L.edge('e4', 'pick', 'done', 'other')],
  );
  const created = await L.createLoop(g.call, def);
  rec.log('create', { status: created.status, issues: created.json.issues });
  const loopId = created.json.loop.id;
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${g.origin}/app/loops/${loopId}/edit`);
  await page.getByTestId('node-infer').waitFor({ timeout: 20_000 });
  await L.sleep(1000);
  await dump(page.locator('body'), 'editor page');
  for (const id of ['infer', 'pick']) {
    const dialog = await L.openNode(page, id);
    rec.log(`dialog ${id} tabs`, await dialog.getByRole('tab').allInnerTexts().catch(() => []));
    await dump(dialog, `dialog ${id}`);
    await L.closeNode(page);
  }
  await page.goto(`${g.origin}/app/settings`);
  await L.sleep(2000);
  await dump(page.locator('body'), 'settings page');
} catch (error) {
  rec.check('explore completed', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  if (g && g.exitCode() === null) await g.stop();
  rec.log('fake CLI requests', fake.requests());
  rec.finish();
  L.cleanupStore(dir, rec);
}
