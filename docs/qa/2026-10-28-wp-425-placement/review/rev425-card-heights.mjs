// Reviewer check for WP-425: the unmeasured card footprint (nodeCardHeight) against NodeCard's
// rendered height for every kind and several port counts, and a palette press right after a
// Decision grows a row (before any wait for xyflow's measurement), on the built API in Edge.
//   node rev425-card-heights.mjs <port 6350-6359> <web dist>
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, '..', '..', '..', '..');
const { chromium } = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'))('@playwright/test');
const port = Number(process.argv[2]);
if (!(port >= 6350 && port <= 6359)) throw new Error('port must be 6350-6359');
const dist = path.resolve(process.argv[3]);
const home = os.homedir();
const redact = (t) => String(t).split(home).join('%USERPROFILE%').split(home.replaceAll('\\', '/')).join('%USERPROFILE%');
const lines = [];
const log = (m, d) => {
  const line = `${m}${d === undefined ? '' : ' ' + JSON.stringify(d)}`;
  lines.push(redact(line));
  console.log(redact(line));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-rev425-store-heights-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_') && k.toUpperCase() !== 'JEV_API_KEY'));
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
const child = spawn(process.execPath, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const sink = fs.createWriteStream(gatewayLog);
child.stdout.pipe(sink, { end: false });
child.stderr.pipe(sink, { end: false });
let exitCode = null;
child.once('exit', (c, s) => (exitCode = c ?? s));
for (let i = 0; ; i += 1) {
  if (fs.existsSync(gatewayLog) && fs.readFileSync(gatewayLog, 'utf8').includes('GraphGoblin API listening')) break;
  if (exitCode !== null || i > 900) throw new Error('gateway did not start');
  await sleep(100);
}
const origin = `http://127.0.0.1:${port}`;
const api = async (p, body) => {
  const r = await fetch(origin + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
};
const footprint = (ports) => 92 + (ports ? 2 + 20 * ports : 0);
const n = (id, kind, x, y, config) => ({ id, kind, label: id, config, ui: { x, y } });
const routes = (ids, repeat = false) => ids.map((id, i) => ({ id, label: id[0].toUpperCase() + id.slice(1), ...(repeat && i === 0 ? { repeat: true } : {}) }));
const definition = {
  schemaVersion: 4,
  name: 'Card heights',
  nodes: [
    n('trigger', 'trigger', 0, 0, { type: 'manual' }),
    n('inference', 'inference', 260, 0, { prompt: { template: 'Hi' } }),
    n('mutate', 'mutate', 520, 0, { operations: [{ op: 'append-message', role: 'note', content: 'Note' }] }),
    n('subloop', 'subloop', 780, 0, { loopRef: { loopId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } }),
    n('wait', 'wait', 1040, 0, { mode: 'input', prompt: 'Go?' }),
    n('heartbeat', 'heartbeat', 1300, 0, { intervalSeconds: 60, maxBeats: 3 }),
    n('exit', 'exit', 0, 300, {}),
    n('script', 'script', 260, 300, { command: 'node', exitCodeRoutes: { 1: 'retry', 2: 'fail' } }),
    n('decision2', 'decision', 520, 300, { kind: 'expression', jsonata: '"yes"', routes: routes(['yes', 'no']) }),
    n('decision3', 'decision', 780, 300, { kind: 'expression', jsonata: '"again"', maxPasses: 2, routes: routes(['again', 'finish'], true) }),
    n('decision6', 'decision', 1040, 300, { kind: 'expression', jsonata: '"a"', routes: routes(['a', 'b', 'c', 'd', 'e', 'f']) }),
    n('gate', 'decision', 1300, 600, { kind: 'expression', jsonata: '"again"', maxPasses: 2, routes: routes(['again', 'finish'], true) }),
  ],
  edges: [],
};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let failed = 0;
try {
  const created = await api('/loops', { definition });
  const loopId = created.loop?.id;
  if (!loopId) throw new Error('create failed ' + JSON.stringify(created));
  await page.goto(`${origin}/app/loops/${loopId}/edit`);
  await page.locator('.react-flow__node').nth(definition.nodes.length - 1).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await sleep(500);
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.react-flow__node')].map((el) => ({
      id: el.getAttribute('data-id'),
      wrapper: el.offsetHeight,
      card: el.querySelector('[data-testid^="node-"]').offsetHeight,
      ports: el.querySelectorAll('.react-flow__handle.source').length,
    })),
  );
  for (const c of cards) {
    const ok = c.wrapper === footprint(c.ports);
    if (!ok) failed += 1;
    log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: ports ${c.ports}, rendered ${c.wrapper} px (card ${c.card}), footprint ${footprint(c.ports)} px`);
  }
  // Grow the lowest card by one route, then press a palette entry at once.
  await page.getByRole('button', { name: 'Fit view' }).click();
  await sleep(300);
  await page.getByTestId('node-gate').locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Add routes' }).click();
  await dialog.locator('[data-field="routes.2.id"] input').fill('extra');
  await dialog.locator('[data-field="routes.2.label"] input').fill('Extra');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add Exit node', exact: true }).click();
  await page.getByTestId('node-exit-2').waitFor();
  await sleep(800);
  const draft = (await api(`/loops/${loopId}`)).draft.definition;
  const gate = draft.nodes.find((x) => x.id === 'gate');
  const added = draft.nodes.find((x) => x.id === 'exit-2');
  const rendered = await page.evaluate(() => ({
    gate: document.querySelector('.react-flow__node[data-id="gate"]').offsetHeight,
    ports: document.querySelectorAll('.react-flow__node[data-id="gate"] .react-flow__handle.source').length,
  }));
  const expectedY = gate.ui.y + footprint(rendered.ports) + 22;
  const ok = rendered.ports === 4 && added.ui.y >= gate.ui.y + rendered.gate + 22 && added.ui.x === 40;
  if (!ok) failed += 1;
  log(`${ok ? 'PASS' : 'FAIL'} palette press right after the gate grew to ${rendered.ports} outputs: new exit at ${JSON.stringify(added.ui)}, gate top ${gate.ui.y}, rendered height ${rendered.gate}, expected y ${expectedY}`);
  const unchanged = draft.nodes.filter((x) => x.id !== 'exit-2').every((x) => JSON.stringify(x.ui) === JSON.stringify(definition.nodes.find((d) => d.id === x.id).ui));
  if (!unchanged) failed += 1;
  log(`${unchanged ? 'PASS' : 'FAIL'} no existing card moved`);
  await page.getByRole('button', { name: 'Fit view' }).click();
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'branch-card-heights.png') });
} finally {
  await browser.close();
  await fetch(`${origin}/system/shutdown`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'drain' }) }).catch(() => undefined);
  for (let i = 0; i < 300 && exitCode === null; i += 1) await sleep(100);
  if (exitCode === null) child.kill();
  log(`gateway exit ${exitCode}; failed ${failed}; real provider turns 0`);
  fs.writeFileSync(path.join(OUT, 'branch-card-heights.log.txt'), lines.join('\n') + '\n');
}
