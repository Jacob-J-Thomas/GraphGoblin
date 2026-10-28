// Reviewer behaviour check for WP-425 (independent review, 2026-10-28).
// Drives the built API (apps/api/dist/main.js) on a disposable store under %TEMP%\gg-rev425-*,
// serving a given web build, in headless Edge through Playwright. No run is started and no
// provider is called: GG_CODEX_BINARY and GG_CLAUDE_BINARY point at a file that does not exist.
//   node rev425-behaviour.mjs <label> <port 6350-6359> <web dist>
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, '..', '..', '..', '..');
const requireWeb = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'));
const { chromium } = requireWeb('@playwright/test');

const [label, portText, distArg] = process.argv.slice(2);
const port = Number(portText);
if (!label || !(port >= 6350 && port <= 6359) || !distArg) throw new Error('usage: <label> <port 6350-6359> <dist>');
const dist = path.resolve(distArg);
const home = os.homedir();
const redact = (text) =>
  String(text)
    .split(home).join('%USERPROFILE%')
    .split(home.replaceAll('\\', '/')).join('%USERPROFILE%')
    .split(home.replaceAll('\\', '\\\\')).join('%USERPROFILE%')
    .replace(new RegExp(os.hostname(), 'gi'), '%COMPUTERNAME%');
const logFile = path.join(OUT, `${label}-behaviour.log.txt`);
fs.writeFileSync(logFile, '');
const t0 = Date.now();
const log = (message, data) => {
  const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s ${message}${data === undefined ? '' : ' ' + JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, redact(line));
  process.stdout.write(redact(line));
};
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail });
  log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id}`, detail);
};
const observe = (id, detail) => {
  checks.push({ id, ok: null, detail });
  log(`OBSERVE ${id}`, detail);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Gateway on a disposable store ----
const store = fs.mkdtempSync(path.join(os.tmpdir(), `gg-rev425-store-${label}-`));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_') && k.toUpperCase() !== 'JEV_API_KEY'),
);
Object.assign(env, {
  GG_DATA_DIR: store,
  GG_HOST: '127.0.0.1',
  GG_PORT: String(port),
  GG_WEB_DIST: dist,
  GG_REQUIRE_API_KEY: 'false',
  GG_CODEX_BINARY: path.join(store, 'no-cli', 'codex.exe'),
  GG_CLAUDE_BINARY: path.join(store, 'no-cli', 'claude.exe'),
});
const gatewayLog = path.join(store, 'gateway.log');
const child = spawn(process.execPath, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
const sink = fs.createWriteStream(gatewayLog);
child.stdout.pipe(sink, { end: false });
child.stderr.pipe(sink, { end: false });
let exitCode = null;
child.once('exit', (code, signal) => (exitCode = code ?? signal));
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; ; i += 1) {
  if (fs.existsSync(gatewayLog) && fs.readFileSync(gatewayLog, 'utf8').includes('GraphGoblin API listening')) break;
  if (exitCode !== null || i > 900) throw new Error('gateway did not start: ' + fs.readFileSync(gatewayLog, 'utf8'));
  await sleep(100);
}
log('gateway listening', { pid: child.pid, port, label, web: path.basename(dist) });
const api = async (p, init = {}) => {
  const response = await fetch(origin + p, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'content-type': 'application/json' } : {},
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};
const draftOf = async (loopId) => (await api(`/loops/${loopId}`)).json.draft.definition;
const positions = async (loopId) =>
  Object.fromEntries((await draftOf(loopId)).nodes.map((n) => [n.id, n.ui ?? null]));

// ---- Browser helpers ----
const browser = await chromium.launch({ channel: 'msedge', headless: true });
log('browser', { version: browser.version() });
let page;
async function newPage(theme = 'dark') {
  if (page) await page.context().close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
  page = await context.newPage();
  return page;
}
async function settle() {
  await page.locator('.react-flow__viewport').evaluate(async (viewport) => {
    let previous = viewport.getAttribute('style');
    let since = performance.now();
    await new Promise((done) => {
      const frame = () => {
        const current = viewport.getAttribute('style');
        if (current !== previous) {
          previous = current;
          since = performance.now();
        }
        if (performance.now() - since >= 220) done();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
}
async function fit() {
  await settle();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Fit view' }).click();
  await settle();
}
async function hidePanels() {
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}
async function showPalette() {
  const button = page.getByRole('button', { name: 'Show palette', exact: true });
  if (await button.isVisible()) await button.click();
}
async function saved() {
  await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 20_000 });
}
async function openNode(id) {
  await fit();
  await page.getByTestId(`node-${id}`).locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  return dialog;
}
async function closeNode() {
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function connect(dialog, output, to) {
  await dialog.getByLabel('Output', { exact: true }).selectOption(output);
  await dialog.getByLabel('To', { exact: true }).selectOption(to);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
}
async function press(kind) {
  await showPalette();
  await page.getByRole('button', { name: `Add ${kind} node`, exact: true }).click();
  await page.getByTestId(`node-${kind.toLowerCase()}`).waitFor();
  await settle();
}
async function configureGate(id) {
  const dialog = await openNode(id);
  await dialog.locator('[data-field="routes.0.id"] input').fill('again');
  await dialog.locator('[data-field="routes.0.label"] input').fill('Again');
  await dialog.locator('[data-field="routes.1.id"] input').fill('finish');
  await dialog.locator('[data-field="routes.1.label"] input').fill('Finish');
  await dialog.locator('[data-field="routes.0.repeat"]').getByRole('switch').click();
  await dialog.locator('[data-field="maxPasses"] input').fill('2');
  await closeNode();
  await page.getByTestId(`node-${id}`).locator('.source').nth(2).waitFor();
}
async function createInUi(name) {
  await page.goto(`${origin}/app/loops`);
  await page.getByLabel('New loop name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/loops\/[0-9A-Z]{26}\/edit$/);
  await page.locator('.react-flow__node').first().waitFor();
  return page.url().split('/').at(-2);
}
async function createByApi(definition) {
  const created = await api('/loops', { method: 'POST', body: { definition } });
  if (created.status !== 201) throw new Error('create failed ' + JSON.stringify(created.json));
  return created.json.loop.id;
}
async function openLoop(loopId, count) {
  await page.goto(`${origin}/app/loops/${loopId}/edit`);
  await page.locator('.react-flow__node').nth(count - 1).waitFor();
  await hidePanels();
  await fit();
}

/** Card, label and leader geometry on screen, with each label's distance to its own path. */
async function geometry() {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const viewport = document.querySelector('.react-flow__viewport');
    const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
    const cards = [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.getAttribute('data-id'), ...box(n) }));
    const distanceTo = (path, point) => {
      const m = path.getScreenCTM();
      let best = Infinity;
      const total = path.getTotalLength();
      for (let at = 0; at <= total; at += 1) {
        const p = path.getPointAtLength(at).matrixTransform(m);
        best = Math.min(best, Math.hypot(p.x - point.x, p.y - point.y));
      }
      return best;
    };
    const edges = [...document.querySelectorAll('.react-flow__edge')].map((e) => {
      const label = e.querySelector('.react-flow__edge-textwrapper');
      const path = e.querySelector('.react-flow__edge-path');
      const leader = e.querySelector('.gg-edge-label-leader');
      const result = {
        id: e.getAttribute('data-id'),
        type: [...e.classList].find((c) => c.startsWith('react-flow__edge-') && c !== 'react-flow__edge-path') ?? null,
        text: label?.textContent ?? null,
        title: e.querySelector('title')?.textContent ?? null,
        aria: e.getAttribute('aria-label'),
        label: label ? box(label) : null,
        attachPx: null,
        leader: null,
      };
      if (label && path) {
        const r = label.getBoundingClientRect();
        result.attachPx = +distanceTo(path, { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }).toFixed(1);
      }
      if (leader && path) {
        const total = leader.getTotalLength();
        const m = leader.getScreenCTM();
        const start = leader.getPointAtLength(0).matrixTransform(m);
        result.leader = {
          screenLength: +(total * zoom).toFixed(1),
          anchorToPathPx: +distanceTo(path, start).toFixed(1),
          stroke: getComputedStyle(leader).stroke,
          crossesCards: [...document.querySelectorAll('.react-flow__node')]
            .filter((n) => {
              const b = n.getBoundingClientRect();
              for (let at = 0; at <= total; at += 2) {
                const p = leader.getPointAtLength(at).matrixTransform(m);
                if (p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom) return true;
              }
              return false;
            })
            .map((n) => n.getAttribute('data-id')),
        };
      }
      return result;
    });
    return { zoom, cards, edges, canvas: getComputedStyle(document.querySelector('.react-flow')).backgroundColor };
  });
}
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function pairs(items, name) {
  const hits = [];
  items.forEach((a, i) => items.slice(i + 1).forEach((b) => overlap(a, b) && hits.push(`${name(a)} / ${name(b)}`)));
  return hits;
}
function assess(id, g) {
  const labels = g.edges.filter((e) => e.label);
  const cardHits = pairs(g.cards, (c) => c.id);
  const labelHits = pairs(labels.map((e) => ({ ...e.label, id: e.id, text: e.text })), (l) => `${l.id}:${l.text}`);
  const labelOnCard = labels.flatMap((e) => g.cards.filter((c) => overlap(e.label, c)).map((c) => `${e.id}:${e.text} on ${c.id}`));
  const detached = labels.filter((e) => !e.leader && e.attachPx > 3).map((e) => `${e.id}:${e.text} ${e.attachPx}px`);
  const titled = labels.filter((e) => !e.title || !e.title.includes(e.text.replace(/…$/, ''))).map((e) => e.id);
  check(`${id} no card boxes intersect`, cardHits.length === 0, cardHits);
  check(`${id} no label boxes intersect`, labelHits.length === 0, labelHits);
  check(`${id} no label sits on a card`, labelOnCard.length === 0, labelOnCard);
  check(`${id} every label without a leader is on its own path (<= 3 px)`, detached.length === 0, detached);
  check(`${id} every label's text is in its edge <title>`, titled.length === 0, titled);
  observe(`${id} labels`, labels.map((e) => ({ id: e.id, type: e.type, text: e.text, attachPx: e.attachPx, leader: e.leader })));
  return { cardHits, labelHits, labelOnCard, detached };
}
const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), animations: 'disabled' });
  log('screenshot', `${label}-${name}.png`);
};
/** A close-up of every label pill and the cards around it. */
const closeUp = async (name) => {
  const g = await geometry();
  const boxes = g.edges.filter((e) => e.label).map((e) => e.label);
  if (!boxes.length) return;
  const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - 60);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.top)) - 60);
  const right = Math.min(1440, Math.max(...boxes.map((b) => b.right)) + 60);
  const bottom = Math.min(1000, Math.max(...boxes.map((b) => b.bottom)) + 60);
  await page.screenshot({
    path: path.join(OUT, `${label}-${name}-labels.png`),
    animations: 'disabled',
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
};
const results = {};
const node = (id, kind, x, y, config, extra = {}) => ({ id, kind, label: extra.label ?? id[0].toUpperCase() + id.slice(1), config, ui: { x, y } });
const gate = (routes) => ({ kind: 'expression', jsonata: '"again"', maxPasses: 2, routes });

try {
  // ---- S1: the brief's order by palette presses only, no card dragged ----
  await newPage();
  const s1 = await createInUi('S1 palette column');
  for (const id of ['start', 'done']) {
    const card = page.locator(`.react-flow__node[data-id="${id}"]`);
    await card.press(' ');
    await card.press('Delete');
    await card.waitFor({ state: 'detached' });
  }
  const s1Positions = [];
  for (const kind of ['Trigger', 'Inference', 'Decision']) {
    await press(kind);
    await saved();
    s1Positions.push({ after: kind, positions: await positions(s1) });
  }
  await configureGate('decision');
  for (const kind of ['Wait', 'Exit']) {
    await press(kind);
    const visible = await page.getByTestId(`node-${kind.toLowerCase()}`).isVisible();
    const inView = await page.getByTestId(`node-${kind.toLowerCase()}`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom && r.left >= c.left && r.right <= c.right;
    });
    check(`S1 pressed ${kind} is visible and inside the canvas after the pan`, visible && inView, { visible, inView });
    await saved();
    s1Positions.push({ after: kind, positions: await positions(s1) });
  }
  const moved = [];
  for (let i = 1; i < s1Positions.length; i += 1)
    for (const [id, ui] of Object.entries(s1Positions[i - 1].positions))
      if (JSON.stringify(s1Positions[i].positions[id]) !== JSON.stringify(ui)) moved.push(`${id} after ${s1Positions[i].after}`);
  check('S1 no existing node moved when a palette entry was pressed', moved.length === 0, moved);
  observe('S1 stored positions after each press', s1Positions);
  for (const [id, connections] of [
    ['trigger', [['out', 'inference']]],
    ['inference', [['out', 'decision']]],
    ['decision', [['again', 'wait'], ['finish', 'exit'], ['limit-reached', 'exit']]],
    ['wait', [['out', 'inference']]],
  ]) {
    const dialog = await openNode(id);
    for (const [port, target] of connections) await connect(dialog, port, target);
    await closeNode();
  }
  await saved();
  check('S1 six connections stored', (await draftOf(s1)).edges.length === 6, (await draftOf(s1)).edges.map((e) => `${e.from.node}:${e.from.port}->${e.to.node}`));
  await hidePanels();
  await fit();
  results.S1 = assess('S1', await geometry());
  await shot('s1-palette-column');
  await closeUp('s1');

  // ---- S2: the F2 record's own order (starter graph kept; Wait added before the Decision grew) ----
  await newPage();
  const s2 = await createInUi('S2 F2 order');
  let dialog = await openNode('start');
  await dialog.getByRole('button', { name: 'Remove edge e1' }).click();
  await closeNode();
  for (const kind of ['Inference', 'Decision', 'Wait']) await press(kind);
  await configureGate('decision');
  for (const [id, connections] of [
    ['start', [['out', 'inference']]],
    ['inference', [['out', 'decision']]],
    ['decision', [['again', 'wait'], ['finish', 'done'], ['limit-reached', 'done']]],
    ['wait', [['out', 'inference']]],
  ]) {
    dialog = await openNode(id);
    for (const [port, target] of connections) await connect(dialog, port, target);
    await closeNode();
  }
  await saved();
  const s2Def = await draftOf(s2);
  observe('S2 stored positions', Object.fromEntries(s2Def.nodes.map((n) => [n.id, n.ui])));
  await hidePanels();
  await fit();
  results.S2 = assess('S2', await geometry());
  await shot('s2-f2-order');
  await closeUp('s2');

  // ---- S7: selecting a labelled forward edge keeps its label; handles show ----
  const finishEdge = s2Def.edges.find((e) => e.from.port === 'finish').id;
  const limitEdge = s2Def.edges.find((e) => e.from.port === 'limit-reached').id;
  const edge = (id) => page.locator(`.react-flow__edge[data-id="${id}"]`);
  const before = (await geometry()).edges.find((e) => e.id === finishEdge);
  await edge(finishEdge).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => document.querySelector(`.react-flow__edge[data-id="${id}"]`)?.classList.contains('selected'), finishEdge);
  await sleep(200);
  const selectedGeometry = await geometry();
  const after = selectedGeometry.edges.find((e) => e.id === finishEdge);
  const shift = before.label && after.label ? Math.hypot(after.label.left - before.label.left, after.label.top - before.label.top) : null;
  check('S7 selecting the Finish edge does not move its label (<= 1 px)', shift !== null && shift <= 1, { before: before.label, after: after.label, type: [before.type, after.type] });
  const handles = await edge(finishEdge).locator('.gg-route-handle').count();
  check('S7 the selected forward edge shows segment handles', handles >= 1, { handles });
  results.S7 = assess('S7 (selected)', selectedGeometry);
  await shot('s7-selected-finish');

  // ---- S3: a manual route on the labelled forward edge ----
  const vertical = edge(finishEdge).locator('.gg-route-handle-x').first();
  const hb = await vertical.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await saved();
  const route = (await draftOf(s2)).edges.find((e) => e.id === finishEdge).ui?.route;
  check('S3 dragging the Finish edge vertical stores a manual route', Array.isArray(route) && route.length > 0, { route });
  await sleep(300);
  const s3 = await geometry();
  const finish3 = s3.edges.find((e) => e.id === finishEdge);
  check('S3 the manually routed edge keeps its accessible name "manual route"', /manual route/.test(finish3.aria ?? ''), finish3.aria);
  results.S3 = assess('S3 (manual route, selected)', s3);
  await shot('s3-manual-route-selected');
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 500 } });
  await sleep(300);
  results.S3b = assess('S3 (manual route, deselected)', await geometry());
  await shot('s3-manual-route');

  // ---- S6: dragging the Decision keeps every label on its path in every sampled frame ----
  await fit();
  const unrelated = (await draftOf(s2)).edges.filter((e) => e.from.node !== 'decision' && e.to.node !== 'decision').map((e) => e.id);
  await page.evaluate((ids) => {
    window.__rev425 = { mutations: 0 };
    const observer = new MutationObserver((list) => (window.__rev425.mutations += list.length));
    for (const id of ids) {
      const el = document.querySelector(`.react-flow__edge[data-id="${id}"]`);
      if (el) observer.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    }
    window.__rev425.observer = observer;
  }, unrelated);
  const header = await page.getByTestId('node-decision').locator(':scope > div:has([data-kind])').boundingBox();
  const sx = header.x + header.width / 2;
  const sy = header.y + header.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const worst = [];
  for (let step = 1; step <= 16; step += 1) {
    // Rightward only: the Wait sits 2 px under the grown Decision in this order.
    await page.mouse.move(sx + step * 6, sy);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const g = await geometry();
    const labels = g.edges.filter((e) => e.label);
    worst.push({
      step,
      maxAttachPx: Math.max(...labels.filter((e) => !e.leader).map((e) => e.attachPx)),
      labelOverlaps: pairs(labels.map((e) => ({ ...e.label, id: e.id })), (l) => l.id).length,
    });
  }
  await page.mouse.up();
  await saved();
  const unrelatedMutations = await page.evaluate(() => {
    window.__rev425.observer.disconnect();
    return window.__rev425.mutations;
  });
  check('S6 every sampled drag frame keeps labels on their own paths (<= 3 px)', worst.every((w) => w.maxAttachPx <= 3), worst);
  observe('S6 DOM mutations on edges not attached to the dragged Decision', { edges: unrelated, unrelatedMutations });
  results.S6 = assess('S6 (after drag)', await geometry());
  await shot('s6-after-drag');

  // ---- S4: a long route label ----
  const longDef = structuredClone(await draftOf(s2));
  longDef.name = 'S4 long label';
  for (const e of longDef.edges) delete e.ui;
  const gateNode = longDef.nodes.find((n) => n.id === 'decision');
  gateNode.config.routes[1].label = 'Finish and send the summary to the reviewer';
  // Reset the manual route and the drag: the S2 layout with a long label.
  const s2Positions = Object.fromEntries(s2Def.nodes.map((n) => [n.id, n.ui]));
  for (const n of longDef.nodes) n.ui = s2Positions[n.id];
  await newPage();
  const s4 = await createByApi(longDef);
  await openLoop(s4, longDef.nodes.length);
  results.S4 = assess('S4', await geometry());
  await shot('s4-long-label');

  // ---- S5: a very short edge between adjacent cards, below other cards ----
  const shortDef = {
    schemaVersion: s2Def.schemaVersion,
    name: 'S5 short edge',
    nodes: [
      node('start', 'trigger', 100, 0, { type: 'manual' }),
      node('work', 'inference', 100, 200, { prompt: { template: 'Hi' } }),
      node('check', 'decision', 0, 400, { kind: 'expression', jsonata: '"yes"', routes: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }),
      node('done', 'exit', 200, 400, {}),
      node('other', 'exit', 520, 400, {}),
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'check' } },
      { id: 'yes', from: { node: 'check', port: 'yes' }, to: { node: 'done' } },
      { id: 'no', from: { node: 'check', port: 'no' }, to: { node: 'other' } },
    ],
  };
  for (const theme of ['dark', 'light']) {
    await newPage(theme);
    const s5 = await createByApi({ ...shortDef, name: `S5 short edge ${theme}` });
    await openLoop(s5, shortDef.nodes.length);
    results[`S5-${theme}`] = assess(`S5 ${theme}`, await geometry());
    const g = await geometry();
    observe(`S5 ${theme} canvas background`, g.canvas);
    await shot(`s5-short-edge-${theme}`);
    if (theme === 'dark') {
      await page.emulateMedia({ forcedColors: 'active' });
      await sleep(300);
      const forced = await geometry();
      observe('S5 forced colours: leader strokes and canvas', { canvas: forced.canvas, leaders: forced.edges.filter((e) => e.leader).map((e) => ({ id: e.id, stroke: e.leader.stroke })) });
      await shot('s5-short-edge-forced-colors');
      await page.emulateMedia({ forcedColors: 'none' });
    }
  }
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  try {
    await shot('error');
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  await fetch(`${origin}/system/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'drain' }) }).catch(() => undefined);
  for (let i = 0; i < 300 && exitCode === null; i += 1) await sleep(100);
  if (exitCode === null) child.kill();
  log('gateway exit', { exitCode });
  const summary = {
    label,
    passed: checks.filter((c) => c.ok === true).length,
    failed: checks.filter((c) => c.ok === false).length,
    observations: checks.filter((c) => c.ok === null).length,
    realProviderTurns: 0,
    checks,
  };
  fs.writeFileSync(path.join(OUT, `${label}-behaviour-result.json`), redact(JSON.stringify(summary, null, 2)) + '\n');
  log(`DONE passed=${summary.passed} failed=${summary.failed} observations=${summary.observations}`);
}
