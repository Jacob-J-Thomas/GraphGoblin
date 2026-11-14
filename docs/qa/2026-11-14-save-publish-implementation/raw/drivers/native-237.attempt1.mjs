// #237 native evidence driver: the checkout's built gateway (gateway.mjs, separate process, file
// SQLite store) and its built web app in installed Microsoft Edge (Playwright library from the
// checkout). Barriers are real: a request held in the browser before it reaches the gateway, or a
// gateway response (after its commit) held before the browser receives it, or dropped.
//
// node native-237.mjs <worktree> <expectedHead> <runDir> <clean|dirty> <scenario,...|all>
// Writes <runDir>/scenarios/<name>.json, <runDir>/screens/*.png, <runDir>/summary.json and
// <runDir>/cleanup.json. Observations are recorded; nothing here asserts a desired outcome.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [worktree, expectedHead, runDirArg, treeMode, which = 'all'] = process.argv.slice(2);
const runDir = resolve(runDirArg);
const here = dirname(fileURLToPath(import.meta.url));
await mkdir(join(runDir, 'scenarios'), { recursive: true });
await mkdir(join(runDir, 'screens'), { recursive: true });
const require = createRequire(join(worktree, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');
const playwrightVersion = require('@playwright/test/package.json').version;

// ---------------------------------------------------------------- gateway process
const gateway = spawn(
  process.execPath,
  [join(here, 'gateway.mjs'), worktree, expectedHead, runDir, treeMode],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
let gatewayLog = '';
gateway.stderr.on('data', (d) => (gatewayLog += d));
const url = await new Promise((done, fail) => {
  let out = '';
  gateway.stdout.on('data', (d) => {
    out += d;
    const match = /GG_QA_READY (\S+)/.exec(out);
    if (match) done(match[1]);
  });
  gateway.once('exit', (code) => fail(new Error(`gateway exited ${code}: ${gatewayLog}`)));
});
const gatewayExit = new Promise((done) => gateway.once('exit', (code) => done(code)));

// ---------------------------------------------------------------- REST (independent readback / other writer)
async function rest(method, path, body, headers = {}) {
  const response = await fetch(url + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}
const tag = `${Date.now().toString(36)}`;
function exitLoop(name, description) {
  return {
    schemaVersion: 4,
    name,
    ...(description !== undefined ? { description } : {}),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 260, y: 80 } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}
function approvalLoop(name, description) {
  return {
    schemaVersion: 4,
    name,
    ...(description !== undefined ? { description } : {}),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
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
async function createLoop(definition) {
  const created = await rest('POST', '/loops', { definition });
  if (created.status !== 201) throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.loop.id;
}
const detail = (id) => rest('GET', `/loops/${id}`);
const summaryOf = (def) =>
  def ? { name: def.name, description: def.description ?? null, settings: def.settings } : null;
function versionSummary(v) {
  return v ? { id: v.id, version: v.version, status: v.status, ...summaryOf(v.definition) } : null;
}
async function readback(id) {
  const [d, versions, list] = await Promise.all([detail(id), rest('GET', `/loops/${id}/versions`), rest('GET', '/loops')]);
  const row = list.body.items?.find((item) => item.id === id);
  return {
    detail: {
      status: d.status,
      loop: d.body.loop
        ? {
            name: d.body.loop.name,
            description: d.body.loop.description ?? null,
            currentVersionId: d.body.loop.currentVersionId ?? null,
            draftVersionId: d.body.loop.draftVersionId ?? null,
          }
        : null,
      current: versionSummary(d.body.current),
      draft: versionSummary(d.body.draft),
      draftToken: d.body.draftToken ?? null,
    },
    versions: (versions.body.items ?? []).map((v) => ({ id: v.id, version: v.version, status: v.status })),
    listRow: row
      ? { name: row.name, description: row.description ?? null, runCount: row.runCount, latestRun: row.latestRun?.status ?? null }
      : null,
  };
}

// ---------------------------------------------------------------- browser instrumentation
const isApi = (u) => {
  const p = new URL(u).pathname;
  return !p.startsWith('/app') && p !== '/favicon.ico';
};
function summarizeJson(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.definition) return { definition: summaryOf(value.definition) };
  if (value.version) return { version: versionSummary(value.version) };
  if (value.draft) return { draft: versionSummary(value.draft), draftToken: value.draftToken };
  if (value.code) return { code: value.code, message: value.message };
  if (value.items) return { items: value.items.length };
  if (value.loop) return { loop: value.loop.name, current: versionSummary(value.current), draft: versionSummary(value.draft), draftToken: value.draftToken };
  return Object.keys(value).slice(0, 8);
}
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text?.slice?.(0, 200);
  }
}
function instrument(page, rec) {
  page.on('request', (r) => {
    if (!isApi(r.url())) return;
    rec.network.push({
      t: rec.now(),
      ev: 'request',
      method: r.method(),
      path: new URL(r.url()).pathname,
      ifMatch: r.headers()['if-match'] ?? null,
      body: r.postData() ? summarizeJson(parse(r.postData())) : undefined,
    });
  });
  page.on('response', async (r) => {
    if (!isApi(r.url())) return;
    const entry = { t: rec.now(), ev: 'response', method: r.request().method(), path: new URL(r.url()).pathname, status: r.status() };
    rec.network.push(entry);
    try {
      entry.body = summarizeJson(parse(await r.text()));
    } catch {
      entry.body = '(unavailable)';
    }
  });
  page.on('requestfailed', (r) => {
    if (!isApi(r.url())) return;
    rec.network.push({ t: rec.now(), ev: 'failed', method: r.method(), path: new URL(r.url()).pathname, error: r.failure()?.errorText });
  });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300));
  });
}
/**
 * One request barrier. `hold-request`: the nth matching request waits in the browser and reaches
 * the gateway only on release. `hold-response`: it reaches the gateway at once (the gateway
 * commits), and its response waits in the browser until release. `abort-after-commit`: as
 * hold-response, but the browser receives a network failure instead.
 */
async function barrier(page, rec, name, { method, path, mode, nth = 1 }) {
  let seen = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const signals = {};
  const promises = {};
  for (const key of ['arrived', 'committed', 'delivered'])
    promises[key] = new Promise((r) => (signals[key] = r));
  const handler = async (route) => {
    const req = route.request();
    if (req.method() !== method || !path.test(new URL(req.url()).pathname)) return route.fallback();
    seen += 1;
    if (seen !== nth) return route.fallback();
    rec.barriers.push({ t: rec.now(), barrier: name, ev: 'issued-by-browser-held', mode });
    signals.arrived();
    if (mode === 'hold-request') {
      await gate;
      rec.barriers.push({ t: rec.now(), barrier: name, ev: 'released-to-gateway' });
      await route.continue();
      signals.delivered();
      return;
    }
    const response = await route.fetch();
    const text = await response.text();
    rec.barriers.push({ t: rec.now(), barrier: name, ev: 'gateway-answered', status: response.status(), body: summarizeJson(parse(text)) });
    signals.committed({ status: response.status(), body: parse(text) });
    await gate;
    if (mode === 'abort-after-commit') {
      await route.abort('failed');
      rec.barriers.push({ t: rec.now(), barrier: name, ev: 'aborted-to-browser' });
    } else {
      await route.fulfill({ response, body: text });
      rec.barriers.push({ t: rec.now(), barrier: name, ev: 'delivered-to-browser' });
    }
    signals.delivered();
  };
  await page.route('**/*', handler);
  return {
    ...promises,
    release: () => release(),
    remove: () => page.unroute('**/*', handler),
  };
}
async function uiState(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    heading: document.querySelector('h1')?.textContent ?? null,
    header: document.querySelector('header')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    saveState: document.querySelector('[data-testid=save-state]')?.textContent ?? null,
    notices: [...document.querySelectorAll('main [role=alert], main [role=status], [role=alert], [role=status]')]
      .map((e) => e.textContent.replace(/\s+/g, ' ').trim())
      .filter((text, index, all) => text && all.indexOf(text) === index),
    name: document.querySelector('#loop-name')?.value ?? null,
    description: document.querySelector('#loop-description')?.value ?? null,
    publishButton: [...document.querySelectorAll('header button')].map((b) => b.textContent.trim()).find((t) => /^Publish/.test(t)) ?? null,
  }));
}
async function rowText(page, id) {
  const row = page.locator('tr', { has: page.locator(`a[href$="/loops/${id}/edit"]`) }).first();
  if ((await row.count()) === 0) return null;
  return (await row.innerText()).replace(/\s+/g, ' ').trim();
}
const RECONCILING = 'The editor is available. Checking the server and this device before saving changes.';
async function waitEditor(page) {
  await page.locator('h1').first().waitFor({ timeout: 20_000 });
  await page.getByText(RECONCILING, { exact: true }).waitFor({ state: 'hidden', timeout: 20_000 });
  await page.locator('[data-testid=save-state]').waitFor({ timeout: 20_000 });
}
async function showPanel(page) {
  const show = page.getByRole('button', { name: 'Show loop settings' });
  if (await show.isVisible()) await show.click();
  await page.locator('#loop-description').waitFor({ timeout: 10_000 });
}
const putOf = (id) => (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/loops/${id}/draft`;
const postPublishOf = (id) => (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/loops/${id}/publish`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 10_000, step = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return value;
    await delay(step);
  }
}
async function toLoops(page) {
  await page.locator('header').getByRole('link', { name: 'Loops', exact: true }).click();
}
async function openRow(page, id) {
  await page.locator(`a[href$="/loops/${id}/edit"]`).first().click();
}

// ---------------------------------------------------------------- scenarios
const scenarios = {};

/** N1: the POST commits at the gateway; its response is held while A2 is authored and saved. */
scenarios['publish-held-response-after-commit'] = async (s) => {
  const id = await createLoop(exitLoop(`#237 ${tag} N1`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const a1 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('A1');
  s.note('A1 PUT', (await a1).status());
  await until(async () => (await uiState(page)).saveState === 'All changes saved');
  const hold = await barrier(page, s, 'publish', { method: 'POST', path: new RegExp(`/loops/${id}/publish$`), mode: 'hold-response' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const committed = await hold.committed;
  s.note('POST answered at gateway (held from browser)', committed.status, versionSummary(committed.body.version));
  s.rest.afterCommit = await readback(id);
  const a2 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('A2');
  s.note('A2 PUT', (await a2).status());
  await until(async () => (await uiState(page)).saveState === 'All changes saved');
  s.ui.beforeRelease = await uiState(page);
  hold.release();
  await hold.delivered;
  await until(async () => (await uiState(page)).notices.some((n) => /Publish/.test(n)), 5000);
  await delay(300);
  s.ui.afterRelease = await uiState(page);
  await s.shot(page, 'after-release');
  s.rest.final = await readback(id);
  const vid = committed.body.version?.id;
  s.rest.versionById = vid ? versionSummary((await rest('GET', `/loops/${id}/versions/${vid}`)).body) : null;
  const shown = s.ui.afterRelease.notices.join(' | ');
  s.check('D1 success notice while newer A2 is in the editor', {
    expected: 'notice names version 1 as the A1 snapshot and says later changes are not published',
    observed: shown,
    editorDescription: s.ui.afterRelease.description,
    reproduced: /Published version 1\./.test(shown) && s.ui.afterRelease.description === 'A2' && !/not published/i.test(shown),
  });
};

/** N1b: the held response is released into a newer editor load (Reload server draft). */
scenarios['publish-held-response-new-generation'] = async (s) => {
  const id = await createLoop(exitLoop(`#237 ${tag} N1b`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const a1 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('A1');
  s.note('A1 PUT', (await a1).status());
  await until(async () => (await uiState(page)).saveState === 'All changes saved');
  const hold = await barrier(page, s, 'publish', { method: 'POST', path: new RegExp(`/loops/${id}/publish$`), mode: 'hold-response' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const committed = await hold.committed;
  s.note('POST answered at gateway', committed.status, versionSummary(committed.body.version));
  const token = (await detail(id)).body.draftToken;
  const other = await rest('PUT', `/loops/${id}/draft`, { definition: { ...exitLoop(`#237 ${tag} N1b`, 'B by other writer') } }, { 'if-match': `"${token}"` });
  s.note('other writer PUT B', other.status);
  const conflict = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('E');
  s.note('editor PUT E', (await conflict).status());
  await page.getByRole('button', { name: 'Reload server draft' }).first().click();
  await until(async () => (await uiState(page)).description === 'B by other writer');
  s.ui.reloaded = await uiState(page);
  hold.release();
  await hold.delivered;
  await delay(800);
  s.ui.afterRelease = await uiState(page);
  await s.shot(page, 'after-release');
  s.rest.final = await readback(id);
  const shown = s.ui.afterRelease.notices.join(' | ');
  s.check('D1 old publish feedback shown in a newer editor load', {
    expected: 'no feedback from the earlier load’s attempt in the reloaded editor',
    observed: shown,
    editorDescription: s.ui.afterRelease.description,
    reproduced: /Published version 1\./.test(shown),
  });
};

/** N2/N3: the POST is held before admission while another writer changes the draft. */
for (const publishFirst of [false, true]) {
  scenarios[publishFirst ? 'publish-held-request-competing-publish' : 'publish-held-request-other-save'] = async (s) => {
    const name = `#237 ${tag} ${publishFirst ? 'N3' : 'N2'}`;
    const id = await createLoop(exitLoop(name, 'orig'));
    const page = await s.page();
    await page.goto(`${url}/app/loops/${id}/edit`);
    await waitEditor(page);
    await showPanel(page);
    const a1 = page.waitForResponse(putOf(id));
    await page.locator('#loop-description').fill('A1');
    const a1Response = await a1;
    const a1Body = await a1Response.json();
    s.note('A1 PUT', a1Response.status(), versionSummary(a1Body.draft), a1Body.draftToken);
    await until(async () => (await uiState(page)).saveState === 'All changes saved');
    const hold = await barrier(page, s, 'publish', { method: 'POST', path: new RegExp(`/loops/${id}/publish$`), mode: 'hold-request' });
    const posted = page.waitForResponse(postPublishOf(id));
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await hold.arrived;
    const other = await rest('PUT', `/loops/${id}/draft`, { definition: exitLoop(name, 'B by other writer') }, { 'if-match': `"${a1Body.draftToken}"` });
    s.note('other writer PUT B (If-Match A1 token)', other.status, versionSummary(other.body.draft), other.body.draftToken);
    if (publishFirst) {
      const pub = await rest('POST', `/loops/${id}/publish`);
      s.note('other writer POST publish', pub.status, versionSummary(pub.body.version));
    }
    hold.release();
    const response = await posted;
    s.note('editor POST', response.status(), summarizeJson(parse(await response.text())));
    await until(async () => (await uiState(page)).notices.some((n) => /ublish/.test(n)), 5000);
    await delay(300);
    s.ui.afterRelease = await uiState(page);
    await s.shot(page, 'after-release');
    s.rest.final = await readback(id);
    const shown = s.ui.afterRelease.notices.join(' | ');
    if (publishFirst)
      s.check('D2 NO_DRAFT shown as nothing changed while another draft is current', {
        expected: 'nothing published by this request; current version holds a different draft; local work kept for explicit recovery',
        observed: shown,
        currentDescription: s.rest.final.detail.current?.description,
        reproduced: /no changes since the published version/.test(shown) && s.rest.final.detail.current?.description === 'B by other writer',
      });
    else
      s.check('D1/D2 publish certifies the clicked draft though the version holds another', {
        expected: 'returned version holds a different stored draft than the acknowledged A1; mismatch stated; local work kept',
        observed: shown,
        versionDescription: s.rest.final.detail.current?.description,
        reproduced: /Published version 1\./.test(shown) && s.rest.final.detail.current?.description === 'B by other writer' && !/different/i.test(shown),
      });
    // What a reload does with this editor's A1 after the mismatch (baseline device semantics).
    await page.reload();
    await waitEditor(page);
    await showPanel(page);
    await delay(500);
    s.ui.afterReload = await uiState(page);
    s.check('A1 kept for explicit recovery after reload', {
      observed: { description: s.ui.afterReload.description, saveState: s.ui.afterReload.saveState, notices: s.ui.afterReload.notices },
      reproduced: s.ui.afterReload.description !== 'A1' && !s.ui.afterReload.notices.some((n) => /device|changed on the server/i.test(n)),
    });
  };
}

/** N4: the POST commits; the browser sees a network failure instead of its response. */
scenarios['publish-lost-response-after-commit'] = async (s) => {
  const id = await createLoop(exitLoop(`#237 ${tag} N4`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const a1 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('A1');
  s.note('A1 PUT', (await a1).status());
  await until(async () => (await uiState(page)).saveState === 'All changes saved');
  const hold = await barrier(page, s, 'publish', { method: 'POST', path: new RegExp(`/loops/${id}/publish$`), mode: 'abort-after-commit' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const committed = await hold.committed;
  s.note('POST answered at gateway (dropped before the browser)', committed.status, versionSummary(committed.body.version));
  hold.release();
  await hold.delivered;
  await until(async () => (await uiState(page)).notices.some((n) => /ublish/.test(n)), 5000);
  await delay(500);
  s.ui.afterDrop = await uiState(page);
  await s.shot(page, 'after-drop');
  s.rest.afterDrop = await readback(id);
  const shown = s.ui.afterDrop.notices.join(' | ');
  s.check('D3 lost response reported as failure though the gateway published', {
    expected: 'outcome read back before any claim or retry; the current version is found to hold this draft',
    observed: shown,
    current: s.rest.afterDrop.detail.current,
    reproduced: /Publish failed/.test(shown) && s.rest.afterDrop.detail.current?.description === 'A1',
  });
  await hold.remove();
  const retry = page.waitForResponse(postPublishOf(id));
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const r = await retry;
  s.note('retry POST', r.status(), summarizeJson(parse(await r.text())));
  await delay(500);
  s.ui.afterRetry = await uiState(page);
  s.rest.afterRetry = await readback(id);
};

/** N5: #156 list convergence after leaving the editor (three orders). */
for (const variant of ['warm-leave-before-debounce', 'warm-save-in-flight', 'cold-leave-before-debounce']) {
  scenarios[`list-${variant}`] = async (s) => {
    const nameA = `#237 ${tag} N5 ${variant} A`;
    const id = await createLoop(exitLoop(nameA, 'desc A'));
    const control = await createLoop(exitLoop(`#237 ${tag} N5 ${variant} B`, 'desc B'));
    s.note('publish A', (await rest('POST', `/loops/${id}/publish`)).status);
    const run = await rest('POST', `/loops/${id}/runs`, {});
    s.note('provider-free run on A', run.status, run.body.run?.status ?? run.body);
    await until(async () => ['succeeded', 'failed'].includes((await rest('GET', `/runs/${run.body.run?.id}`)).body.status), 10_000);
    s.rest.before = await readback(id);
    s.rest.controlBefore = await readback(control);
    const page = await s.page();
    if (variant.startsWith('warm')) {
      await page.goto(`${url}/app/loops`);
      await page.locator(`a[href$="/loops/${id}/edit"]`).first().waitFor();
      s.ui.listBefore = { a: await rowText(page, id), b: await rowText(page, control) };
      await openRow(page, id);
    } else {
      await page.goto(`${url}/app/loops/${id}/edit`);
    }
    await waitEditor(page);
    await showPanel(page);
    // Let the list's 2 s staleness pass so returning to it refetches (warm) as a user would see.
    await delay(2200);
    const hold = await barrier(page, s, 'save', { method: 'PUT', path: new RegExp(`/loops/${id}/draft$`), mode: 'hold-request' });
    const listHold = await barrier(page, s, 'list', { method: 'GET', path: /^\/loops$/, mode: 'hold-response' });
    await page.locator('#loop-name').fill(`${nameA} renamed`);
    await page.locator('#loop-description').fill('');
    if (variant === 'warm-save-in-flight') await hold.arrived; // the debounced save is in flight
    await toLoops(page);
    await hold.arrived;
    await listHold.committed; // the list read was answered by the gateway before the save commits
    s.note('list read answered pre-commit (held from browser)');
    const saved = page.waitForResponse(putOf(id));
    hold.release();
    const savedResponse = await saved;
    const commitT = s.now();
    s.note('save PUT answered', savedResponse.status(), 'at', commitT);
    await delay(1500);
    const listReadsAfterCommit = s.network.filter((e) => e.ev === 'request' && e.method === 'GET' && e.path === '/loops' && e.t > commitT);
    s.ui.rowBeforeOldRelease = await rowText(page, id);
    listHold.release();
    await listHold.delivered;
    await delay(400);
    s.ui.rowAfterOldRelease = await rowText(page, id);
    await s.shot(page, 'after-old-list-release');
    const converged = await until(async () => {
      const text = await rowText(page, id);
      return text && text.includes('renamed') && !text.includes('desc A') ? { text, t: s.now() } : null;
    }, 8000);
    s.ui.converged = converged;
    s.ui.controlRow = await rowText(page, control);
    s.rest.final = await readback(id);
    s.rest.controlFinal = await readback(control);
    s.check('D5 list stays stale after an acknowledged leaving save', {
      expected: 'a list read issued after the save reply; the row converges without the poll and the old reply cannot roll it back',
      listReadsIssuedWithin1500msOfCommit: listReadsAfterCommit.map((e) => e.t - commitT),
      rowBeforeOldRelease: s.ui.rowBeforeOldRelease,
      rowAfterOldRelease: s.ui.rowAfterOldRelease,
      convergedMsAfterCommit: converged ? converged.t - commitT : null,
      reproduced: listReadsAfterCommit.length === 0 && Boolean(s.ui.rowAfterOldRelease?.includes('desc A')),
    });
  };
}

/** N6: an old leaving save runs after a re-entry loaded another writer's draft. */
scenarios['reentry-unmount-token-ancestry'] = async (s) => {
  const name = `#237 ${tag} N6`;
  const id = await createLoop(exitLoop(name, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const t0 = (await detail(id)).body.draftToken;
  const hold = await barrier(page, s, 's1', { method: 'PUT', path: new RegExp(`/loops/${id}/draft$`), mode: 'hold-request' });
  await page.locator('#loop-description').fill('S1');
  await hold.arrived; // S1 debounced save issued, held before admission
  await page.locator('#loop-description').fill('U');
  await toLoops(page); // leave before U's debounce: the leaving save queues behind S1
  await page.locator(`a[href$="/loops/${id}/edit"]`).first().waitFor();
  const other = await rest('PUT', `/loops/${id}/draft`, { definition: exitLoop(name, 'B by other writer') }, { 'if-match': `"${t0}"` });
  s.note('other writer PUT B (If-Match T0)', other.status, other.body.draftToken);
  await openRow(page, id);
  await waitEditor(page);
  await showPanel(page);
  await delay(500);
  s.ui.reentered = await uiState(page);
  hold.release();
  await until(async () => s.network.filter((e) => e.ev === 'response' && e.method === 'PUT').length >= 2, 5000);
  await delay(800);
  s.ui.final = await uiState(page);
  await s.shot(page, 'final');
  s.rest.final = await readback(id);
  const puts = s.network.filter((e) => e.ev === 'request' && e.method === 'PUT');
  const leaving = puts.find((e) => e.body?.definition?.description === 'U');
  s.check('D6 leaving save of an earlier load borrows a newer load’s token', {
    expected: "U is sent with its own load's base (T0) or skipped; the other writer's B stays",
    t0,
    otherWriterToken: other.body.draftToken,
    leavingSaveIfMatch: leaving?.ifMatch ?? null,
    serverDraftDescription: s.rest.final.detail.draft?.description,
    reproduced: leaving?.ifMatch === `"${other.body.draftToken}"` && s.rest.final.detail.draft?.description === 'U',
  });
};

/** N7: conflict, edit, Reload server draft, then leave within the debounce. */
scenarios['reload-then-leave-old-snapshot'] = async (s) => {
  const name = `#237 ${tag} N7`;
  const id = await createLoop(exitLoop(name, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const t0 = (await detail(id)).body.draftToken;
  const other = await rest('PUT', `/loops/${id}/draft`, { definition: exitLoop(name, 'B by other writer') }, { 'if-match': `"${t0}"` });
  s.note('other writer PUT B', other.status, other.body.draftToken);
  const refused = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('C1');
  s.note('editor PUT C1', (await refused).status());
  await page.getByRole('button', { name: 'Reload server draft' }).first().waitFor();
  const editAt = Date.now();
  await page.locator('#loop-description').fill('U');
  await page.getByRole('button', { name: 'Reload server draft' }).first().click();
  await until(async () => (await uiState(page)).description === 'B by other writer', 3000, 10);
  await toLoops(page);
  const leftAfterMs = Date.now() - editAt;
  s.note('left the editor ms after the U edit', leftAfterMs);
  await delay(2000);
  s.rest.final = await readback(id);
  const putsAfter = s.network.filter((e) => e.ev === 'request' && e.method === 'PUT' && e.body?.definition?.description === 'U');
  s.check('D6 earlier load’s debounced snapshot sent after Reload server draft', {
    expected: 'no PUT from the earlier load; the reloaded draft B stays on the server',
    leftAfterMs,
    uPuts: putsAfter,
    serverDraftDescription: s.rest.final.detail.draft?.description,
    timingValid: leftAfterMs < 600,
    reproduced: putsAfter.length > 0 && s.rest.final.detail.draft?.description === 'U',
  });
};

/** N8: held input typed while the publish's save is held. */
scenarios['held-input-during-flush'] = async (s) => {
  const id = await createLoop(approvalLoop(`#237 ${tag} N8`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const hold = await barrier(page, s, 'flush-save', { method: 'PUT', path: new RegExp(`/loops/${id}/draft$`), mode: 'hold-request' });
  await page.locator('#loop-description').fill('H1');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await hold.arrived;
  await page.getByTestId('node-approve').locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const schema = dialog.locator('[data-field="inputSchema"] .cm-content');
  await schema.click();
  await page.keyboard.type('{"type": ');
  await delay(300);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  s.ui.held = await uiState(page);
  hold.release();
  await delay(2000);
  s.ui.final = await uiState(page);
  await s.shot(page, 'final');
  s.rest.final = await readback(id);
  const posts = s.network.filter((e) => e.ev === 'request' && e.method === 'POST' && e.path.endsWith('/publish'));
  s.check('D4 held input typed during the save does not stop the publish', {
    expected: 'no POST; the held-input refusal',
    posts: posts.length,
    notices: s.ui.final.notices,
    reproduced: posts.length > 0,
  });
};

/** N9 (D8): re-entry whose detail read is answered before the leaving save commits. */
scenarios['reentry-detail-read-across-leaving-commit'] = async (s) => {
  const id = await createLoop(exitLoop(`#237 ${tag} N9`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const hold = await barrier(page, s, 'leaving-save', { method: 'PUT', path: new RegExp(`/loops/${id}/draft$`), mode: 'hold-request' });
  await page.locator('#loop-description').fill('U');
  await toLoops(page);
  await hold.arrived;
  await page.locator(`a[href$="/loops/${id}/edit"]`).first().waitFor();
  const detailHold = await barrier(page, s, 'reentry-detail', { method: 'GET', path: new RegExp(`^/loops/${id}$`), mode: 'hold-response' });
  await openRow(page, id);
  const answered = await detailHold.committed;
  s.note('re-entry detail answered pre-commit', versionSummary(answered.body.draft), answered.body.draftToken);
  await page.locator('h1').first().waitFor();
  await showPanel(page).catch(() => undefined);
  s.ui.warm = await uiState(page);
  const saved = page.waitForResponse(putOf(id));
  hold.release();
  const savedResponse = await saved;
  s.note('leaving save answered', savedResponse.status());
  await delay(300);
  detailHold.release();
  await detailHold.delivered;
  await waitEditor(page);
  await delay(800);
  s.ui.final = await uiState(page);
  await s.shot(page, 'final');
  s.rest.final = await readback(id);
  s.check('D8 re-entry reconciles to the older server read over the warm copy', {
    expected: 'editor keeps U (the server holds U); no older content shown as saved',
    editor: { description: s.ui.final.description, saveState: s.ui.final.saveState, notices: s.ui.final.notices },
    serverDraftDescription: s.rest.final.detail.draft?.description,
    reproduced: s.ui.final.description !== 'U' && s.rest.final.detail.draft?.description === 'U',
  });
};

/** N10: ordinary release, no-op publish, validation reads, provider-free run and immutability. */
scenarios['normal-release'] = async (s) => {
  const id = await createLoop(exitLoop(`#237 ${tag} N10`, 'orig'));
  const page = await s.page();
  await page.goto(`${url}/app/loops/${id}/edit`);
  await waitEditor(page);
  await showPanel(page);
  const r1 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('R1');
  s.note('R1 PUT', (await r1).status());
  await until(async () => (await uiState(page)).saveState === 'All changes saved');
  await delay(1000);
  const posted = page.waitForResponse(postPublishOf(id));
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const response = await posted;
  const publishT = s.now();
  const body = await response.json();
  s.note('POST', response.status(), versionSummary(body.version));
  await delay(1500);
  s.ui.published = await uiState(page);
  await s.shot(page, 'published');
  const validateAfter = s.network.filter((e) => e.ev === 'request' && e.path === `/loops/${id}/validate` && e.t > publishT);
  s.check('D7 publish refetches the unchanged open editor’s API checks', {
    expected: 'no validation request for the unchanged open draft after publish',
    validateRequestsAfterPublish: validateAfter.length,
    reproduced: validateAfter.length > 0,
  });
  const vid = body.version.id;
  s.rest.versionById = versionSummary((await rest('GET', `/loops/${id}/versions/${vid}`)).body);
  const run = await rest('POST', `/loops/${id}/runs`, {});
  const runId = run.body.run?.id;
  const finished = await until(async () => {
    const r = await rest('GET', `/runs/${runId}`);
    return ['succeeded', 'failed', 'cancelled'].includes(r.body.status) ? r.body : null;
  }, 10_000);
  s.rest.run = { status: finished?.status, versionId: finished?.versionId, matchesPublished: finished?.versionId === vid };
  const noop = page.waitForResponse(postPublishOf(id));
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const noopResponse = await noop;
  s.note('no-op POST', noopResponse.status(), summarizeJson(parse(await noopResponse.text())));
  await delay(500);
  s.ui.noop = await uiState(page);
  await s.shot(page, 'noop');
  const r2 = page.waitForResponse(putOf(id));
  await page.locator('#loop-description').fill('R2');
  s.note('R2 PUT', (await r2).status());
  await delay(500);
  s.ui.afterR2 = await uiState(page);
  s.rest.final = await readback(id);
  s.rest.versionByIdAfter = versionSummary((await rest('GET', `/loops/${id}/versions/${vid}`)).body);
  s.check('release immutable and run pinned (guard)', {
    observed: { version: s.rest.versionByIdAfter, current: s.rest.final.detail.current, draft: s.rest.final.detail.draft, run: s.rest.run },
    reproduced: !(s.rest.versionByIdAfter.description === 'R1' && s.rest.final.detail.current?.id === vid && s.rest.run.matchesPublished),
  });
};

/** N11: existing refusals: a #209 name refusal never reaches the list; #273 LOOP_INVALID. */
scenarios['existing-refusals'] = async (s) => {
  const takenName = `#237 ${tag} N11 taken`;
  const taken = await createLoop(exitLoop(takenName, 'taken'));
  const id = await createLoop(exitLoop(`#237 ${tag} N11 mine`, 'mine'));
  const page = await s.page();
  await page.goto(`${url}/app/loops`);
  await page.locator(`a[href$="/loops/${id}/edit"]`).first().waitFor();
  await openRow(page, id);
  await waitEditor(page);
  await showPanel(page);
  const refused = page.waitForResponse(putOf(id));
  await page.locator('#loop-name').fill(takenName);
  const refusal = await refused;
  s.note('name PUT', refusal.status(), summarizeJson(parse(await refusal.text())));
  await delay(300);
  s.ui.nameRefused = await uiState(page);
  await toLoops(page);
  await delay(6000);
  s.ui.listAfterRefusal = await rowText(page, id);
  s.rest.afterRefusal = await readback(id);
  s.check('refused name kept out of the list (guard)', {
    row: s.ui.listAfterRefusal,
    reproduced: Boolean(s.ui.listAfterRefusal?.includes('N11 taken')),
  });
  const broken = exitLoop(`#237 ${tag} N11 invalid`, 'broken');
  broken.nodes[1].config = { returns: 'gates.missing.passes' };
  const invalid = await createLoop(broken);
  await page.goto(`${url}/app/loops/${invalid}/edit`);
  await waitEditor(page);
  const post = page.waitForResponse(postPublishOf(invalid));
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const r = await post;
  s.note('LOOP_INVALID POST', r.status(), summarizeJson(parse(await r.text())));
  await delay(500);
  s.ui.invalid = await uiState(page);
  await s.shot(page, 'loop-invalid');
  s.rest.invalid = await readback(invalid);
  s.check('LOOP_INVALID refusal explicit (guard)', {
    notices: s.ui.invalid.notices,
    reproduced: !s.ui.invalid.notices.some((n) => /Publish failed/.test(n)),
  });
};

// ---------------------------------------------------------------- runner
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const names = which === 'all' ? Object.keys(scenarios) : which.split(',');
const summary = { url, playwrightVersion, browserVersion: browser.version(), node: process.version, startedAt: new Date().toISOString(), scenarios: {} };
for (const name of names) {
  const started = Date.now();
  const contexts = [];
  const rec = {
    name,
    network: [],
    barriers: [],
    steps: [],
    ui: {},
    rest: {},
    checks: {},
    pageErrors: [],
    consoleErrors: [],
    now: () => Date.now() - started,
    note: (...args) => rec.steps.push({ t: rec.now(), note: args }),
    check: (label, value) => (rec.checks[label] = value),
    page: async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
      contexts.push(context);
      const page = await context.newPage();
      instrument(page, rec);
      return page;
    },
    shot: async (page, label) => {
      const file = join(runDir, 'screens', `${name}-${label}.png`);
      await page.screenshot({ path: file });
      rec.steps.push({ t: rec.now(), screenshot: file });
    },
  };
  try {
    await scenarios[name](rec);
  } catch (error) {
    rec.error = String(error?.stack ?? error);
  }
  for (const context of contexts) await context.close().catch(() => undefined);
  const { now: _n, note: _o, check: _c, page: _p, shot: _s, ...out } = rec;
  await writeFile(join(runDir, 'scenarios', `${name}.json`), JSON.stringify(out, null, 2) + '\n');
  summary.scenarios[name] = {
    error: rec.error ? rec.error.split('\n')[0] : undefined,
    checks: Object.fromEntries(Object.entries(rec.checks).map(([k, v]) => [k, v.reproduced])),
  };
  console.log(name, JSON.stringify(summary.scenarios[name]));
}
await browser.close();
gateway.stdin.end();
const code = await gatewayExit;
let stillListening = true;
try {
  await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
} catch {
  stillListening = false;
}
summary.finishedAt = new Date().toISOString();
await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(
  join(runDir, 'cleanup.json'),
  JSON.stringify({ gatewayPid: gateway.pid, gatewayExitCode: code, gatewayStillListening: stillListening, browserClosed: true, gatewayStderr: gatewayLog.slice(-2000) }, null, 2) + '\n',
);
console.log('DONE', JSON.stringify({ gatewayExitCode: code, stillListening }));
