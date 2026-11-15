import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, realpath, rm, readdir } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checkout = await realpath(process.argv[2]);
const output = dirname(fileURLToPath(import.meta.url));
const nativeDir = join(checkout, 'docs/qa/2026-11-15-space-cards-final-native');
const binding = JSON.parse(await readFile(join(nativeDir, 'binding/binding-before.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(output, 'source-and-evidence-readback.json'), 'utf8'));
const expectedHead = 'daa43634c8a093f2cde8239a3501ae4b6b14c112';
const expectedTree = 'a3f55255f1309606e024171b9b3e4e943c004966';
const expectedBase = '177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd';
const git = (...args) => execFileSync('git', args, {
  cwd: checkout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  encoding: 'utf8', windowsHide: true,
}).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashPath = async (file) => hash(await readFile(file));
const save = (name, value) => writeFile(join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index');
const appPath = 'apps/api/dist/main.js';
const dist = join(checkout, 'apps/web/dist');
const sourceFiles = manifest.files.filter(({ path }) => !path.startsWith('docs/qa/'));
const installed = [
  'apps/web/node_modules/@xyflow/react/package.json',
  'apps/web/node_modules/@xyflow/react/dist/esm/index.js',
  'apps/web/node_modules/@playwright/test/package.json',
];
const browserEntry = join(checkout, 'apps/web/node_modules/@playwright/test/index.mjs');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const assetFiles = Object.keys(binding.critical).filter(
  (file) => file === 'apps/web/dist/index.html' ||
    file.startsWith('apps/web/dist/assets/') && /\.(js|css)$/.test(file),
);

async function checkoutReceipt() {
  const side = {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    base: git('rev-parse', 'origin/main'),
    mergeBase: git('merge-base', 'HEAD', 'origin/main'),
    status: git('status', '--porcelain=v1'),
    indexSha256: await hashPath(index),
    sources: {},
    installed: {},
    output: {},
  };
  assert.deepEqual(
    [side.head, side.tree, side.base, side.mergeBase, side.status],
    [expectedHead, expectedTree, expectedBase, expectedBase, ''],
  );
  assert.equal(binding.base, expectedBase);
  assert.equal(git('diff', '--name-only', binding.head, 'HEAD', '--', '.',
    ':(exclude)docs/qa', ':(exclude)docs/delivery'), '');
  for (const { path, sha256, gitBlob } of sourceFiles) {
    side.sources[path] = await hashPath(join(checkout, path));
    assert.equal(git('rev-parse', 'HEAD:' + path), gitBlob, path);
    assert.equal(side.sources[path], sha256, path);
    if (!path.startsWith('docs/delivery/')) assert.equal(side.sources[path], binding.sourceReadback[path], path);
  }
  for (const file of installed) side.installed[file] = await hashPath(join(checkout, file));
  for (const file of [appPath, ...assetFiles]) {
    side.output[file] = await hashPath(join(checkout, file));
    assert.equal(side.output[file], binding.critical[file], file);
  }
  side.edgeExecutableSha256 = await hashPath(edge);
  assert(assetFiles.includes('apps/web/dist' + binding.bundle.slice('/app'.length)));
  return side;
}

const definition = (name) => ({
  schemaVersion: 4,
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Manual entry', config: { type: 'manual', exposeTo: ['ui', 'api', 'mcp'] } },
    { id: 'finish', kind: 'exit', label: 'Completion', config: { outcome: 'success' } },
  ],
  edges: [{ id: 'entry', from: { node: 'start', port: 'out' }, to: { node: 'finish', port: 'in' } }],
});

function installObserver() {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const events = [];
  const held = new Map();
  let mode = 'off';
  let passThrough = 0;
  const candidate = new Set();
  const viewport = () => document.querySelector('.react-flow__viewport')?.style.transform ?? null;
  const state = () => ({
    viewport: viewport(),
    cards: [...document.querySelectorAll('.react-flow__node')].map((node) => ({
      id: node.dataset.id,
      coords: [new DOMMatrix(node.style.transform).m41, new DOMMatrix(node.style.transform).m42],
      measured: [node.offsetWidth, node.offsetHeight],
    })),
    offer: Boolean(document.querySelector('[data-testid="space-cards-offer"]')),
    result: document.querySelector('[data-testid="space-cards-result"]')?.textContent ?? null,
    active: document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null,
    undo: document.querySelector('[data-history="undo"]')?.getAttribute('title') ?? null,
    redo: document.querySelector('[data-history="redo"]')?.getAttribute('title') ?? null,
  });
  const record = (type, more = {}) => events.push({ type, at: performance.now(), ...state(), ...more });
  for (const type of ['click', 'keydown']) {
    document.addEventListener(type, (event) => {
      if (mode === 'off') return;
      record('input', {
        eventType: type,
        key: event.key ?? null,
        ctrlKey: event.ctrlKey ?? false,
        trusted: event.isTrusted,
        target: event.target instanceof Element ? event.target.outerHTML.slice(0, 200) : null,
      });
    }, { capture: true, passive: true });
  }
  window.requestAnimationFrame = (callback) => {
    const source = Function.prototype.toString.call(callback);
    if (mode !== 'off' && /^\(\)=>\{let\{fitViewQueued:[a-zA-Z_$][\w$]*,nodes:[a-zA-Z_$][\w$]*,setNodes:[a-zA-Z_$][\w$]*\}=[a-zA-Z_$][\w$]*\.getState\(\);[a-zA-Z_$][\w$]*&&[a-zA-Z_$][\w$]*\([a-zA-Z_$][\w$]*\)\}$/.test(source)) {
      candidate.add(source);
      record('fit-raf-enqueued', { source, mode });
      return request((time) => {
        if (mode === 'hold') {
          held.set(source, callback);
          record('fit-raf-held', { source });
          return;
        }
        record('fit-raf-running', { source });
        callback(time);
        record('fit-raf-ran', { source });
      });
    }
    passThrough += 1;
    return request(callback);
  };
  window.cancelAnimationFrame = cancel;
  window.__staleFitProbe = {
    state,
    mark(next) {
      mode = next;
      record('armed', { mode });
    },
    inspect() {
      return { events: [...events], held: [...held.keys()], matchedSources: [...candidate], passThrough, state: state() };
    },
    release() {
      mode = 'observe';
      for (const [source, callback] of held) {
        request((time) => {
          record('fit-raf-running', { source });
          callback(time);
          record('fit-raf-ran', { source });
        });
      }
      held.clear();
    },
    settle() {
      return new Promise((done) => {
        let frames = 0;
        const next = () => {
          if (++frames === 8) done(state());
          else window.requestAnimationFrame(next);
        };
        window.requestAnimationFrame(next);
      });
    },
  };
}

const coords = (sample) => sample.cards.map(({ id, coords }) => ({ id, coords }));
const initialCoords = (samples) => assert.deepEqual(coords(samples), [
  { id: 'start', coords: [0, 0] }, { id: 'finish', coords: [0, 0] },
]);
const spacedCoords = (samples) => assert.deepEqual(coords(samples), [
  { id: 'start', coords: [0, 0] }, { id: 'finish', coords: [272, 0] },
]);
const value = (page) => page.evaluate(() => window.__staleFitProbe.inspect());
const settle = (page) => page.evaluate(() => window.__staleFitProbe.settle());

let phase = 'checkout';
let before;
let app;
let browser;
let browserContext;
let scratch;
let origin;
const browserEvents = [];
const failure = [];
const observations = {
  node: process.version, pid: process.pid, cases: {}, browserEvents, failure,
};
try {
  assert.equal(process.version, 'v22.23.4');
  before = await checkoutReceipt();
  observations.before = before;
  await save('stale-fit-checkout-before', before);
  phase = 'start-disposable-gateway';
  scratch = await mkdtemp(join(output, 'stale-fit-gateway-store-'));
  for (const k of Object.keys(process.env)) {
    if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(k)) delete process.env[k];
  }
  Object.assign(process.env, {
    GG_DATA_DIR: scratch, GG_HOST: '127.0.0.1', GG_PORT: '0', GG_REQUIRE_API_KEY: 'false',
    GG_WEB_DIST: dist, GG_GOBLIN_DIST: '', GG_SWAGGER_UI: 'false', GG_OLLAMA_ENABLED: 'false',
    GG_LOG_LEVEL: 'error',
    GG_CODEX_BINARY: join(scratch, 'no-codex-provider.exe'),
    GG_CLAUDE_BINARY: join(scratch, 'no-claude-provider.exe'),
    CLAUDE_CONFIG_DIR: join(scratch, 'empty-claude-config'),
  });
  const { main } = await import(pathToFileURL(join(checkout, appPath)).href);
  ({ app } = await main());
  const address = app.server.address();
  assert.equal(address.address, '127.0.0.1');
  assert(![4747, 4748].includes(address.port));
  origin = 'http://127.0.0.1:' + address.port;
  observations.gateway = { scratch, origin };
  const health = await fetch(origin + '/healthz', { signal: AbortSignal.timeout(10_000) });
  assert(health.ok);
  assert.equal(health.headers.get('x-graphgoblin-pid'), String(process.pid));
  for (const file of assetFiles) {
    const url = file.endsWith('/index.html') ? '/app/' : file.replace('apps/web/dist', '/app');
    const response = await fetch(origin + url, { signal: AbortSignal.timeout(10_000) });
    assert(response.ok, url);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), binding.critical[file], url);
  }
  observations.gateway.servedAssetCount = assetFiles.length;
  phase = 'launch-isolated-edge';
  const { chromium } = await import(pathToFileURL(browserEntry).href);
  // Launch a normal ephemeral Edge process. Route every browser request through the owned origin.
  browser = await chromium.launch({ channel: 'msedge', executablePath: edge, headless: true, timeout: 15_000 });
  observations.browserVersion = browser.version();
  for (const mode of ['observe', 'hold']) {
    const slug = mode === 'observe' ? 'positive-control' : 'undo-while-fit-queued';
    const run = {};
    observations.cases[slug] = run;
    phase = slug + '-seed';
    const payload = definition('Space probe ' + (mode === 'observe' ? 'aaaa' : 'bbbb'));
    const created = await fetch(origin + '/loops', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: payload }), signal: AbortSignal.timeout(10_000),
    });
    const text = await created.text();
    run.create = { request: payload, status: created.status, body: text };
    assert.equal(created.status, 201);
    const loopId = JSON.parse(text).loop.id;
    assert.equal(typeof loopId, 'string');
    const context = browserContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false,
      colorScheme: 'light', serviceWorkers: 'block',
    });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', (error) => browserEvents.push({ slug, type: 'pageerror', error: String(error) }));
    phase = slug + '-open-and-zoom';
    await page.addInitScript(installObserver);
    await page.goto(origin + '/app/loops/' + loopId + '/edit', { waitUntil: 'domcontentloaded' });
    const space = page.getByRole('button', { name: 'Space cards', exact: true });
    await space.waitFor();
    await page.waitForFunction(() => {
      const cards = window.__staleFitProbe.state().cards;
      return cards.length === 2 && cards.every(({ measured }) => measured.every((size) => size > 0));
    });
    await page.getByText('The editor is available. Checking the server and this device before saving changes.',
      { exact: true }).waitFor({ state: 'hidden' });
    run.opened = await settle(page);
    initialCoords(run.opened);
    assert(run.opened.offer);
    assert(run.opened.viewport);
    // The opening fit can be at max zoom. Zoom Out must move off it in both otherwise identical cases.
    await page.locator('.react-flow__controls-zoomout').click();
    run.beforeSpace = await settle(page);
    assert.notEqual(run.beforeSpace.viewport, run.opened.viewport);
    initialCoords(run.beforeSpace);
    const control = observations.cases['positive-control'];
    if (mode === 'hold') {
      assert.equal(run.beforeSpace.viewport, control.beforeSpace.viewport);
      assert.deepEqual(run.beforeSpace.cards, control.beforeSpace.cards);
    }
    phase = slug + '-space';
    await page.evaluate((option) => window.__staleFitProbe.mark(option), mode);
    await space.click();
    await page.waitForFunction((option) => window.__staleFitProbe.inspect().events.some(({ type }) =>
      type === (option === 'observe' ? 'fit-raf-ran' : 'fit-raf-held')), mode);
    run.afterSpace = await value(page);
    assert.equal(run.afterSpace.matchedSources.length, 1);
    assert.equal(run.afterSpace.events.filter(({ type }) => type === 'fit-raf-enqueued').length, 1);
    assert(run.afterSpace.events.some((e) => e.type === 'input' && e.eventType === 'click' && e.trusted));
    spacedCoords(run.afterSpace.state);
    assert.equal(run.afterSpace.state.undo, 'Undo space cards');
    assert.equal(run.afterSpace.state.result, 'Spaced 2 cards.');
    if (mode === 'observe') {
      assert.equal(run.afterSpace.held.length, 0);
      run.afterFit = await settle(page);
      spacedCoords(run.afterFit);
      assert.notEqual(run.afterFit.viewport, run.beforeSpace.viewport);
    } else {
      phase = slug + '-trusted-undo-before-release';
      assert.deepEqual(run.afterSpace.matchedSources, control.afterSpace.matchedSources);
      assert.equal(run.afterSpace.held.length, 1);
      assert.equal(run.afterSpace.state.viewport, run.beforeSpace.viewport);
      assert(run.afterSpace.passThrough > 0);
      assert(!run.afterSpace.events.some(({ type }) => type === 'fit-raf-running'));
      await page.keyboard.press('Control+z');
      await page.getByRole('button', { name: 'Redo space cards', exact: true }).waitFor();
      await page.waitForFunction(() => {
        const state = window.__staleFitProbe.state();
        return state.offer && state.cards.length === 2 &&
          state.cards.every(({ coords }) => coords[0] === 0 && coords[1] === 0);
      });
      await settle(page);
      run.afterUndoStillHeld = await value(page);
      assert.equal(run.afterUndoStillHeld.held.length, 1);
      assert(run.afterUndoStillHeld.passThrough > run.afterSpace.passThrough, 'Unrelated rAFs continued');
      assert(!run.afterUndoStillHeld.events.some(({ type }) => type === 'fit-raf-running'));
      const undoInput = run.afterUndoStillHeld.events.find(
        (e) => e.type === 'input' && e.eventType === 'keydown' && e.key === 'z' && e.ctrlKey && e.trusted,
      );
      assert(undoInput, 'Missing actual browser keyboard event');
      assert.equal(undoInput.undo, 'Undo space cards');
      assert.equal(undoInput.viewport, run.beforeSpace.viewport);
      initialCoords(run.afterUndoStillHeld.state);
      assert.equal(run.afterUndoStillHeld.state.redo, 'Redo space cards');
      run.beforeRelease = run.afterUndoStillHeld.state;
      phase = slug + '-release-and-oracle';
      await page.evaluate(() => window.__staleFitProbe.release());
      await settle(page);
      run.afterRelease = await value(page);
      initialCoords(run.afterRelease.state);
      assert.equal(run.afterRelease.held.length, 0);
      assert.equal(run.afterRelease.events.filter(({ type }) => type === 'fit-raf-enqueued').length, 1);
      assert.equal(run.afterRelease.events.filter(({ type }) => type === 'fit-raf-ran').length, 1);
      await save('stale-fit-observations-before-oracle', observations);
      assert.equal(run.beforeRelease.viewport, run.beforeSpace.viewport,
        'PRODUCT: intervening trusted Undo restored the pile but consumed or permitted the queued Space fit');
      assert.equal(run.afterRelease.state.viewport, run.beforeSpace.viewport,
        'PRODUCT: a stale queued Space fit changed the viewport after intervening trusted Undo');
    }
    phase = slug + '-close';
    assert.equal(browserEvents.length, 0, 'Unexpected browser errors');
    await context.close();
    browserContext = undefined;
    console.log(slug + ': passed');
  }
} catch (error) {
  failure.push({ phase, detail: String(error.stack ?? error), kind: /PRODUCT:/.test(String(error)) ? 'product' : 'fixture' });
  if (browserContext) {
    const page = browserContext.pages()[0];
    if (page) {
      try {
        observations.firstFailureBrowser = await value(page);
        await page.screenshot({ path: join(output, 'stale-fit-first-failure.png'), timeout: 4000 });
      } catch (captureError) {
        observations.captureError = String(captureError);
      }
    }
  }
} finally {
  for (const [name, close] of [['context', () => browserContext?.close()], ['browser', () => browser?.close()], ['gateway', () => app?.close()]]) {
    try { await close(); }
    catch (error) { failure.push({ phase: 'cleanup-' + name, detail: String(error) }); }
  }
  if (scratch) {
    try {
      assert(!app?.server.listening);
      const resolvedOutput = await realpath(output);
      const resolvedScratch = await realpath(scratch);
      const child = relative(resolvedOutput, resolvedScratch);
      assert(!isAbsolute(child) && !child.includes(sep) && child.startsWith('stale-fit-gateway-store-'));
      observations.cleanup = { storeEntriesBeforeRemoval: await readdir(resolvedScratch), listening: app?.server.listening ?? false };
      await rm(resolvedScratch, { recursive: true });
      observations.cleanup.storeRemoved = !(await readdir(resolvedOutput)).includes(child);
      assert(observations.cleanup.storeRemoved);
    } catch (error) {
      failure.push({ phase: 'cleanup-store', detail: String(error) });
    }
  }
  if (before) {
    try {
      observations.after = await checkoutReceipt();
      assert.deepEqual(observations.after, before);
      await save('stale-fit-checkout-after', observations.after);
    } catch (error) {
      failure.push({ phase: 'checkout-after', detail: String(error) });
    }
  }
  try { await save('stale-fit-probe-result', observations); }
  finally {
    if (failure.length) {
      console.error(JSON.stringify(failure, null, 2));
      process.exitCode = 1;
    }
  }
}
