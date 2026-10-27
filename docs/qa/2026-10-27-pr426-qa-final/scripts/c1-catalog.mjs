// Check 1 (D1, no turn), part 1: the built PR head on a fresh disposable store, with the
// controlled fake CLI as both harness binaries, so any turn that reached a CLI would be recorded
// (requests.jsonl) instead of reaching a provider.
//   1a GET /model-catalog lists exactly the record's per-model Codex efforts (no minimal, no none).
//   1b The editor (Edge) offers exactly those efforts for every Codex model, in an inference node,
//      an LLM decision and the loop defaults; Settings' Default effort for Codex is observed too.
//   1c Codex minimal is refused with EFFORT_UNSUPPORTED for an inference node, an LLM decision, a
//      loop default and the Settings default, at draft create, draft save, validate and Settings
//      save, for every seeded Codex model, and no turn reaches a CLI.
//   1d (observation) a process default GG_DEFAULTS with Codex minimal.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('c1-catalog');
const dir = L.makeStore('c1');
const fake = L.fakeCli(dir);
const gateways = [];
let browser;

const TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'];
const EXPECTED = {
  'gpt-6-luna': { efforts: TO_MAX, defaultEffort: 'low' },
  'gpt-6.1-sol': { efforts: TO_MAX, defaultEffort: 'medium' },
  'gpt-6-sol': { efforts: TO_MAX, defaultEffort: 'medium' },
  'gpt-6-astra': { efforts: TO_MAX, defaultEffort: 'medium' },
  'gpt-5.6-luna': { efforts: TO_MAX, defaultEffort: 'low' },
  'gpt-5.6-sol': { efforts: TO_MAX, defaultEffort: 'medium' },
  'gpt-5.6-terra': { efforts: TO_MAX, defaultEffort: 'medium' },
  'gpt-5.5': { efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hasCode = (r, code) => r.text.includes(code);
const issuesOf = (r) => (r.json?.issues ?? r.json?.details ?? []).map?.((i) => ({ code: i.code, path: i.path, nodeId: i.nodeId, message: i.message })) ?? r.json;

try {
  const g = await L.startGateway({ dir, port: 6730, label: 'c1', env: fake.env, rec });
  gateways.push(g);

  // ---- 1a: the catalog ----
  const catalog = (await g.call('/model-catalog')).json.items;
  const codex = catalog.filter((i) => i.harness === 'codex');
  const table = Object.fromEntries(codex.map((i) => [i.model, { efforts: i.efforts, defaultEffort: i.defaultEffort, enabled: i.enabled }]));
  rec.log('GET /model-catalog codex rows', table);
  rec.log('GET /model-catalog claude rows', Object.fromEntries(catalog.filter((i) => i.harness === 'claude').map((i) => [i.model, { efforts: i.efforts, defaultEffort: i.defaultEffort }])));
  rec.check('1a-1 the catalog has exactly the eight seeded Codex models', same(Object.keys(table).sort(), Object.keys(EXPECTED).sort()), Object.keys(table));
  for (const [model, want] of Object.entries(EXPECTED))
    rec.check(`1a-2 ${model} offers exactly ${want.efforts.join(', ')}`, same(table[model]?.efforts, want.efforts), table[model]);
  rec.check('1a-3 no Codex model lists minimal or none', codex.every((i) => !i.efforts.includes('minimal') && !i.efforts.includes('none')), codex.map((i) => [i.model, i.efforts]));
  rec.check('1a-4 seeded default efforts match the record table (unchanged)', Object.entries(EXPECTED).every(([m, w]) => table[m]?.defaultEffort === w.defaultEffort), Object.fromEntries(Object.entries(table).map(([m, v]) => [m, v.defaultEffort])));

  // ---- 1c: API refusals (before the editor, so nothing else is in the store) ----
  const infer = (model, effort) => L.single('QA 1c inference', L.inferenceNode('work', { model, effort }));
  const decide = (model, effort) => L.single('QA 1c decision', L.llmDecisionNode('work', { model, effort }));
  const loopDefault = (model, effort) =>
    L.single('QA 1c loop default', L.inferenceNode('work', { model }), { defaults: { byHarness: { codex: { effort } } } });
  const kinds = { inference: infer, 'llm-decision': decide, 'loop-default': loopDefault };
  const created = {};
  for (const [kind, make] of Object.entries(kinds)) {
    const r = await L.createLoop(g.call, make('gpt-6-luna', 'minimal'));
    rec.check(`1c-1 POST /loops with a Codex ${kind} at minimal is refused 400 EFFORT_UNSUPPORTED`, r.status === 400 && hasCode(r, 'EFFORT_UNSUPPORTED'), { status: r.status, code: r.json?.code, issues: issuesOf(r) });
    // A valid loop of the same shape, then the minimal draft save and validate against it.
    const ok = await L.createLoop(g.call, make('gpt-6-luna', 'low'));
    created[kind] = ok.json?.loop?.id;
    const save = await g.call(`/loops/${created[kind]}/draft`, { method: 'PUT', body: { definition: make('gpt-6-luna', 'minimal') } });
    rec.check(`1c-2 PUT /loops/{id}/draft saving a Codex ${kind} at minimal is refused 400 EFFORT_UNSUPPORTED`, ok.status === 201 && save.status === 400 && hasCode(save, 'EFFORT_UNSUPPORTED'), { create: ok.status, status: save.status, code: save.json?.code, issues: issuesOf(save) });
    const validate = await g.call(`/loops/${created[kind]}/validate`, { method: 'POST', body: { definition: make('gpt-6-luna', 'minimal') } });
    rec.check(`1c-3 POST /loops/{id}/validate names EFFORT_UNSUPPORTED for a Codex ${kind} at minimal and says not publishable`, validate.status === 200 && validate.json.publishable === false && validate.json.issues.some((i) => i.code === 'EFFORT_UNSUPPORTED'), { status: validate.status, publishable: validate.json?.publishable, issues: issuesOf(validate) });
    const draft = (await g.call(`/loops/${created[kind]}`)).json;
    rec.check(`1c-4 the refused save left the ${kind} draft at low`, !JSON.stringify(draft).includes('"minimal"'), { draftHasMinimal: JSON.stringify(draft).includes('"minimal"') });
  }
  const settingsRefusals = [];
  for (const body of [{ codex: { effort: 'minimal' } }, { codex: { model: 'gpt-6-luna', effort: 'minimal' } }]) {
    const r = await g.call('/settings', { method: 'PUT', body: { defaults: { byHarness: body } } });
    settingsRefusals.push({ body, status: r.status, code: r.json?.code, text: r.text.slice(0, 600) });
  }
  rec.check('1c-5 PUT /settings with a Codex default effort minimal (with and without a model) is refused 400 EFFORT_UNSUPPORTED', settingsRefusals.every((s) => s.status === 400 && s.text.includes('EFFORT_UNSUPPORTED')), settingsRefusals);
  rec.check('1c-6 the refused Settings saves left the owner defaults unchanged', !JSON.stringify((await g.call('/settings')).json).includes('minimal'), (await g.call('/settings')).json);
  // Every seeded Codex model, in every place.
  const perModel = [];
  for (const model of Object.keys(EXPECTED)) {
    const row = { model };
    for (const [kind, make] of Object.entries(kinds)) {
      const r = await L.createLoop(g.call, make(model, 'minimal'));
      row[kind] = `${r.status}${hasCode(r, 'EFFORT_UNSUPPORTED') ? ' EFFORT_UNSUPPORTED' : ''}`;
    }
    const s = await g.call('/settings', { method: 'PUT', body: { defaults: { byHarness: { codex: { model, effort: 'minimal' } } } } });
    row.settings = `${s.status}${s.text.includes('EFFORT_UNSUPPORTED') ? ' EFFORT_UNSUPPORTED' : ''}`;
    perModel.push(row);
  }
  rec.log('1c per-model refusals of minimal', perModel);
  rec.check('1c-7 minimal is refused 400 EFFORT_UNSUPPORTED for every seeded Codex model, as inference, LLM decision, loop default and Settings default', perModel.every((r) => ['inference', 'llm-decision', 'loop-default', 'settings'].every((k) => r[k] === '400 EFFORT_UNSUPPORTED')), perModel);
  // none: not on the canonical scale.
  const none = await L.createLoop(g.call, infer('gpt-6-luna', 'none'));
  rec.observe('1c-8 effort none on gpt-6-luna (not a GraphGoblin effort)', { status: none.status, code: none.json?.code, text: none.text.slice(0, 400) });

  // ---- 1b: the editor and Settings in Edge ----
  const editorLoop = L.loop(
    'QA 1b editor',
    [L.inferenceNode('infer', { model: 'gpt-6-luna', effort: 'low' }), { ...L.llmDecisionNode('pick', { model: 'gpt-6-luna', effort: 'low' }), ui: { x: 520, y: 80 } }],
    [L.edge('e1', 'start', 'infer'), L.edge('e2', 'infer', 'pick'), L.edge('e3', 'pick', 'done', 'finish'), L.edge('e4', 'pick', 'done', 'other')],
  );
  const editorId = (await L.createLoop(g.call, editorLoop)).json.loop.id;
  browser = await L.launchEdge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(`${g.origin}/app/loops/${editorId}/edit`);
  await page.getByTestId('node-infer').waitFor({ timeout: 20_000 });
  await L.sleep(1500);
  const offered = (select) => select.locator('option').evaluateAll((os) => os.map((o) => o.value));
  for (const node of ['infer', 'pick']) {
    const dialog = await L.openNode(page, node);
    const model = dialog.getByLabel('Model', { exact: true });
    const effort = dialog.getByLabel('Effort', { exact: true });
    const luna = await offered(effort);
    rec.check(`1b-1 ${node === 'infer' ? 'inference' : 'LLM decision'} on gpt-6-luna: the Effort list is Default, low, medium, high, xhigh, max (no minimal)`, same(luna, ['', ...TO_MAX]), { values: luna, texts: await effort.locator('option').allInnerTexts() });
    const perModelUi = {};
    for (const m of Object.keys(EXPECTED)) {
      await model.selectOption(m);
      await L.sleep(300);
      perModelUi[m] = (await offered(effort)).filter((v) => v !== '');
    }
    rec.check(`1b-2 ${node}: for every Codex model the Effort list equals the catalog table`, Object.entries(EXPECTED).every(([m, w]) => same(perModelUi[m], w.efforts)), perModelUi);
    await model.selectOption('gpt-6-luna');
    await effort.selectOption('low');
    if (node === 'infer') await L.shot(page, 'c1-editor-luna-effort-list');
    await L.closeNode(page);
  }
  // Loop defaults: add a By harness entry, name it codex, read its Effort list.
  const panel = page.getByRole('complementary').filter({ has: page.getByLabel('Maximum node visits', { exact: true }) }).first();
  await panel.getByRole('button', { name: 'Add entry', exact: true }).first().click();
  await L.sleep(500);
  const key = panel.getByLabel('By harness key 1', { exact: true });
  await key.fill('codex');
  await key.press('Tab');
  await L.sleep(800);
  const loopEffort = panel.getByLabel('Effort', { exact: true });
  const loopEffortValues = await offered(loopEffort);
  rec.check('1b-3 loop defaults (codex): the Effort list offers no minimal', !loopEffortValues.includes('minimal'), { values: loopEffortValues, texts: await loopEffort.locator('option').allInnerTexts() });
  // Settings.
  const responses = [];
  page.on('response', async (r) => {
    if (r.url().endsWith('/settings') && r.request().method() === 'PUT') responses.push({ status: r.status(), body: (await r.text().catch(() => '')).slice(0, 600) });
  });
  await page.goto(`${g.origin}/app/settings`);
  const defModel = page.getByLabel('Default model', { exact: true });
  const defEffort = page.getByLabel('Default effort', { exact: true });
  await defEffort.waitFor({ timeout: 20_000 });
  await L.sleep(1500);
  const serverDefaultList = await offered(defEffort);
  rec.check('1b-4 Settings, Codex Default effort with Default model "(server default)": no minimal offered', !serverDefaultList.includes('minimal'), { values: serverDefaultList, defaultModel: await defModel.inputValue() });
  if (serverDefaultList.includes('minimal')) {
    const region = page.getByRole('region', { name: 'codex defaults' });
    const card = region.locator('xpath=../../..');
    await region.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(L.OUT, 'c1-settings-minimal-offered-before.png') }).catch(async () => L.shot(page, 'c1-settings-minimal-offered-before'));
    await defEffort.selectOption('minimal');
    await L.sleep(2500);
    rec.observe('1b-5 choosing the offered minimal in Settings (server default model)', {
      putResponses: responses,
      effortValueAfter: await defEffort.inputValue(),
      savedSettings: (await g.call('/settings')).json,
      cardText: (await card.innerText()).slice(0, 1500),
    });
    await card.screenshot({ path: path.join(L.OUT, 'c1-settings-minimal-offered-after.png') }).catch(async () => L.shot(page, 'c1-settings-minimal-offered-after'));
  }
  await defModel.selectOption('gpt-6-luna');
  await L.sleep(1500);
  const lunaDefaultList = await offered(defEffort);
  rec.check('1b-6 Settings, Codex Default effort with Default model GPT-6 Luna: low to max, no minimal', same(lunaDefaultList, ['', ...TO_MAX]), lunaDefaultList);
  await defModel.selectOption('');
  await L.sleep(1000);
  await browser.close();
  browser = undefined;

  rec.check('1c-9 no turn reached either CLI during check 1 (fake CLI requests.jsonl is empty)', fake.requests().length === 0, fake.requests());
  const code = await g.stop();
  rec.check('1-gw gateway drains to exit 0', code === 0, code);
  g.copyLog('c1-catalog-gateway.log.txt');

  // ---- 1d: a process default (GG_DEFAULTS) with Codex minimal ----
  const dir2 = L.makeStore('c1-gg-defaults');
  try {
    let g2;
    try {
      g2 = await L.startGateway({ dir: dir2, port: 6731, label: 'c1-gg-defaults', env: { ...L.fakeCli(dir2).env, GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model: 'gpt-6-luna', effort: 'minimal' } } }) }, rec });
      gateways.push(g2);
      const r = await L.createLoop(g2.call, L.single('QA 1d process default', L.inferenceNode('work', { model: 'gpt-6-luna' })));
      const s = await g2.call('/system/model-defaults');
      rec.observe('1d process default GG_DEFAULTS codex minimal: the gateway starts; a Codex node inheriting it', { createStatus: r.status, code: r.json?.code, issues: issuesOf(r), modelDefaults: s.json });
      await g2.stop();
      fs.writeFileSync(path.join(L.OUT, 'c1-gg-defaults-gateway.log.txt'), L.redact(g2.readLog()));
    } catch (error) {
      rec.observe('1d process default GG_DEFAULTS codex minimal: the gateway refuses to start', String(error).slice(0, 1500));
    }
  } finally {
    L.cleanupStore(dir2, rec);
  }
} catch (error) {
  rec.check('c1-catalog completed without exception', false, String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => undefined);
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish();
  L.cleanupStore(dir, rec);
}
