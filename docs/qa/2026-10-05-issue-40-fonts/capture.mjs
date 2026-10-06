#!/usr/bin/env node
/**
 * The #40 font sample: Loops, Runs, Events, New run, Not found, both editor node dialogs, the run
 * inspector, Settings (viewport and full page), in every face Settings → Appearance → Font offers,
 * at 1024x768 and 1440x900, in Dark and Light, plus the editor canvas at 200% zoom (a 1440x900
 * window at 200%: a 720x450 CSS viewport at device scale 2) in Dark for each face.
 *
 *   node docs/qa/2026-10-05-issue-40-fonts/capture.mjs [out-dir]
 *
 * Run `pnpm build` first. The script starts apps/web/e2e/server.ts (the in-memory API with the
 * fake harness, serving apps/web/dist), seeds loops, runs, and inbound events through the API, and
 * chooses each face and theme the way Settings does (the stored `graphgoblin-font` and
 * `graphgoblin-theme`, which the boot scripts in index.html show before first paint). Each shot waits for the page's fonts to
 * load. It also measures every shot for readability problems and writes them to metrics.json:
 * horizontal page scroll, text cut off by an ellipsis or a clip, and the font the browser actually
 * rendered the body text and the first heading in (CSS.getPlatformFontsForNode), and inner
 * horizontal scroll containers. Playwright comes from apps/web's devDependencies; on Windows the
 * installed Edge is used, as in the E2E config (set GG_E2E_BROWSER_CHANNEL to override).
 *
 * The faces are the app's own list (FONTS in apps/web/src/lib/font.ts, which the Font control
 * renders), and each face's expected families come from its rule in apps/web/src/styles/fonts.css.
 * Before every shot the script checks that the page shows the requested face (data-font on <html>
 * and the computed text and heading families), and after it that the browser drew those families;
 * anything else stops the script, so a pruned or broken face is never photographed as Geist. Set
 * GG_CAPTURE_ONLY to a comma-separated list of faces, and GG_CAPTURE_SCREENS to a comma-separated
 * list of screens (loops, runs, events, new-run, not-found, editor-dialog,
 * editor-dialog-inference, inspector, settings, settings-full, editor, font-control), to take only
 * those; their metrics replace the matching entries in metrics.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const webRoot = join(root, 'apps', 'web');
const require = createRequire(join(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');

const out = process.argv[2] ? resolve(process.argv[2]) : here;
const channel =
  process.env['GG_E2E_BROWSER_CHANNEL'] ?? (process.platform === 'win32' ? 'msedge' : undefined);

/** Import a TypeScript module of the app through tsx (apps/web's devDependency). */
async function importApp(path) {
  const tsx = dirname(require.resolve('tsx/package.json'));
  const api = JSON.parse(readFileSync(join(tsx, 'package.json'), 'utf8')).exports['./esm/api'];
  const { tsImport } = await import(pathToFileURL(join(tsx, api.import.default)).href);
  return tsImport(pathToFileURL(join(webRoot, path)).href, import.meta.url);
}

const { FONTS } = await importApp('src/lib/font.ts');
const FONTS_CSS = readFileSync(join(webRoot, 'src', 'styles', 'fonts.css'), 'utf8');
const TOKENS_CSS = readFileSync(join(webRoot, 'src', 'styles', 'tokens.css'), 'utf8');

/** The first family a token value names, with var(--font-sans) read from tokens.css. */
function firstFamily(value) {
  if (value.startsWith('var(--font-sans)')) return /--font-sans:\s*'([^']+)'/.exec(TOKENS_CSS)[1];
  const quoted = /^'([^']+)'/.exec(value);
  if (!quoted) throw new Error(`cannot read a family from "${value}"`);
  return quoted[1];
}

/** The text (--font-ui) and heading (--font-display) families fonts.css gives a face. */
function expectedFamilies(font) {
  const rule = new RegExp(`\\[data-font='${font}'\\]\\s*{([^}]*)}`).exec(FONTS_CSS);
  if (!rule) throw new Error(`styles/fonts.css has no rule for data-font='${font}'`);
  const token = (name) => {
    const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(rule[1]);
    if (!declaration) throw new Error(`the rule for '${font}' does not set ${name}`);
    return firstFamily(declaration[1].trim());
  };
  return { text: token('--font-ui'), heading: token('--font-display') };
}

const firstOf = (family) =>
  family
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '');

const THEMES = ['dark', 'light'];
const SIZES = [
  { suffix: '1024', width: 1024, height: 768, scale: 1 },
  { suffix: '1440', width: 1440, height: 900, scale: 1 },
];
const ZOOM = { suffix: '200pct', width: 720, height: 450, scale: 2 };

function startServer() {
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
    { cwd: webRoot, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  return new Promise((resolveStart, reject) => {
    let buffer = '';
    const urls = {};
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const control = /GG_E2E_CONTROL (\S+)/.exec(buffer);
      if (control) urls.control = control[1];
      const ready = /GG_E2E_READY (\S+)/.exec(buffer);
      if (ready) resolveStart({ child, base: ready[1], control: urls.control });
    });
    child.once('exit', (code) => reject(new Error(`the E2E server exited with ${code}`)));
  });
}

async function call(base, path, method = 'GET', body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };
const done = (x, y) => ({ id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x, y } });

function chain(name, description, middle) {
  const nodes = [{ ...trigger, ui: { x: 0, y: 80 } }];
  middle.forEach((node, i) => nodes.push({ ...node, ui: { x: 260 * (i + 1), y: 80 } }));
  nodes.push(done(260 * (middle.length + 1), 80));
  const edges = nodes.slice(1).map((node, i) => ({
    id: `e${i + 1}`,
    from: { node: nodes[i].id, port: 'out' },
    to: { node: node.id },
  }));
  return { schemaVersion: 1, name, description, nodes, edges };
}

const ask = (id, label, template) => ({
  id,
  kind: 'inference',
  label,
  config: { prompt: { template } },
});

/** One node of each kind, with a decision, a subloop, and a loop-back from the exit. */
function nightlyTriage(childLoopId) {
  const n = (id, kind, label, config, x, y) => ({ id, kind, label, config, ui: { x, y } });
  return {
    schemaVersion: 1,
    name: 'nightly-triage',
    description: 'Triages new issues every night and opens a fix when one is needed',
    nodes: [
      n('nightly', 'trigger', 'Nightly', { subtype: 'manual' }, 0, 0),
      n(
        'triage',
        'inference',
        'Triage new issues',
        { prompt: { template: 'Triage: {{ trigger.payload }}' } },
        260,
        0,
      ),
      n(
        'needs-fix',
        'decision',
        'Needs a fix?',
        {
          routes: [
            { label: 'yes', description: 'A code change would resolve the issue' },
            { label: 'no', description: 'Nothing to change' },
          ],
          question: 'Does {{ lastOutput }} call for a code change?',
          strategy: ['expression'],
          expression: { jsonata: 'vars.severity >= 2 ? "yes" : "no"' },
        },
        520,
        0,
      ),
      n('run-tests', 'script', 'Run tests', { command: 'pnpm', args: ['test'] }, 0, 200),
      n('open-pr', 'subloop', 'Open PR', { loopRef: { loopId: childLoopId } }, 260, 200),
      n('watch-ci', 'heartbeat', 'Watch CI', { intervalSeconds: 60, maxBeats: 30 }, 520, 200),
      n(
        'record',
        'mutate',
        'Record outcome',
        { operations: [{ op: 'append-message', role: 'note', content: 'No fix needed' }] },
        0,
        400,
      ),
      n('approve', 'wait', 'Approve merge', { mode: 'input', prompt: 'Merge the fix?' }, 260, 400),
      n('done', 'exit', 'Done', { loopBack: { targetNodeId: 'triage' } }, 520, 400),
    ],
    edges: [
      { id: 'e1', from: { node: 'nightly', port: 'out' }, to: { node: 'triage' } },
      { id: 'e2', from: { node: 'triage', port: 'out' }, to: { node: 'needs-fix' } },
      { id: 'e3', from: { node: 'needs-fix', port: 'yes' }, to: { node: 'run-tests' } },
      { id: 'e4', from: { node: 'needs-fix', port: 'no' }, to: { node: 'record' } },
      { id: 'e5', from: { node: 'run-tests', port: 'out' }, to: { node: 'open-pr' } },
      { id: 'e6', from: { node: 'open-pr', port: 'out' }, to: { node: 'watch-ci' } },
      { id: 'e7', from: { node: 'watch-ci', port: 'out' }, to: { node: 'approve' } },
      { id: 'e8', from: { node: 'record', port: 'out' }, to: { node: 'done' } },
      { id: 'e9', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
      { id: 'e10', from: { node: 'done', port: 'loopBack' }, to: { node: 'triage' } },
    ],
  };
}

async function waitForStatus(base, runId, statuses) {
  for (let i = 0; i < 100; i += 1) {
    const run = await call(base, `/runs/${runId}`);
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never reached ${statuses.join(' or ')}`);
}

async function seed(base, control) {
  await call(control, '/harness/script', 'POST', {
    turns: [
      {
        matchPrompt: 'LABEL',
        error: { code: 'TURN_FAILED', message: 'The harness exited before the turn finished' },
      },
      { matchPrompt: 'SUMMARY', items: 6, finalText: 'Three issues need a decision.' },
    ],
  });
  const create = async (definition) => (await call(base, '/loops', 'POST', { definition })).loop.id;
  const publish = (id) => call(base, `/loops/${id}/publish`, 'POST');
  const run = async (id) => (await call(base, `/loops/${id}/runs`, 'POST', {})).run.id;

  const review = await create(
    chain('pr-review', 'Reviews an open pull request and leaves comments', [
      ask('review', 'Review diff', 'Review the diff: {{ lastMessage.content }}'),
    ]),
  );
  await publish(review);
  await waitForStatus(base, await run(review), ['succeeded']);

  const labeller = await create(
    chain('issue-labeller', 'Labels incoming issues by area and type', [
      ask('label', 'Label issue', 'LABEL the issue: {{ trigger.payload }}'),
    ]),
  );
  await publish(labeller);
  await waitForStatus(base, await run(labeller), ['failed']);

  const approval = await create(
    chain('weekly-summary', 'Drafts the weekly summary and waits for approval', [
      ask('draft', 'Draft summary', 'SUMMARY of the week: {{ trigger.payload }}'),
      {
        id: 'approve',
        kind: 'wait',
        label: 'Approve',
        config: { mode: 'input', prompt: 'Post this summary?' },
      },
    ]),
  );
  await publish(approval);
  const waitingRun = await run(approval);
  await waitForStatus(base, waitingRun, ['waiting']);

  await create(
    chain('release-notes', 'Drafts release notes from merged pull requests', [
      ask('notes', 'Write notes', 'Release notes for {{ trigger.payload }}'),
    ]),
  );

  const nightly = await create(nightlyTriage(review));
  await publish(nightly);

  // Keep the Events screen populated with stable, recognizable inbound rows.
  await call(base, '/events', 'POST', {
    type: 'issue.opened',
    payload: { repo: 'graphgoblin', number: 482, title: 'Editor crashes on paste' },
    dedupeKey: 'issue-482',
  });
  await call(base, '/events', 'POST', {
    type: 'build.finished',
    payload: { ok: true },
  });

  return { nightly, weekly: approval, waitingRun };
}

function screens({ base, nightly, weekly, waitingRun }) {
  return [
    { name: 'loops', url: `${base}/app/loops`, ready: 'nightly-triage' },
    { name: 'runs', url: `${base}/app/runs`, ready: 'Children' },
    { name: 'events', url: `${base}/app/events`, ready: 'issue.opened' },
    { name: 'new-run', url: `${base}/app/runs/new?loop=${weekly}`, ready: 'Start run' },
    { name: 'not-found', url: `${base}/app/nowhere`, ready: /not found/i },
    {
      name: 'editor-dialog',
      url: `${base}/app/loops/${nightly}/edit`,
      ready: 'Needs a fix?',
      click: '[data-testid="node-needs-fix"]',
    },
    {
      name: 'editor-dialog-inference',
      url: `${base}/app/loops/${nightly}/edit`,
      ready: 'Triage new issues',
      act: async (page) => {
        await page.locator('.react-flow__node[data-id="triage"]').focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByLabel('Model', { exact: true }).waitFor();
        await dialog.getByLabel('Effort', { exact: true }).waitFor();
        await dialog.getByText('Advanced', { exact: true }).waitFor();
      },
    },
    { name: 'inspector', url: `${base}/app/runs/${waitingRun}`, ready: 'Input requested' },
    { name: 'settings', url: `${base}/app/settings`, ready: 'Model catalog' },
    {
      name: 'settings-full',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      fullPage: true,
    },
  ];
}

/** Readability measurements of what is on screen (see the header). */
async function measure(page, fullPage) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: 0 });
  const rendered = async (selector) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector });
    if (!nodeId) return [];
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((font) => ({ family: font.familyName, glyphs: font.glyphCount }));
  };
  const layout = await page.evaluate((includeFullPage) => {
    const root = document.documentElement;
    const bodyFamily = getComputedStyle(document.body).fontFamily;
    const visibleHeight = includeFullPage ? Math.max(innerHeight, root.scrollHeight) : innerHeight;
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      // Screen-reader-only text is a 1 px box; it is never cut for a sighted reader.
      return box.width > 2 && box.height > 2 && box.bottom > 0 && box.top < visibleHeight;
    };
    const cut = [];
    const innerScroll = [];
    let sample;
    for (const element of document.body.querySelectorAll('*')) {
      if (!(element instanceof HTMLElement) || !element.textContent?.trim()) continue;
      if (element.closest('.cm-editor, [aria-hidden="true"]') || !visible(element)) continue;
      const style = getComputedStyle(element);
      const ownText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      // The first visible run of text in the text face: what the body font renders as.
      if (!sample && ownText && style.fontFamily === bodyFamily && !element.closest('h1,h2,h3')) {
        sample = element;
        element.setAttribute('data-gg-sample', '');
      }
      const clips =
        style.textOverflow === 'ellipsis' ||
        ((style.overflowX === 'hidden' || style.overflowX === 'clip') &&
          element.children.length === 0);
      if (!clips || style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.scrollWidth > element.clientWidth + 1) cut.push(element.textContent.trim());
    }
    for (const element of document.body.querySelectorAll('*')) {
      if (!(element instanceof HTMLElement) || !visible(element)) continue;
      const style = getComputedStyle(element);
      if (
        (style.overflowX !== 'auto' && style.overflowX !== 'scroll') ||
        element.scrollWidth <= element.clientWidth + 1
      ) {
        continue;
      }
      const table = element.matches('table') ? element : element.querySelector('table');
      const tableName = document.querySelector('h1')?.textContent?.trim() ?? 'unnamed';
      const label =
        element.getAttribute('aria-label') ??
        (table ? `${tableName} table` : undefined) ??
        element.querySelector('caption,h1,h2,h3')?.textContent?.trim() ??
        element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) ??
        element.tagName.toLowerCase();
      innerScroll.push(label);
    }
    return {
      font: root.getAttribute('data-font'),
      bodyFamily,
      pageScroll: root.scrollWidth > root.clientWidth,
      cut: [...new Set(cut)].slice(0, 20),
      innerScroll: [...new Set(innerScroll)].slice(0, 20),
    };
  }, fullPage);
  const body = await rendered('[data-gg-sample]');
  const heading = await rendered('h1, h2');
  const list = (fonts) => fonts.map((font) => `${font.family} (${font.glyphs})`).join(', ');
  return {
    metrics: { ...layout, bodyRendered: list(body), headingRendered: list(heading) },
    drawn: { body: body.map((font) => font.family), heading: heading.map((font) => font.family) },
  };
}

/** Stop the script unless the page shows `font`: its attribute and its computed families. */
async function expectShown(page, font, label) {
  const expected = expectedFamilies(font);
  const shown = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    return {
      font: document.documentElement.getAttribute('data-font'),
      text: getComputedStyle(document.body).fontFamily,
      heading: heading ? getComputedStyle(heading).fontFamily : null,
    };
  });
  const problems = [];
  if (shown.font !== font) problems.push(`data-font is ${JSON.stringify(shown.font)}`);
  if (firstOf(shown.text) !== expected.text) problems.push(`text family is ${shown.text}`);
  if (shown.heading === null) problems.push('there is no h1 to check the heading family on');
  else if (firstOf(shown.heading) !== expected.heading) {
    problems.push(`heading family is ${shown.heading}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `${label}: expected ${font} (${JSON.stringify(expected)}): ${problems.join('; ')}`,
    );
  }
  return expected;
}

/** Stop the script unless the browser drew the expected families (a face that failed to load). */
function expectDrawn(drawn, expected, label) {
  const has = (families, wanted) => families.some((family) => family.startsWith(wanted));
  if (drawn.body.length === 0) {
    throw new Error(`${label}: text probe drew no fonts`);
  }
  if (!has(drawn.body, expected.text)) {
    throw new Error(`${label}: text drawn in ${drawn.body.join(', ')}, not ${expected.text}`);
  }
  if (drawn.heading.length === 0) {
    throw new Error(`${label}: heading probe drew no fonts`);
  }
  if (!has(drawn.heading, expected.heading)) {
    throw new Error(
      `${label}: heading drawn in ${drawn.heading.join(', ')}, not ${expected.heading}`,
    );
  }
}

async function shoot(browser, screen, size, font, theme, dir) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.scale,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  // Choose the face and theme the way Settings does: the boot scripts show them on load.
  try {
    await context.addInitScript(
      ([f, t]) => {
        try {
          window.localStorage.setItem('graphgoblin-font', f);
          window.localStorage.setItem('graphgoblin-theme', t);
        } catch {
          // A page without storage keeps the defaults.
        }
      },
      [font, theme],
    );
    const page = await context.newPage();
    await page.goto(screen.url);
    await page.getByText(screen.ready).first().waitFor();
    if (screen.click) {
      await page.locator(screen.click).click({ position: { x: 60, y: 12 } });
      await page.getByRole('dialog').waitFor();
    }
    await screen.act?.(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const name = `${screen.name}-${theme}-${size.suffix}.png`;
    // Check before the picture is written, so a failed face never leaves a screenshot behind.
    const expected = await expectShown(page, font, `${font}/${name}`);
    const { metrics, drawn } = await measure(page, screen.fullPage === true);
    expectDrawn(drawn, expected, `${font}/${name}`);
    await page.screenshot({ path: join(dir, name), fullPage: screen.fullPage === true });
    return { file: `${font}/${name}`, ...metrics };
  } finally {
    await context.close();
  }
}

/** The Font control itself at device scale 2, keyboard focus on the chosen face (Geist). */
async function shootControl(browser, base, theme) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript((t) => window.localStorage.setItem('graphgoblin-theme', t), theme);
  const page = await context.newPage();
  await page.goto(`${base}/app/settings`);
  const group = page.getByRole('radiogroup', { name: 'Font' });
  await group.waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The control offers exactly the app's faces, each option previewing its own.
  const offered = await group
    .locator('label[data-font]')
    .evaluateAll((options) => options.map((option) => option.getAttribute('data-font')));
  if (offered.join() !== FONTS.join()) {
    throw new Error(`the Font control offers ${offered.join()}, not ${FONTS.join()}`);
  }
  // Tab from the chosen theme lands on the chosen face, so its focus ring shows.
  await page.locator('input[name="theme"]:checked').focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await group.screenshot({ path: join(out, `font-control-${theme}.png`) });
  await context.close();
}

/** Comma-separated names from the environment, each checked against what exists. */
function chosen(variable, known) {
  const names = process.env[variable]?.split(',').filter(Boolean);
  if (!names) return known;
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${variable}: no ${unknown.join(', ')} in ${known}`);
  return names;
}

async function main() {
  const faces = chosen('GG_CAPTURE_ONLY', FONTS);
  const names = [
    'loops',
    'runs',
    'events',
    'new-run',
    'not-found',
    'editor-dialog',
    'editor-dialog-inference',
    'inspector',
    'settings',
    'settings-full',
    'editor',
    'font-control',
  ];
  const wanted = chosen('GG_CAPTURE_SCREENS', names);
  const { child, base, control } = await startServer();
  const results = [];
  let browser;
  try {
    const seeded = await seed(base, control);
    browser = await chromium.launch(channel ? { channel } : {});
    const list = screens({ base, ...seeded });
    const editor = list.find((screen) => screen.name === 'editor-dialog');
    mkdirSync(out, { recursive: true });
    if (wanted.includes('font-control')) {
      for (const theme of THEMES) await shootControl(browser, base, theme);
    }
    for (const font of faces) {
      const dir = join(out, font);
      mkdirSync(dir, { recursive: true });
      for (const theme of THEMES) {
        for (const size of SIZES) {
          for (const screen of list.filter((s) => wanted.includes(s.name))) {
            results.push(await shoot(browser, screen, size, font, theme, dir));
            console.log(`${font} ${screen.name}-${theme}-${size.suffix}`);
          }
        }
      }
      if (wanted.includes('editor')) {
        // The canvas at 200%: the node cards themselves, no dialog over them.
        const canvas = { ...editor, name: 'editor', click: undefined };
        results.push(await shoot(browser, canvas, ZOOM, font, 'dark', dir));
        console.log(`${font} editor-dark-${ZOOM.suffix}`);
      }
    }
  } finally {
    await browser?.close();
    child.stdin.end('stop\n');
  }
  // A partial run replaces its own entries in place and keeps the rest of the set's measurements;
  // entries of faces the app no longer offers are dropped.
  const file = join(out, 'metrics.json');
  const kept = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const fresh = new Map(results.map((result) => [result.file, result]));
  const merged = kept
    .filter((entry) => FONTS.includes(entry.file.split('/')[0]))
    .map((entry) => {
      const replacement = fresh.get(entry.file);
      fresh.delete(entry.file);
      return replacement ?? entry;
    });
  writeFileSync(file, `${JSON.stringify([...merged, ...fresh.values()], null, 2)}\n`);
}

await main();
