// Reviewer behaviour check for WP-425, scan 2 (independent review, 2026-10-28).
// Drives the built API (apps/api/dist/main.js) on a disposable store under %TEMP%\gg-rev425b-*,
// serving a given web build, in headless Edge through Playwright. No run is started and no
// provider is called: GG_CODEX_BINARY and GG_CLAUDE_BINARY point at files that do not exist.
// Scenarios S1-S7 repeat scan 1's (review/rev425-behaviour.mjs); S5b, S8-S11 are new.
//   pnpm --filter @graphgoblin/web exec tsx --conditions=development <this file> <label> <port 6350-6359> <web dist>
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(OUT, '..', '..', '..', '..');
const requireWeb = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'));
const { chromium } = requireWeb('@playwright/test') as typeof import('@playwright/test');
const { denseGraph } = (await import(
  pathToFileURL(path.join(ROOT, 'apps', 'web', 'src', '__fixtures__', 'routing.ts')).href
)) as { denseGraph: (n: number) => any };

const [label, portText, distArg] = process.argv.slice(2);
const port = Number(portText);
if (!label || !(port >= 6350 && port <= 6359) || !distArg)
  throw new Error('usage: <label> <port 6350-6359> <dist>');
const dist = path.resolve(distArg);
const home = os.homedir();
const redact = (text: unknown) =>
  String(text)
    .split(home)
    .join('%USERPROFILE%')
    .split(home.replaceAll('\\', '/'))
    .join('%USERPROFILE%')
    .split(home.replaceAll('\\', '\\\\'))
    .join('%USERPROFILE%')
    .replace(new RegExp(os.hostname(), 'gi'), '%COMPUTERNAME%');
const logFile = path.join(OUT, `${label}-behaviour.log.txt`);
fs.writeFileSync(logFile, '');
const t0 = Date.now();
const log = (message: string, data?: unknown) => {
  const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s ${message}${data === undefined ? '' : ' ' + JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, redact(line));
  process.stdout.write(redact(line));
};
const checks: { id: string; ok: boolean | null; detail: unknown }[] = [];
const check = (id: string, ok: unknown, detail?: unknown) => {
  checks.push({ id, ok: Boolean(ok), detail });
  log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id}`, detail);
};
const observe = (id: string, detail: unknown) => {
  checks.push({ id, ok: null, detail });
  log(`OBSERVE ${id}`, detail);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Gateway on a disposable store ----
const store = fs.mkdtempSync(path.join(os.tmpdir(), `gg-rev425b-store-${label}-`));
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.toUpperCase().startsWith('GG_') && k.toUpperCase() !== 'JEV_API_KEY',
  ) as [string, string][],
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
child.stdout!.pipe(sink, { end: false });
child.stderr!.pipe(sink, { end: false });
let exitCode: number | string | null = null;
child.once('exit', (code, signal) => (exitCode = code ?? signal));
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; ; i += 1) {
  if (
    fs.existsSync(gatewayLog) &&
    fs.readFileSync(gatewayLog, 'utf8').includes('GraphGoblin API listening')
  )
    break;
  if (exitCode !== null || i > 900)
    throw new Error('gateway did not start: ' + fs.readFileSync(gatewayLog, 'utf8'));
  await sleep(100);
}
log('gateway listening', { pid: child.pid, port, label, web: path.basename(dist) });
const api = async (p: string, init: { method?: string; body?: unknown } = {}) => {
  const response = await fetch(origin + p, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'content-type': 'application/json' } : {},
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as any };
};
const draftOf = async (loopId: string) => (await api(`/loops/${loopId}`)).json.draft.definition;
const positions = async (loopId: string) =>
  Object.fromEntries(((await draftOf(loopId)).nodes as any[]).map((n) => [n.id, n.ui ?? null]));

// ---- Browser helpers ----
const browser = await chromium.launch({ channel: 'msedge', headless: true });
log('browser', { version: browser.version() });
let page: import('@playwright/test').Page;
async function newPage(theme = 'dark') {
  if (page) await page.context().close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // tsx keeps function names with an injected __name helper, also inside evaluate callbacks.
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  await context.addInitScript(
    (value) => localStorage.setItem('graphgoblin-theme', value),
    theme,
  );
  page = await context.newPage();
  return page;
}
async function frames(n = 2) {
  await page.evaluate(
    (count) =>
      new Promise<void>((r) => {
        let left = count;
        const tick = () => (--left <= 0 ? r() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}
async function settle() {
  await page.locator('.react-flow__viewport').evaluate(async (viewport) => {
    let previous = viewport.getAttribute('style');
    let since = performance.now();
    await new Promise<void>((done) => {
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
  await page
    .getByTestId('save-state')
    .filter({ hasText: 'All changes saved' })
    .waitFor({ timeout: 20_000 });
}
async function openNode(id: string) {
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
async function connect(dialog: import('@playwright/test').Locator, output: string, to: string) {
  await dialog.getByLabel('Output', { exact: true }).selectOption(output);
  await dialog.getByLabel('To', { exact: true }).selectOption(to);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
}
async function press(kind: string) {
  await showPalette();
  await page.getByRole('button', { name: `Add ${kind} node`, exact: true }).click();
  await page.getByTestId(`node-${kind.toLowerCase()}`).waitFor();
  await settle();
}
async function configureGate(id: string) {
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
async function createInUi(name: string) {
  await page.goto(`${origin}/app/loops`);
  await page.getByLabel('New loop name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/app\/loops\/[0-9A-Z]{26}\/edit$/);
  await page.locator('.react-flow__node').first().waitFor();
  return page.url().split('/').at(-2)!;
}
async function createByApi(definition: unknown) {
  const created = await api('/loops', { method: 'POST', body: { definition } });
  if (created.status !== 201) throw new Error('create failed ' + JSON.stringify(created.json));
  return created.json.loop.id as string;
}
async function openLoop(loopId: string, count: number) {
  await page.goto(`${origin}/app/loops/${loopId}/edit`);
  await page
    .locator('.react-flow__node')
    .nth(count - 1)
    .waitFor();
  await hidePanels();
  await fit();
}

type Box = { left: number; right: number; top: number; bottom: number };
type EdgeGeometry = {
  id: string;
  type: string | null;
  channel: boolean;
  text: string | null;
  title: string | null;
  aria: string | null;
  label: Box | null;
  flowLabel: string | null;
  attachPx: number | null;
  crossesOtherPaths: string[];
  leader: null | {
    flowLength: number;
    screenLength: number;
    anchorToPathPx: number;
    stroke: string;
    crossesCards: string[];
  };
};
/** Card, label and leader geometry on screen, with each label's distance to its own path. */
async function geometry(): Promise<{
  zoom: number;
  cards: (Box & { id: string })[];
  edges: EdgeGeometry[];
  canvas: string;
}> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const viewport = document.querySelector('.react-flow__viewport')!;
    const zoom = new DOMMatrix(getComputedStyle(viewport).transform).a;
    const cards = [...document.querySelectorAll('.react-flow__node')].map((n) => ({
      id: n.getAttribute('data-id')!,
      ...box(n),
    }));
    const pathPoints = (path: SVGPathElement, step = 1) => {
      // An edge can be drawn with an empty path for a frame (recorded as emptyPath below).
      if (!path.getAttribute('d')?.trim()) return [];
      const m = path.getScreenCTM()!;
      const total = path.getTotalLength();
      const points: DOMPoint[] = [];
      for (let at = 0; at <= total; at += step)
        points.push(path.getPointAtLength(at).matrixTransform(m));
      return points;
    };
    const distanceTo = (path: SVGPathElement, point: { x: number; y: number }) => {
      let best = Infinity;
      for (const p of pathPoints(path))
        best = Math.min(best, Math.hypot(p.x - point.x, p.y - point.y));
      return best;
    };
    const all = [...document.querySelectorAll('.react-flow__edge')];
    const edges = all.map((e) => {
      const label = e.querySelector('.react-flow__edge-textbg') ?? e.querySelector('.react-flow__edge-textwrapper');
      const wrapper = e.querySelector('.react-flow__edge-textwrapper');
      const path = e.querySelector('.react-flow__edge-path') as SVGPathElement | null;
      const leader = e.querySelector('.gg-edge-label-leader') as SVGPathElement | null;
      const type =
        [...e.classList].find(
          (c) => c.startsWith('react-flow__edge-') && c !== 'react-flow__edge-path',
        ) ?? null;
      const result: any = {
        id: e.getAttribute('data-id'),
        type,
        // A smoothstep edge renders <title> only through the orthogonal renderer (label channel).
        channel: type === 'react-flow__edge-smoothstep' && !!e.querySelector('title'),
        text: wrapper?.textContent ?? null,
        title: e.querySelector('title')?.textContent ?? null,
        aria: e.getAttribute('aria-label'),
        label: label ? box(label) : null,
        flowLabel: wrapper?.getAttribute('transform') ?? null,
        emptyPath: !!path && !path.getAttribute('d')?.trim(),
        attachPx: null,
        crossesOtherPaths: [],
        leader: null,
      };
      if (label && path) {
        const r = label.getBoundingClientRect();
        result.attachPx = +distanceTo(path, {
          x: (r.left + r.right) / 2,
          y: (r.top + r.bottom) / 2,
        }).toFixed(1);
        const inner = { left: r.left + 1, right: r.right - 1, top: r.top + 1, bottom: r.bottom - 1 };
        for (const other of all) {
          if (other === e) continue;
          const otherPath = other.querySelector('.react-flow__edge-path') as SVGPathElement | null;
          if (!otherPath) continue;
          if (
            pathPoints(otherPath, 2).some(
              (p) => p.x > inner.left && p.x < inner.right && p.y > inner.top && p.y < inner.bottom,
            )
          )
            result.crossesOtherPaths.push(other.getAttribute('data-id'));
        }
      }
      if (leader && path) {
        const total = leader.getTotalLength();
        const m = leader.getScreenCTM()!;
        const start = leader.getPointAtLength(0).matrixTransform(m);
        result.leader = {
          flowLength: +total.toFixed(1),
          screenLength: +(total * zoom).toFixed(1),
          anchorToPathPx: +distanceTo(path, start).toFixed(1),
          stroke: getComputedStyle(leader).stroke,
          crossesCards: [...document.querySelectorAll('.react-flow__node')]
            .filter((n) => {
              const b = n.getBoundingClientRect();
              for (let at = 0; at <= total; at += 1) {
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
    return {
      zoom,
      cards,
      edges,
      canvas: getComputedStyle(document.querySelector('.react-flow')!).backgroundColor,
    };
  });
}
const overlap = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function pairs<T extends Box>(items: T[], name: (t: T) => string) {
  const hits: string[] = [];
  items.forEach((a, i) =>
    items.slice(i + 1).forEach((b) => overlap(a, b) && hits.push(`${name(a)} / ${name(b)}`)),
  );
  return hits;
}
function assess(id: string, g: Awaited<ReturnType<typeof geometry>>) {
  const labels = g.edges.filter((e) => e.label);
  const cardHits = pairs(g.cards, (c) => c.id);
  const labelHits = pairs(
    labels.map((e) => ({ ...e.label!, id: e.id, text: e.text })),
    (l) => `${l.id}:${l.text}`,
  );
  const labelOnCard = labels.flatMap((e) =>
    g.cards.filter((c) => overlap(e.label!, c)).map((c) => `${e.id}:${e.text} on ${c.id}`),
  );
  const detached = labels
    .filter((e) => !e.leader && (e.attachPx ?? 0) > 3)
    .map((e) => `${e.id}:${e.text} ${e.attachPx}px`);
  check(`${id} no card boxes intersect`, cardHits.length === 0, cardHits);
  check(`${id} no label boxes intersect`, labelHits.length === 0, labelHits);
  check(`${id} no label sits on a card`, labelOnCard.length === 0, labelOnCard);
  check(
    `${id} every label without a leader is on its own path (<= 3 px)`,
    detached.length === 0,
    detached,
  );
  for (const e of labels.filter((l) => l.leader)) {
    check(
      `${id} callout ${e.id}: leader <= 96 flow px, anchored on its own path, crossing no card`,
      e.leader!.flowLength <= 96 && e.leader!.anchorToPathPx <= 1.5 && !e.leader!.crossesCards.length,
      e.leader,
    );
    check(`${id} callout ${e.id}: pill crosses no other edge's path`, !e.crossesOtherPaths.length, e.crossesOtherPaths);
  }
  observe(
    `${id} labels`,
    labels.map((e) => ({
      id: e.id,
      type: e.type,
      channel: e.channel,
      text: e.text,
      flowLabel: e.flowLabel,
      attachPx: e.attachPx,
      crossesOtherPaths: e.crossesOtherPaths,
      leader: e.leader,
    })),
  );
  return { cardHits, labelHits, labelOnCard, detached };
}
const shot = async (name: string) => {
  await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), animations: 'disabled' });
  log('screenshot', `${label}-${name}.png`);
};
type FlowLabel = { type: string; x: number; y: number; leader: string | null };
/** Label centres in flow coordinates (wrapper transform + pill rect), leader paths and types. */
async function flowLabels(on = page): Promise<Record<string, FlowLabel>> {
  return on.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.react-flow__edge')].flatMap((e) => {
        const wrapper = e.querySelector('.react-flow__edge-textwrapper');
        const bg = e.querySelector('.react-flow__edge-textbg');
        if (!wrapper || !bg) return [];
        const [tx = 0, ty = 0] = (wrapper.getAttribute('transform')?.match(/-?[\d.]+/g) ?? []).map(Number);
        const n = (name: string) => Number(bg.getAttribute(name) ?? 0);
        return [
          [
            e.getAttribute('data-id'),
            {
              type: [...e.classList].find((c) => /^react-flow__edge-(smoothstep|orthogonal)$/.test(c)) ?? '',
              x: +(tx + n('x') + n('width') / 2).toFixed(2),
              y: +(ty + n('y') + n('height') / 2).toFixed(2),
              leader: e.querySelector('.gg-edge-label-leader')?.getAttribute('d') ?? null,
            },
          ],
        ];
      }),
    ),
  );
}
function sameLabels(a: Record<string, FlowLabel>, b: Record<string, FlowLabel>, what: string) {
  const diffs: string[] = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id];
    const y = b[id];
    if (!x || !y) {
      diffs.push(`${id}: ${x ? `missing in ${what}` : `only in ${what}`}`);
      continue;
    }
    if (!(Math.abs(x.x - y.x) <= 0.5 && Math.abs(x.y - y.y) <= 0.5))
      diffs.push(`${id}: (${x.x}, ${x.y}) vs ${what} (${y.x}, ${y.y})`);
    if (!!x.leader !== !!y.leader) diffs.push(`${id}: leader ${x.leader} vs ${what} ${y.leader}`);
  }
  return diffs;
}
async function live() {
  await saved();
  await frames(3);
  await sleep(150);
  return flowLabels();
}
/** The same stored definition opened fresh in a second tab (this tab keeps its undo history). */
async function fresh(loopId: string): Promise<Record<string, FlowLabel>> {
  const def = structuredClone(await draftOf(loopId));
  def.name = `${def.name} fresh ${Date.now()}`;
  const copy = await createByApi(def);
  const other = await page.context().newPage();
  await other.goto(`${origin}/app/loops/${copy}/edit`);
  await other
    .locator('.react-flow__node')
    .nth(def.nodes.length - 1)
    .waitFor();
  await other.evaluate(() => document.fonts.ready);
  await other.waitForTimeout(800);
  const labels = await flowLabels(other);
  await other.close();
  return labels;
}
/** A state's labels must equal a fresh load of the same stored definition. */
async function staleCheck(id: string, loopId: string) {
  const now = await live();
  const reference = await fresh(loopId);
  const diffs = sameLabels(now, reference, 'a fresh load');
  check(`${id}: labels equal a fresh load of the same definition`, diffs.length === 0, {
    diffs,
    live: now,
  });
  return now;
}
const results: Record<string, unknown> = {};
const node = (id: string, kind: string, x: number, y: number, config: unknown, extra: { label?: string } = {}) => ({
  id,
  kind,
  label: extra.label ?? id[0]!.toUpperCase() + id.slice(1),
  config,
  ui: { x, y },
});

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
  const s1Positions: { after: string; positions: Record<string, unknown> }[] = [];
  for (const kind of ['Trigger', 'Inference', 'Decision']) {
    await press(kind);
    await saved();
    s1Positions.push({ after: kind, positions: await positions(s1) });
  }
  await configureGate('decision');
  for (const kind of ['Wait', 'Exit']) {
    await press(kind);
    const inView = await page.getByTestId(`node-${kind.toLowerCase()}`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const c = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom && r.left >= c.left && r.right <= c.right;
    });
    check(`S1 pressed ${kind} is inside the canvas after the pan`, inView, { inView });
    await saved();
    s1Positions.push({ after: kind, positions: await positions(s1) });
  }
  const moved: string[] = [];
  for (let i = 1; i < s1Positions.length; i += 1)
    for (const [id, ui] of Object.entries(s1Positions[i - 1]!.positions))
      if (JSON.stringify(s1Positions[i]!.positions[id]) !== JSON.stringify(ui))
        moved.push(`${id} after ${s1Positions[i]!.after}`);
  check('S1 no existing node moved when a palette entry was pressed', moved.length === 0, moved);
  observe('S1 stored positions after each press', s1Positions);
  for (const [id, connections] of [
    ['trigger', [['out', 'inference']]],
    ['inference', [['out', 'decision']]],
    [
      'decision',
      [
        ['again', 'wait'],
        ['finish', 'exit'],
        ['limit-reached', 'exit'],
      ],
    ],
    ['wait', [['out', 'inference']]],
  ] as const) {
    const dialog = await openNode(id);
    for (const [p, target] of connections) await connect(dialog, p, target);
    await closeNode();
  }
  await saved();
  await hidePanels();
  await fit();
  results['S1'] = assess('S1', await geometry());
  await shot('s1-palette-column');

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
    [
      'decision',
      [
        ['again', 'wait'],
        ['finish', 'done'],
        ['limit-reached', 'done'],
      ],
    ],
    ['wait', [['out', 'inference']]],
  ] as const) {
    dialog = await openNode(id);
    for (const [p, target] of connections) await connect(dialog, p, target);
    await closeNode();
  }
  await saved();
  const s2Def = await draftOf(s2);
  observe('S2 stored positions', Object.fromEntries(s2Def.nodes.map((n: any) => [n.id, n.ui])));
  await hidePanels();
  await fit();
  results['S2'] = assess('S2', await geometry());
  await shot('s2-f2-order');
  // State A: the settled F2 graph. Every later state is compared with a fresh load of the same
  // stored definition (second tab); returning to A by undo is also compared with A's fresh load.
  const freshA = await fresh(s2);
  const liveA = await live();
  check('S2 settled: labels equal a fresh load of the same definition', !sameLabels(liveA, freshA, 'a fresh load').length, {
    diffs: sameLabels(liveA, freshA, 'a fresh load'),
    live: liveA,
  });
  await fit();

  // ---- S7: selecting a labelled forward edge keeps its label; handles show ----
  const finishEdge = s2Def.edges.find((e: any) => e.from.port === 'finish').id as string;
  const limitEdge = s2Def.edges.find((e: any) => e.from.port === 'limit-reached').id as string;
  const edge = (id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);
  const pane = () => page.locator('.react-flow__pane').click({ position: { x: 20, y: 500 } });
  const before = (await geometry()).edges.find((e) => e.id === finishEdge)!;
  const beforeFlow = (await flowLabels())[finishEdge]!;
  await edge(finishEdge).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (id) => document.querySelector(`.react-flow__edge[data-id="${id}"]`)?.classList.contains('selected'),
    finishEdge,
  );
  await sleep(200);
  const selectedGeometry = await geometry();
  const after = selectedGeometry.edges.find((e) => e.id === finishEdge)!;
  const afterFlow = (await flowLabels())[finishEdge]!;
  const shift = Math.hypot(afterFlow.x - beforeFlow.x, afterFlow.y - beforeFlow.y);
  check('S7 selecting the Finish edge does not move its label centre (<= 0.5 flow px)', shift <= 0.5, {
    before: beforeFlow,
    after: afterFlow,
    pillScreenBefore: before.label,
    pillScreenAfter: after.label,
  });
  observe('S7 Finish edge type unselected / selected', [before.type, after.type]);
  const handles = await edge(finishEdge).locator('.gg-route-handle').count();
  check('S7 the selected forward edge shows segment handles', handles >= 1, { handles });
  results['S7'] = assess('S7 (selected)', selectedGeometry);
  await shot('s7-selected-finish');

  // ---- S3: a manual route on the labelled forward edge (state B) ----
  const vertical = edge(finishEdge).locator('.gg-route-handle-x').first();
  const hb = (await vertical.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await saved();
  const route = (await draftOf(s2)).edges.find((e: any) => e.id === finishEdge).ui?.route;
  check('S3 dragging the Finish edge vertical stores a manual route', Array.isArray(route) && route.length > 0, {
    route,
  });
  await sleep(300);
  const s3 = await geometry();
  const finish3 = s3.edges.find((e) => e.id === finishEdge)!;
  check('S3 the manually routed edge keeps its accessible name "manual route"', /manual route/.test(finish3.aria ?? ''), finish3.aria);
  results['S3'] = assess('S3 (manual route, selected)', s3);
  await shot('s3-manual-route-selected');
  await pane();
  await sleep(300);
  results['S3b'] = assess('S3 (manual route, deselected)', await geometry());
  await shot('s3-manual-route');
  const liveB = await staleCheck('S9 state B (manual route)', s2);

  // ---- S9: stale-label checks (undo history kept: references come from a second tab) ----
  const back = async (id: string, reference: Record<string, FlowLabel>, what: string) => {
    const now = await live();
    const diffs = sameLabels(now, reference, what);
    check(`${id}: labels equal ${what}`, diffs.length === 0, { diffs, live: now });
  };
  await pane();
  await page.keyboard.press('Control+z');
  await back('S9 undo of the manual route (state A again)', freshA, "state A's fresh load");
  await pane();
  await page.keyboard.press('Control+Shift+z');
  await back('S9 redo of the manual route (state B again)', liveB, "state B's live labels");
  await edge(finishEdge).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Reset route', exact: true }).click();
  await pane();
  await back('S9 Reset route (state A again)', freshA, "state A's fresh load");
  // State C: the Limit reached edge deleted (it shares the target with Finish).
  await edge(limitEdge).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await page.locator(`.react-flow__edge[data-id="${limitEdge}"]`).waitFor({ state: 'detached' });
  await pane();
  const liveC = await staleCheck('S9 state C (Limit reached edge deleted)', s2);
  await page.keyboard.press('Control+z');
  await page.locator(`.react-flow__edge[data-id="${limitEdge}"]`).waitFor({ state: 'attached' });
  await back('S9 undo of the edge delete (state A again)', freshA, "state A's fresh load");
  await pane();
  await page.keyboard.press('Control+Shift+z');
  await page.locator(`.react-flow__edge[data-id="${limitEdge}"]`).waitFor({ state: 'detached' });
  await back('S9 redo of the edge delete (state C again)', liveC, "state C's live labels");
  await pane();
  await page.keyboard.press('Control+z');
  await page.locator(`.react-flow__edge[data-id="${limitEdge}"]`).waitFor({ state: 'attached' });
  // State D: the Wait node deleted (its incoming labelled edge goes with it).
  const waitCard = page.locator('.react-flow__node[data-id="wait"]');
  await waitCard.press(' ');
  await waitCard.press('Delete');
  await waitCard.waitFor({ state: 'detached' });
  await pane();
  await staleCheck('S9 state D (Wait node deleted)', s2);
  await page.keyboard.press('Control+z');
  await page.locator('.react-flow__node[data-id="wait"]').waitFor();
  await back('S9 undo of the node delete (state A again)', freshA, "state A's fresh load");
  // Definition reload: the page itself reloaded in state A.
  await page.reload();
  await page
    .locator('.react-flow__node')
    .nth(s2Def.nodes.length - 1)
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await settle();
  await back('S9 page reload (state A)', freshA, "state A's fresh load");
  await hidePanels();
  await fit();

  // ---- S6 / S10: drag the shared target (Done) vertically through alignment, sampling frames ----
  const labelled = async () => (await geometry()).edges.filter((e) => e.label);
  const start10 = await labelled();
  observe('S10 labels before the drag', start10.map((e) => ({ id: e.id, channel: e.channel, text: e.text })));
  const doneHeader = (await page.getByTestId('node-done').locator(':scope > div:has([data-kind])').boundingBox())!;
  const dx0 = doneHeader.x + doneHeader.width / 2;
  const dy0 = doneHeader.y + doneHeader.height / 2;
  await page.mouse.move(dx0, dy0);
  await page.mouse.down();
  const frames10: { step: number; maxAttachPx: number; worst: string; overlaps: number }[] = [];
  let last: Record<string, Box> = {};
  const jumps: { step: number; id: string; px: number }[] = [];
  const offsets = [
    ...Array.from({ length: 16 }, (_, i) => -(i + 1) * 4),
    ...Array.from({ length: 32 }, (_, i) => -64 + (i + 1) * 4),
    ...Array.from({ length: 16 }, (_, i) => 64 - (i + 1) * 4),
  ];
  for (const [step, off] of offsets.entries()) {
    await page.mouse.move(dx0 + 10, dy0 + off);
    await frames(2);
    const ls = await labelled();
    const leaderless = ls.filter((e) => !e.leader);
    const worst = leaderless.reduce((w, e) => ((e.attachPx ?? 0) > (w?.attachPx ?? -1) ? e : w), leaderless[0]);
    frames10.push({
      step,
      maxAttachPx: worst?.attachPx ?? 0,
      worst: `${worst?.id}:${worst?.text}`,
      overlaps: pairs(ls.map((e) => ({ ...e.label!, id: e.id })), (l) => l.id).length,
    });
    for (const e of ls) {
      const p = last[e.id];
      if (p) jumps.push({ step, id: e.id, px: Math.hypot(e.label!.left - p.left, e.label!.top - p.top) });
      last[e.id] = e.label!;
    }
  }
  const lastFrame = await labelled();
  await page.mouse.up();
  await saved();
  await frames(3);
  await sleep(200);
  const released = await labelled();
  const releaseJumps = released
    .map((e) => {
      const p = lastFrame.find((l) => l.id === e.id);
      return { id: e.id, text: e.text, px: p?.label ? +Math.hypot(e.label!.left - p.label.left, e.label!.top - p.label.top).toFixed(1) : null };
    })
    .filter((j) => j.px === null || j.px > 0.5);
  check(
    'S10 every sampled drag frame keeps leader-less labels on their own paths (<= 3 px)',
    frames10.every((f) => f.maxAttachPx <= 3),
    frames10.filter((f) => f.maxAttachPx > 3),
  );
  observe('S10 per-frame worst attachment and label overlaps', frames10);
  observe(
    'S10 largest frame-to-frame label moves (target moved 4 px per step)',
    jumps.sort((a, b) => b.px - a.px).slice(0, 8).map((j) => ({ ...j, px: +j.px.toFixed(1) })),
  );
  observe('S10 label moves between the last drag frame and the settled release (> 0.5 px)', releaseJumps);
  results['S10'] = assess('S10 (after the drag)', await geometry());
  await shot('s10-after-drag');
  await staleCheck('S10 after the drag', s2);

  // ---- S4: a long route label ----
  const longDef = structuredClone(await draftOf(s2));
  longDef.name = 'S4 long label';
  for (const e of longDef.edges) delete e.ui;
  const gateNode = longDef.nodes.find((n: any) => n.id === 'decision');
  gateNode.config.routes[1].label = 'Finish and send the summary to the reviewer';
  const s2Positions = Object.fromEntries(s2Def.nodes.map((n: any) => [n.id, n.ui]));
  for (const n of longDef.nodes) n.ui = s2Positions[n.id];
  await newPage();
  const s4 = await createByApi(longDef);
  await openLoop(s4, longDef.nodes.length);
  results['S4'] = assess('S4', await geometry());
  await shot('s4-long-label');

  // ---- S5: a very short edge between adjacent cards, below other cards ----
  const shortDef = (name: string, yes: string) => ({
    schemaVersion: s2Def.schemaVersion,
    name,
    nodes: [
      node('start', 'trigger', 100, 0, { type: 'manual' }),
      node('work', 'inference', 100, 200, { prompt: { template: 'Hi' } }),
      node('check', 'decision', 0, 400, {
        kind: 'expression',
        jsonata: '"yes"',
        routes: [
          { id: 'yes', label: yes },
          { id: 'no', label: 'No' },
        ],
      }),
      node('done', 'exit', 200, 400, {}),
      node('other', 'exit', 520, 400, {}),
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'check' } },
      { id: 'yes', from: { node: 'check', port: 'yes' }, to: { node: 'done' } },
      { id: 'no', from: { node: 'check', port: 'no' }, to: { node: 'other' } },
    ],
  });
  for (const theme of ['dark', 'light']) {
    await newPage(theme);
    const s5 = await createByApi(shortDef(`S5 short edge ${theme}`, 'Yes'));
    await openLoop(s5, 5);
    results[`S5-${theme}`] = assess(`S5 ${theme}`, await geometry());
    await shot(`s5-short-edge-${theme}`);
    if (theme === 'dark') {
      await page.emulateMedia({ forcedColors: 'active' });
      await sleep(300);
      const forced = await geometry();
      observe('S5 forced colours: leader strokes and canvas', {
        canvas: forced.canvas,
        leaders: forced.edges.filter((e) => e.leader).map((e) => ({ id: e.id, stroke: e.leader!.stroke })),
      });
      await shot('s5-short-edge-forced-colors');
      await page.emulateMedia({ forcedColors: 'none' });
    }
  }
  // ---- S5b: the same short edge with a long label ----
  await newPage();
  const s5b = await createByApi(shortDef('S5b short edge long label', 'Yes, approve and publish the summary'));
  await openLoop(s5b, 5);
  results['S5b'] = assess('S5b long label on a short edge', await geometry());
  await shot('s5b-short-edge-long-label');

  // ---- S8: a fully covered path (a third card lies over the whole connection) ----
  await newPage();
  const coveredDef = {
    schemaVersion: s2Def.schemaVersion,
    name: 'S8 covered path',
    nodes: [
      node('start', 'trigger', 0, 0, { type: 'manual' }),
      node('check', 'decision', 0, 200, {
        kind: 'expression',
        jsonata: '"yes"',
        routes: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      }),
      node('done', 'exit', 300, 200, {}),
      node('other', 'exit', 600, 400, {}),
      node('cover', 'decision', 150, 190, { kind: 'expression', jsonata: '"a"', routes: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })) }, { label: 'Cover' }),
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'check' } },
      { id: 'yes', from: { node: 'check', port: 'yes' }, to: { node: 'done' } },
      { id: 'no', from: { node: 'check', port: 'no' }, to: { node: 'other' } },
    ],
  };
  const s8 = await createByApi(coveredDef);
  await openLoop(s8, 5);
  const s8g = await geometry();
  const yes8 = s8g.edges.find((e) => e.id === 'yes')!;
  observe('S8 covered Yes label', { label: yes8.label, leader: yes8.leader, attachPx: yes8.attachPx, channel: yes8.channel });
  check('S8 a fully covered path keeps its default label with no leader', !yes8.leader && (yes8.attachPx ?? 99) <= 3, {
    attachPx: yes8.attachPx,
    leader: yes8.leader,
  });
  await shot('s8-covered-path');

  // ---- S11: 300 cards in Edge: label time per drag frame and at release ----
  await newPage();
  const dense = denseGraph(300);
  dense.name = 'S11 dense 300';
  const s11 = await createByApi(dense);
  await page.goto(`${origin}/app/loops/${s11}/edit`);
  await page.locator('.react-flow__node').nth(299).waitFor({ timeout: 60_000 });
  await hidePanels();
  await page.evaluate(() => document.fonts.ready);
  await settle();
  await sleep(1000);
  const s11Settled = await page.evaluate(
    () =>
      [...document.querySelectorAll('.react-flow__edge-smoothstep')].filter((e) => e.querySelector('title')).length,
  );
  const card = page.locator('.react-flow__node[data-id="n144"]');
  const cb = (await card.boundingBox())!;
  await page.evaluate(() => {
    (window as any).__rev425b = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const m = entry as PerformanceMeasure;
        if (m.name === 'gg:backward-routing')
          (window as any).__rev425b.push({ at: m.startTime, duration: m.duration, ...(m.detail ?? {}) });
      }
    }).observe({ type: 'measure' });
  });
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 18);
  await page.mouse.down();
  for (let step = 1; step <= 60; step += 1)
    await page.mouse.move(cb.x + cb.width / 2 + Math.sin(step / 6) * 10 + 5, cb.y + 18 + Math.cos(step / 6) * 8);
  const beforeRelease = await page.evaluate(() => (window as any).__rev425b.length);
  await page.mouse.up();
  await sleep(1500);
  const samples = (await page.evaluate(() => (window as any).__rev425b)) as {
    duration: number;
    routingMs?: number;
    labelMs?: number;
    nodes: number;
  }[];
  const dragSamples = samples.slice(0, beforeRelease);
  const releaseSamples = samples.slice(beforeRelease);
  const q = (values: number[], p: number) =>
    values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]! : null;
  const labelMs = dragSamples.map((s) => s.labelMs ?? NaN).filter((v) => !Number.isNaN(v));
  observe('S11 300 cards: routing measure samples during the drag and after release', {
    channelEdgesAfterSettle: s11Settled,
    dragSamples: dragSamples.length,
    dragDurationP50: q(dragSamples.map((s) => s.duration), 0.5),
    dragDurationP95: q(dragSamples.map((s) => s.duration), 0.95),
    dragLabelMsP50: q(labelMs, 0.5),
    dragLabelMsP95: q(labelMs, 0.95),
    dragLabelMsMax: labelMs.length ? Math.max(...labelMs) : null,
    releaseSamples: releaseSamples.map((s) => ({
      duration: +s.duration.toFixed(2),
      routingMs: s.routingMs === undefined ? null : +s.routingMs.toFixed(2),
      labelMs: s.labelMs === undefined ? null : +s.labelMs.toFixed(2),
    })),
  });
  if (labelMs.length)
    check('S11 label work per drag frame on 300 cards is below 0.5 ms at p95', (q(labelMs, 0.95) ?? 99) < 0.5, {
      p95: q(labelMs, 0.95),
    });
  await shot('s11-dense-300-after-drag');

  // ---- S12: drag Done left past the Decision: forward paths change from 4 to 6 points ----
  await newPage();
  const s12Def = structuredClone(s2Def);
  s12Def.name = 'S12 shape change';
  const s12 = await createByApi(s12Def);
  await openLoop(s12, s12Def.nodes.length);
  const s12Before = (await geometry()).edges.filter((e) => e.label);
  observe('S12 labels before the drag', s12Before.map((e) => ({ id: e.id, channel: e.channel, text: e.text, flowLabel: e.flowLabel })));
  const h12 = (await page.getByTestId('node-done').locator(':scope > div:has([data-kind])').boundingBox())!;
  const x12 = h12.x + h12.width / 2;
  const y12 = h12.y + h12.height / 2;
  await page.mouse.move(x12, y12);
  await page.mouse.down();
  const s12Frames: { step: number; id: string; text: string | null; attachPx: number | null; channel: boolean }[] = [];
  const s12Empty: { step: number; ids: string[] }[] = [];
  for (let step = 1; step <= 40; step += 1) {
    await page.mouse.move(x12 - step * 10, y12 + step * 4);
    await frames(2);
    const g12 = await geometry();
    const empty = g12.edges.filter((e) => (e as { emptyPath?: boolean }).emptyPath).map((e) => e.id);
    if (empty.length) s12Empty.push({ step, ids: empty });
    for (const e of g12.edges.filter((l) => l.label && !l.leader))
      s12Frames.push({ step, id: e.id, text: e.text, attachPx: e.attachPx, channel: e.channel });
  }
  observe('S12 frames with an edge drawn with an empty path', s12Empty);
  await shot('s12-mid-drag');
  await page.mouse.up();
  await saved();
  await frames(3);
  await sleep(200);
  const off12 = s12Frames.filter((f) => (f.attachPx ?? 0) > 3);
  check('S12 every sampled frame keeps leader-less labels on their own paths (<= 3 px)', off12.length === 0, {
    framesOff: off12.length,
    worst: off12.sort((a, b) => (b.attachPx ?? 0) - (a.attachPx ?? 0)).slice(0, 6),
    firstStepOff: off12.length ? Math.min(...off12.map((f) => f.step)) : null,
  });
  results['S12'] = assess('S12 (after the drag)', await geometry());
  await shot('s12-after-drag');
} catch (error) {
  log('ERROR', String((error as Error)?.stack ?? error));
  try {
    await shot('error');
  } catch {}
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => undefined);
  await fetch(`${origin}/system/shutdown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drain' }),
  }).catch(() => undefined);
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
  fs.writeFileSync(
    path.join(OUT, `${label}-behaviour-result.json`),
    redact(JSON.stringify(summary, null, 2)) + '\n',
  );
  log(`DONE passed=${summary.passed} failed=${summary.failed} observations=${summary.observations}`);
}
