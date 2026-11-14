// #273 phase 2 native driver (Claude, not part of the change): Edge through the Playwright library
// against qa-gateway.mjs (built API + built web, file SQLite, provider-free fake harness).
//   node native-273.mjs <checkoutRoot> <gatewayUrl> <controlUrl> <evidenceDir> <attempt>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, base, controlUrl, evidence, attempt = '1'] = process.argv.slice(2);
const require = createRequire(join(root, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const domain = await import(pathToFileURL(join(root, 'packages', 'domain', 'dist', 'index.js')).href);
const shots = join(evidence, `screens-${attempt}`);
await mkdir(shots, { recursive: true });
const stamp = Date.now().toString(36);
const observed = { attempt, base, startedAt: new Date().toISOString(), scenarios: {}, console: [], screenshots: [] };
const save = () => writeFile(join(evidence, `native-observed-${attempt}.json`), JSON.stringify(observed, null, 2) + '\n');

async function api(method, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: response.status, etag: response.headers.get('etag'), json };
}
async function script(turns) {
  const response = await fetch(`${controlUrl}/script`, { method: 'POST', body: JSON.stringify({ turns }) });
  assert.equal(response.status, 200);
}
const draftOf = async (loopId) => {
  const { json } = await api('GET', `/loops/${loopId}`);
  return { definition: (json.draft ?? json.current).definition, token: json.draftToken, loop: json.loop };
};
const nodeOf = (definition, id) => definition.nodes.find((n) => n.id === id);
async function pinnedRun(loopId, versionId) {
  const started = await api('POST', `/loops/${loopId}/runs`, { versionId });
  assert.equal(started.status, 202, JSON.stringify(started.json));
  for (let i = 0; i < 150; i += 1) {
    const { json } = await api('GET', `/runs/${started.json.run.id}`);
    if (!['queued', 'running'].includes(json.status)) return { request: { versionId }, started: started.json.run, final: json };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('run did not finish');
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
observed.browser = { channel: 'msedge', version: browser.version() };

async function context(options = {}, theme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await ctx.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
  return ctx;
}
function watch(page, label, loopId, log) {
  page.on('console', (m) => { if (m.type() === 'error') observed.console.push({ label, text: m.text() }); });
  page.on('pageerror', (e) => observed.console.push({ label, pageerror: String(e) }));
  page.on('response', async (response) => {
    const request = response.request();
    const url = new URL(request.url());
    if (!loopId || !url.pathname.startsWith(`/loops/${loopId}`)) return;
    if (request.method() === 'GET' && !url.pathname.endsWith('/versions')) return;
    let responseBody;
    try { responseBody = await response.json(); } catch { responseBody = undefined; }
    log.push({
      at: new Date().toISOString(),
      method: request.method(),
      path: url.pathname,
      ifMatch: request.headers()['if-match'],
      requestBody: request.postDataJSON?.() ?? null,
      status: response.status(),
      responseBody,
    });
  });
}
async function shot(locatorOrPage, name, options = {}) {
  const path = join(shots, name);
  await locatorOrPage.screenshot({ path, ...options });
  observed.screenshots.push(name);
}
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName, id: el.id, label: el.getAttribute('aria-label'), field: el.closest('[data-field]')?.getAttribute('data-field') ?? null, focusVisible: el.matches(':focus-visible') } : null;
});
async function openCard(page, id) {
  await page.getByTestId(`rf__node-${id}`).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}
const savedState = (page) => page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 30_000 });
async function deviceCopy(page, loopId) {
  return page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const o = indexedDB.open('graphgoblin', 2);
      o.onsuccess = () => resolve(o.result);
      o.onerror = () => reject(o.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction('drafts', 'readonly').objectStore('drafts').get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  }, loopId);
}
const only = process.argv[7];
async function scenario(name, fn) {
  if (only && !name.startsWith(only)) return;
  const record = { ok: false, checks: {} };
  observed.scenarios[name] = record;
  try {
    await fn(record);
    record.ok = true;
  } catch (error) {
    record.error = String(error?.stack ?? error).slice(0, 4000);
  }
  await save();
}

// ---------------------------------------------------------------------------------------------
let starter;
await scenario('N1-N2 Starter assistant to writer on file SQLite', async (r) => {
  const name = `Native 273 Starter writer ${stamp}`;
  const copied = await api('POST', '/templates/starter/draft', { name });
  assert.equal(copied.status, 201);
  const loopId = copied.json.loop.id;
  const fromTemplate = await draftOf(loopId);
  const assistant = nodeOf(fromTemplate.definition, 'assistant');
  const setup = structuredClone(fromTemplate.definition);
  nodeOf(setup, 'instructions').config.operations.push({ op: 'set', path: '/vars/source', value: { kind: 'literal', value: { reads: 'outputs.assistant.value', step: 'assistant' } } });
  setup.nodes.push(
    { id: 'review', kind: 'inference', label: 'Review', ui: { x: 810, y: 160 }, config: { ...assistant.config, prompt: { template: 'The assistant step wrote:\n{{ outputs.assistant.value }}\nReview it.' } } },
    { id: 'archive', kind: 'script', label: 'Archive', ui: { x: 1080, y: 160 }, config: { command: process.execPath, args: ['-e', 'process.stdin.resume() // the thread holds outputs.assistant.value'], cwd: 'workspace', stdin: 'thread', stdout: 'ignore' } },
  );
  setup.edges = [
    ...setup.edges.filter((e) => e.id !== 'assistant-out-done'),
    { id: 'assistant-out-review', from: { node: 'assistant', port: 'out' }, to: { node: 'review', port: 'in' } },
    { id: 'review-out-archive', from: { node: 'review', port: 'out' }, to: { node: 'archive', port: 'in' } },
    { id: 'archive-out-done', from: { node: 'archive', port: 'out' }, to: { node: 'done', port: 'in' } },
  ];
  const put = await api('PUT', `/loops/${loopId}/draft`, { definition: setup }, { 'if-match': `"${fromTemplate.token}"` });
  assert.equal(put.status, 200);
  const v1 = await api('POST', `/loops/${loopId}/publish`);
  assert.equal(v1.status, 200);
  const before = await draftOf(loopId);
  r.loopId = loopId;
  r.v1 = v1.json.version;
  r.beforeToken = before.token;
  r.beforeDefinition = before.definition;
  await script([{ matchPrompt: 'Instructions:', finalText: 'Native v1 summary before rename.' }, { matchPrompt: 'The assistant step wrote:', finalText: 'Reviewed.' }]);
  r.runV1BeforeRename = await pinnedRun(loopId, v1.json.version.id);

  const ctx = await context();
  const page = await ctx.newPage();
  const log = [];
  watch(page, 'starter', loopId, log);
  r.network = log;
  await page.goto(`${base}/app/loops/${loopId}/edit`);
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await savedState(page);
  await shot(page, 'n2-01-before-desktop-dark.png');
  const dialog = await openCard(page, 'assistant');
  const id = dialog.getByLabel('Node id');
  await id.fill('writer');
  await id.press('Enter');
  await page.getByRole('dialog', { name: 'Edit inference writer' }).waitFor();
  r.checks.focusAfterEnter = await active(page);
  const notice = dialog.getByRole('status').filter({ hasText: 'Renamed assistant to writer' });
  r.checks.dialogNoticeText = await notice.innerText();
  await shot(dialog, 'n2-02-dialog-notice-desktop-dark.png');
  await savedState(page);
  r.checks.afterRenameServer = await draftOf(loopId);
  r.checks.afterRenameDevice = await deviceCopy(page, loopId);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  r.checks.focusAfterDone = await active(page);
  r.checks.undoName = await page.getByRole('button', { name: /^Undo/ }).innerText();
  await shot(page, 'n2-03-page-notice-desktop-dark.png');
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+z');
  await page.getByTestId('rf__node-assistant').waitFor();
  await savedState(page);
  r.checks.afterUndoServer = await draftOf(loopId);
  r.checks.noticeAfterUndo = await page.getByRole('status').filter({ hasText: 'Renamed assistant to writer' }).count();
  await page.keyboard.press('Control+Shift+z');
  await page.getByTestId('rf__node-writer').waitFor();
  await savedState(page);
  r.checks.afterRedoServer = await draftOf(loopId);
  r.checks.afterRedoDevice = await deviceCopy(page, loopId);
  await page.reload();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await savedState(page);
  r.checks.afterReloadServer = await draftOf(loopId);
  r.checks.afterReloadDevice = await deviceCopy(page, loopId);
  r.checks.noticeAfterReload = await page.getByRole('status').filter({ hasText: 'Renamed assistant to writer' }).count();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByText('Published version 2.').waitFor();
  await shot(page, 'n2-04-published-desktop-dark.png');
  const versions = await api('GET', `/loops/${loopId}/versions`);
  r.checks.versions = versions.json.items.map((v) => ({ id: v.id, version: v.version, status: v.status }));
  const v2 = versions.json.items.find((v) => v.version === 2);
  const v1Now = await api('GET', `/loops/${loopId}/versions/${v1.json.version.id}`);
  r.checks.v1Immutable = JSON.stringify(v1Now.json.definition) === JSON.stringify(v1.json.version.definition);
  r.checks.v1StillReadsAssistant = nodeOf(v1Now.json.definition, 'done').config.returns;
  r.checks.v2Definition = v2.definition;
  r.checks.v2EqualsSavedDraft = JSON.stringify(v2.definition) === JSON.stringify(r.checks.afterRedoServer.definition);
  await script([{ matchPrompt: 'Instructions:', finalText: 'Native v2 summary from writer.' }, { matchPrompt: 'The assistant step wrote:', finalText: 'Reviewed.' }]);
  r.runV2 = await pinnedRun(loopId, v2.id);
  await script([{ matchPrompt: 'Instructions:', finalText: 'Native v1 summary after rename.' }, { matchPrompt: 'The assistant step wrote:', finalText: 'Reviewed.' }]);
  r.runV1AfterRename = await pinnedRun(loopId, v1.json.version.id);
  starter = { loopId, name };
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------
const longOld = 'collect_customer_feedback_from_the_quarterly_survey_results_273';
const longNew = 'summarize_customer_feedback_from_quarterly_survey_results_273';
// 65 characters: one past the id limit, refused under the field with the existing message.
const tooLong = 'summarize_customer_feedback_from_the_quarterly_survey_results_273';
let visualsLoop;
await scenario('N3 visuals: themes, 360 px, 200% zoom, forced colours, focus through remount', async (r) => {
  const name = `Native 273 visuals ${stamp}`;
  const definition = {
    schemaVersion: domain.CURRENT_DEFINITION_FORMAT ?? 4,
    name,
    variables: { key: { type: 'string' } },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: longOld, kind: 'inference', label: 'Collect feedback', config: { prompt: { template: 'Collect feedback.' } }, ui: { x: 280, y: 80 } },
      { id: 'gate', kind: 'decision', label: 'Gate', config: { kind: 'expression', jsonata: 'counters.nodeVisits.gate > 2 ? "stop" : "again"', routes: [{ id: 'again', label: 'Again', repeat: true }, { id: 'stop', label: 'Stop' }], maxPasses: 3 }, ui: { x: 560, y: 80 } },
      { id: 'probe', kind: 'script', label: 'Probe', config: { command: process.execPath, args: ['-e', ''], cwd: 'workspace', stdin: 'thread' }, ui: { x: 840, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: `[outputs.${longOld}.value, $lookup(outputs, vars.key)]` }, ui: { x: 1120, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: longOld, port: 'in' } },
      { id: 'e2', from: { node: longOld, port: 'out' }, to: { node: 'gate', port: 'in' } },
      { id: 'e3', from: { node: 'gate', port: 'again' }, to: { node: longOld, port: 'in' } },
      { id: 'e4', from: { node: 'gate', port: 'stop' }, to: { node: 'probe', port: 'in' } },
      { id: 'e5', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'probe', port: 'in' } },
      { id: 'e6', from: { node: 'probe', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
  const created = await api('POST', '/loops', { definition });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const loopId = created.json.loop.id;
  visualsLoop = loopId;
  r.loopId = loopId;
  const variants = [
    { label: 'desktop-dark', theme: 'dark', options: {} },
    { label: 'desktop-light', theme: 'light', options: {} },
    { label: 'narrow360-dark', theme: 'dark', options: { viewport: { width: 360, height: 760 } } },
    { label: 'narrow360-light', theme: 'light', options: { viewport: { width: 360, height: 760 } } },
    { label: 'zoom200-light', theme: 'light', options: { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 } },
    { label: 'forced-colors-dark', theme: 'dark', options: { forcedColors: 'active' } },
  ];
  r.variants = {};
  for (const variant of variants) {
    const v = {};
    r.variants[variant.label] = v;
    const ctx = await context(variant.options, variant.theme);
    const page = await ctx.newPage();
    watch(page, variant.label, undefined, []);
    await page.goto(`${base}/app/loops/${loopId}/edit`);
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await savedState(page);
    const dialog = await openCard(page, longOld);
    if (variant.label === 'desktop-dark') {
      await dialog.getByLabel('Node id').fill(tooLong);
      await dialog.getByLabel('Node id').press('Enter');
      const refusal = dialog.locator('#node-id-error');
      await refusal.waitFor();
      v.refusalText = await refusal.innerText();
      v.refusalAriaInvalid = await dialog.getByLabel('Node id').getAttribute('aria-invalid');
      v.titleAfterRefusal = await page.getByRole('dialog').getAttribute('aria-labelledby');
      v.serverAfterRefusalHasOldId = Boolean(nodeOf((await draftOf(loopId)).definition, longOld));
      await shot(dialog, `n3-${variant.label}-refused-too-long.png`);
    }
    await dialog.getByLabel('Node id').fill(longNew);
    await dialog.getByLabel('Node id').press('Enter');
    const notice = dialog.getByRole('status').filter({ hasText: `Renamed ${longOld} to ${longNew}` });
    await notice.waitFor();
    v.focusAfterEnter = await active(page);
    v.noticeText = await notice.innerText();
    v.dialogOverflow = await dialog.evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }));
    v.noticeOverflow = await notice.evaluate((n) => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
    await shot(dialog, `n3-${variant.label}-dialog-notice.png`);
    await shot(notice, `n3-${variant.label}-dialog-notice-only.png`);
    // Tab from the notice's Dismiss: keyboard reaches its row and Dismiss.
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const pageNotice = page.getByRole('status').filter({ hasText: `Renamed ${longOld} to ${longNew}` });
    await pageNotice.waitFor();
    v.pageOverflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    v.pageNoticeOverflow = await pageNotice.evaluate((n) => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
    await shot(page, `n3-${variant.label}-page.png`);
    await shot(pageNotice, `n3-${variant.label}-page-notice-only.png`);
    // Keyboard: the review row opens the exit at Returns; Dismiss on the page.
    const row = pageNotice.getByRole('button', { name: /node done config\.returns/ });
    await row.focus();
    await page.keyboard.press('Enter');
    const exit = page.getByRole('dialog', { name: 'Edit exit done' });
    await exit.waitFor();
    await page.waitForTimeout(100);
    v.focusAfterRowEnter = await active(page);
    await shot(exit, `n3-${variant.label}-row-opens-returns.png`);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await pageNotice.getByRole('button', { name: 'Dismiss notice' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    v.focusAfterPageDismiss = await active(page);
    v.pageNoticeAfterDismiss = await pageNotice.count();
    // Focus through the remount: type a gate id, click Maximum passes.
    if (variant.label === 'desktop-dark' || variant.label === 'desktop-light') {
      const gate = await openCard(page, 'gate');
      await gate.getByLabel('Node id').fill('check');
      await gate.getByLabel('Maximum passes', { exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit decision check' }).waitFor();
      await page.waitForTimeout(100);
      v.focusAfterClickRemount = await active(page);
      v.jsonataAfter = await gate.locator('[data-field="jsonata"] .cm-content').innerText();
      await shot(gate, `n3-${variant.label}-focus-through-remount.png`);
      await gate.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByTestId('canvas').focus();
      await page.keyboard.press('Control+z');
      await page.getByTestId('rf__node-gate').waitFor();
    }
    // Restore the original ids for the next variant: undo the rename.
    await page.getByTestId('canvas').focus();
    await page.keyboard.press('Control+z');
    await page.getByTestId(`rf__node-${longOld}`).waitFor();
    await savedState(page);
    await ctx.close();
  }
  r.finalServer = (await draftOf(loopId)).definition;
});

// ---------------------------------------------------------------------------------------------
await scenario('N4 known missing gate refused 422; optional probe publishes', async (r) => {
  const name = `Native 273 missing gate ${stamp}`;
  const created = await api('POST', '/loops', { definition: {
    schemaVersion: domain.CURRENT_DEFINITION_FORMAT ?? 4, name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"ok"' }, ui: { x: 300, y: 80 } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done', port: 'in' } }],
  } });
  assert.equal(created.status, 201);
  const loopId = created.json.loop.id;
  r.loopId = loopId;
  const v1 = await api('POST', `/loops/${loopId}/publish`);
  r.v1 = { status: v1.status, id: v1.json.version.id };
  const ctx = await context();
  const page = await ctx.newPage();
  const log = [];
  r.network = log;
  watch(page, 'missing', loopId, log);
  await page.goto(`${base}/app/loops/${loopId}/edit`);
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await savedState(page);
  let exit = await openCard(page, 'done');
  await exit.locator('[data-field="returns"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText('gates.missing.passes');
  await exit.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await savedState(page);
  r.checks.indicator = await page.getByRole('button', { name: /error/ }).first().innerText();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Publish failed' }).waitFor();
  await shot(page, 'n4-01-publish-refused-desktop-dark.png');
  r.checks.currentAfterRefusal = (await api('GET', `/loops/${loopId}`)).json.loop.currentVersionId;
  exit = await openCard(page, 'done');
  await exit.locator('[data-field="returns"] .cm-content').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText('$exists(gates.missing) ? 1 : 0');
  await exit.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await savedState(page);
  await page.locator('.react-flow__node[data-id="done"]').getByRole('button', { name: /issues? on done/ }).click();
  await shot(page, 'n4-02-optional-warning-popover.png');
  r.checks.popoverText = await page.getByRole('dialog', { name: 'Issues on done' }).innerText();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByText('Published version 2.').waitFor();
  r.checks.versions = (await api('GET', `/loops/${loopId}/versions`)).json.items.map((v) => ({ version: v.version, status: v.status, returns: nodeOf(v.definition, 'done').config.returns }));
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------
await scenario('N5 stale tab: 409 then Overwrite with the complete renamed draft', async (r) => {
  const name = `Native 273 stale tab ${stamp}`;
  const created = await api('POST', '/loops', { definition: {
    schemaVersion: domain.CURRENT_DEFINITION_FORMAT ?? 4, name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'work', kind: 'inference', label: 'Work', config: { prompt: { template: 'Work.' } }, ui: { x: 260, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'outputs.work.value' }, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work', port: 'in' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  } });
  const loopId = created.json.loop.id;
  r.loopId = loopId;
  const ctx = await context();
  const a = await ctx.newPage();
  const logA = [];
  r.networkA = logA;
  watch(a, 'tabA', loopId, logA);
  await a.goto(`${base}/app/loops/${loopId}/edit`);
  await a.getByRole('heading', { name, exact: true }).waitFor();
  await savedState(a);
  // Another writer saves first (public API with the current token).
  const current = await draftOf(loopId);
  const other = await api('PUT', `/loops/${loopId}/draft`, { definition: { ...current.definition, description: 'saved elsewhere' } }, { 'if-match': `"${current.token}"` });
  r.otherSave = { status: other.status };
  const dialog = await openCard(a, 'work');
  await dialog.getByLabel('Node id').fill('draft');
  await dialog.getByLabel('Node id').press('Enter');
  await dialog.getByText('The draft changed on the server').waitFor({ timeout: 30_000 });
  await shot(dialog, 'n5-01-conflict-in-dialog.png');
  r.checks.serverDuringConflict = (await draftOf(loopId)).definition;
  await dialog.getByRole('button', { name: 'Overwrite with this copy' }).click();
  await dialog.getByText('The draft changed on the server').waitFor({ state: 'detached', timeout: 30_000 });
  await savedState(a);
  r.checks.serverAfterOverwrite = (await draftOf(loopId)).definition;
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------
await scenario('N6 protected voice ids on a system Chat loop', async (r) => {
  const session = await api('GET', '/chat/session');
  const loopId = session.json.systemLoopId;
  r.loopId = loopId;
  const definition = domain.enableChatAudio(
    domain.createSystemChatDefinition({ name: `Native 273 voice chat ${stamp}`, harness: 'codex' }),
    { id: 'chat-normalize', kind: 'script', label: 'Fixture normalizer', ui: { x: 160, y: 0 }, config: { command: process.execPath, args: ['-e', ''], cwd: 'workspace', stdin: 'thread', stdout: 'last-output' } },
  );
  const put = await api('PUT', `/loops/${loopId}/draft`, { definition });
  r.put = put.status;
  const ctx = await context();
  const page = await ctx.newPage();
  watch(page, 'voice', undefined, []);
  await page.goto(`${base}/app/loops/${loopId}/edit`);
  await page.getByTestId('rf__node-respond').waitFor();
  await savedState(page);
  r.checks.protected = {};
  for (const id of ['chat-normalize', 'chat-normalize-check', 'chat-normalize-invalid']) {
    const dialog = await openCard(page, id);
    const field = dialog.getByLabel('Node id');
    r.checks.protected[id] = { readonly: await field.getAttribute('readonly'), deleteDisabled: await dialog.getByRole('button', { name: 'Delete node' }).isDisabled() };
    if (id === 'chat-normalize') await shot(dialog, 'n6-01-protected-id-readonly.png');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  }
  const respond = await openCard(page, 'respond');
  await respond.getByLabel('Node id').fill('reply');
  await respond.getByLabel('Node id').press('Enter');
  await respond.getByRole('status').filter({ hasText: 'Renamed respond to reply' }).waitFor();
  await shot(respond, 'n6-02-respond-renamed.png');
  await respond.getByRole('button', { name: 'Done', exact: true }).click();
  await savedState(page);
  const after = (await draftOf(loopId)).definition;
  r.checks.envelope = nodeOf(after, 'chat-envelope').config.operations[0].value.jsonata;
  r.checks.systemIssuesNotice = await page.getByText('Fix these to publish.').count();
  await ctx.close();
});

observed.finishedAt = new Date().toISOString();
await save();
await browser.close();
console.log(JSON.stringify(Object.fromEntries(Object.entries(observed.scenarios).map(([k, v]) => [k, v.ok ? 'ok' : v.error.split('\n')[0]]))));
