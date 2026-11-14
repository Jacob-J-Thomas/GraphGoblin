// #209 phase 2 visual capture against the BUILT api + web (native gateway, real SQLite store, real Edge).
// Every image is a real screenshot of a real served page after a real interaction; nothing is composited or mocked.
import { mkdirSync, writeFileSync } from 'node:fs';
import { QA, startNative, api, approvalLoop, equivalent, launchEdge, contextFor, stamp } from './lib.mjs';

const OUT = `${QA}/screens`;
mkdirSync(OUT, { recursive: true });
const results = { startedAt: stamp(), steps: [], failures: [] };
const NORMAL = 'Nightly triage';
const OTHER = 'Daily report';
const MINE = 'Weekly report';
const LONG_SPACES = 'Quarterly customer onboarding reconciliation and escalation workflow for the regional support operations team covering every northern branch'.slice(0, 120).trimEnd();
const LONG_NOSPACE = `Unbroken${'x'.repeat(112)}`;

const gateway = await startNative({ port: 4792, dataDir: `${QA}/native/data-visual`, label: 'visual' });
results.gateway = { url: gateway.url, pid: gateway.pid };
// Whatever happens below, never leave my own gateway running.
process.on('exit', () => gateway.stop());
const seeds = {};
async function seed(key, name) {
  const created = await api(gateway.url, 'POST', '/loops', { definition: approvalLoop(name) });
  if (created.status !== 201) throw new Error(`seed ${name}: ${created.status} ${JSON.stringify(created.json)}`);
  seeds[key] = created.json.loop;
}

const SAMPLE = await (async () => {
  await seed('normal', NORMAL);
  await seed('other', OTHER);
  await seed('mine', MINE);
  await seed('longSpaces', LONG_SPACES);
  await seed('longNoSpace', LONG_NOSPACE);
  await seed('mineLong', 'Editor source for the long name case');
  const starter = await api(gateway.url, 'POST', '/templates/starter/draft', {});
  if (starter.status !== 201) throw new Error(`starter seed ${starter.status}`);
  seeds.starter = starter.json.loop;
  return true;
})();
results.seeds = Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, { id: v.id, name: v.name }]));

const browser = await launchEdge();
results.browser = { version: browser.version() };

async function describeActive(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'body' };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      role: el.getAttribute('role') || undefined,
      label: el.getAttribute('aria-label') || (el.innerText || el.value || '').slice(0, 60),
      invalid: el.getAttribute('aria-invalid') || undefined,
      describedBy: el.getAttribute('aria-describedby') || undefined,
      focusVisible: el.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
      boxShadow: cs.boxShadow === 'none' ? undefined : cs.boxShadow.slice(0, 120),
    };
  });
}

async function layout(page, region) {
  const base = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    forcedColors: matchMedia('(forced-colors: active)').matches,
  }));
  const box = region ? await region.boundingBox() : null;
  const overflowing = region
    ? await region.evaluate((root) => {
        const right = window.innerWidth;
        const out = [];
        for (const el of root.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > right + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return out.slice(0, 8);
      })
    : [];
  return { ...base, regionBox: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }, overflowing, noSidewaysScroll: base.docScrollWidth <= base.innerWidth };
}

async function tabOrder(page, count) {
  const seen = [];
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Tab');
    const d = await describeActive(page);
    seen.push(`${d.tag}${d.role ? `[${d.role}]` : ''}:${d.label ?? ''}`.slice(0, 70));
  }
  return seen;
}

async function step(name, fn) {
  const entry = { name, at: stamp() };
  try {
    entry.readback = await fn();
    entry.ok = true;
  } catch (error) {
    entry.ok = false;
    entry.error = String(error?.stack ?? error).slice(0, 1500);
    results.failures.push(name);
    console.log('STEP FAILED', name, entry.error.split('\n')[0]);
  }
  results.steps.push(entry);
  return entry;
}

async function shot(page, file, locator) {
  if (locator) await locator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: false });
  return `${file}.png`;
}

const loopsField = (page) => page.getByRole('textbox', { name: 'New loop name' });

async function createConflict(page, tag, name, { focusSuggestion = false } = {}) {
  await page.goto('/app/loops');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  const field = loopsField(page);
  await field.fill(equivalent(name));
  const refused = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/loops');
  await field.press('Enter');
  const response = await refused;
  const body = await response.json();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  const use = page.getByRole('button', { name: /^Use “/ });
  const out = { status: response.status(), problem: body, alertText: (await alert.innerText()).replace(/\s+/g, ' ') };
  out.fieldInvalid = await field.getAttribute('aria-invalid');
  out.fieldDescribedBy = await field.getAttribute('aria-describedby');
  out.activeAfterRefusal = await describeActive(page);
  const region = page.locator('form[aria-label="Create loop"]');
  if (focusSuggestion) {
    out.tabOrder = await tabOrder(page, 2);
    out.focusedSuggestion = await describeActive(page);
  }
  out.layout = await layout(page, region);
  out.suggestionBox = await use.boundingBox();
  out.image = await shot(page, tag, alert);
  return out;
}

async function importConflict(page, tag, loop) {
  await page.goto('/app/loops');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  const detail = await (await fetch(`${gateway.url}/loops/${loop.id}/export?draft=true`)).json();
  const refused = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/loops/import');
  await page.getByLabel('Import an exported loop (JSON)').setInputFiles({
    name: 'exported-loop.graphgoblin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(detail)),
  });
  const response = await refused;
  const panel = page.getByRole('region', { name: 'Import under another name' });
  await panel.waitFor();
  const field = panel.getByRole('textbox', { name: 'Name for the imported loop' });
  await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT');
  const out = { status: response.status(), problem: await response.json(), panelText: (await panel.innerText()).replace(/\s+/g, ' ') };
  out.fieldValue = await field.inputValue();
  out.active = await describeActive(page);
  out.tabOrder = await tabOrder(page, 2);
  out.layout = await layout(page, panel);
  // return focus to the field so the screenshot shows the entry state
  await field.focus();
  out.image = await shot(page, tag, panel);
  return out;
}

async function templateConflict(page, tag, { typed } = {}) {
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const card = page.getByRole('region', { name: 'Starter assistant', exact: true });
  const use = card.getByRole('button', { name: 'Use Starter assistant', exact: true });
  const isDraft = (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/templates/starter/draft';
  const refused = page.waitForResponse(isDraft);
  await use.click();
  const first = await refused;
  const out = { firstStatus: first.status(), firstProblem: await first.json() };
  const field = card.getByRole('textbox', { name: 'Name for the new draft' });
  await field.waitFor();
  if (typed) {
    const second = page.waitForResponse(isDraft);
    await field.fill(typed);
    await card.getByRole('button', { name: 'Create draft', exact: true }).click();
    const response = await second;
    out.secondStatus = response.status();
    out.secondProblem = await response.json();
    await card.getByRole('alert').waitFor();
  }
  out.fieldValue = await field.inputValue();
  out.cardText = (await card.innerText()).replace(/\s+/g, ' ');
  await field.focus();
  out.active = await describeActive(page);
  out.tabOrder = await tabOrder(page, 2);
  out.layout = await layout(page, card);
  await field.focus();
  out.image = await shot(page, tag, card);
  return out;
}

async function openEditor(page, loop) {
  await page.bringToFront();
  await page.goto(`/app/loops/${loop.id}/edit`);
  await page.getByRole('heading', { name: loop.name, exact: true }).waitFor();
  await page
    .getByText('The editor is available. Checking the server and this device before saving changes.', { exact: true })
    .waitFor({ state: 'hidden' });
}

async function showPanel(page) {
  await page.getByRole('button', { name: /^(Show|Hide) loop settings$/ }).waitFor();
  const show = page.getByRole('button', { name: 'Show loop settings' });
  if (await show.isVisible()) await show.click();
  await page.getByRole('button', { name: 'Hide loop settings' }).waitFor();
}

async function editorConflict(page, tag, loop, targetName, { dialogTag } = {}) {
  await openEditor(page, loop);
  await showPanel(page);
  const field = page.getByRole('textbox', { name: 'Name', exact: true });
  const refused = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/loops/${loop.id}/draft`);
  await field.fill(equivalent(targetName).toLowerCase());
  const response = await refused;
  const out = { status: response.status(), problem: await response.json() };
  const notice = page.getByRole('status').filter({ hasText: 'Another loop already has this name' });
  await notice.waitFor();
  out.noticeText = (await notice.innerText()).replace(/\s+/g, ' ');
  out.saveState = await page.getByTestId('save-state').innerText();
  out.fieldInvalid = await field.getAttribute('aria-invalid');
  out.fieldDescribedBy = await field.getAttribute('aria-describedby');
  out.noticeButtons = await notice.getByRole('button').allInnerTexts();
  const firstButton = notice.getByRole('button').first();
  await firstButton.focus();
  out.tabFromFirstButton = await tabOrder(page, 2);
  await firstButton.focus();
  out.layout = await layout(page, notice);
  out.image = await shot(page, tag, notice);
  if (dialogTag) {
    const node = page.getByTestId('node-approve').locator(':scope > div:has([data-kind])');
    await node.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    out.dialog = {};
    const dialogNotice = dialog.getByRole('status').filter({ hasText: 'Another loop already has this name' });
    out.dialog.noticeVisible = await dialogNotice.isVisible();
    if (out.dialog.noticeVisible) {
      out.dialog.noticeText = (await dialogNotice.innerText()).replace(/\s+/g, ' ');
      out.dialog.buttons = await dialogNotice.getByRole('button').allInnerTexts();
      out.dialog.layout = await layout(page, dialogNotice);
      out.dialog.dialogBox = await dialog.boundingBox();
    }
    out.dialog.image = await shot(page, dialogTag, out.dialog.noticeVisible ? dialogNotice : undefined);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  }
  return out;
}

async function inContext(theme, width, height, fn, opts = {}) {
  const context = await contextFor(browser, { theme, width, height, url: gateway.url, ...opts });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

const SIZES = [
  [360, 800],
  [768, 900],
  [1440, 900],
];

for (const theme of ['dark', 'light']) {
  for (const [width, height] of SIZES) {
    const key = `${theme}-${width}`;
    await step(`create ${key}`, () => inContext(theme, width, height, (page) => createConflict(page, `${key}-create-conflict`, NORMAL), {}));
    await step(`import ${key}`, () => inContext(theme, width, height, (page) => importConflict(page, `${key}-import-name-form`, seeds.normal), {}));
    await step(`template ${key}`, () => inContext(theme, width, height, (page) => templateConflict(page, `${key}-template-naming`), {}));
    await step(`editor ${key}`, () =>
      inContext(theme, width, height, (page) => editorConflict(page, `${key}-editor-name-notice`, seeds.mine, OTHER, width === 360 || width === 1440 ? { dialogTag: `${key}-editor-node-dialog-notice` } : {}), {}),
    );
  }
  // Stress: 120-character names at the narrowest width, per surface.
  const key = `${theme}-360-long`;
  await step(`create ${key}`, () => inContext(theme, 360, 800, (page) => createConflict(page, `${key}-create-conflict`, LONG_SPACES), {}));
  await step(`import ${key}`, () => inContext(theme, 360, 800, (page) => importConflict(page, `${key}-import-name-form`, seeds.longNoSpace), {}));
  await step(`template ${key}`, () => inContext(theme, 360, 800, (page) => templateConflict(page, `${key}-template-naming`, { typed: equivalent(LONG_SPACES) }), {}));
  await step(`editor ${key}`, () => inContext(theme, 360, 800, (page) => editorConflict(page, `${key}-editor-name-notice`, seeds.mineLong, LONG_SPACES), {}));
}

// Keyboard focus example (normal colours), both themes at 360: Enter submits, Tab reaches Create then Use “suggestion”.
for (const theme of ['dark', 'light']) {
  await step(`focus ${theme}-360`, () => inContext(theme, 360, 800, (page) => createConflict(page, `${theme}-360-focus-suggestion`, NORMAL, { focusSuggestion: true }), {}));
}
// Forced colours (Windows high-contrast emulation): Create guidance with focus on the suggestion, and the editor notice.
await step('forced-colors create 360', () => inContext('dark', 360, 800, (page) => createConflict(page, 'forced-colors-360-create-focus-suggestion', NORMAL, { focusSuggestion: true }), { forcedColors: 'active' }));
await step('forced-colors editor 768', () => inContext('dark', 768, 900, (page) => editorConflict(page, 'forced-colors-768-editor-name-notice', seeds.mine, OTHER), { forcedColors: 'active' }));
await step('forced-colors template 360', () => inContext('dark', 360, 800, (page) => templateConflict(page, 'forced-colors-360-template-naming'), { forcedColors: 'active' }));

results.finishedAt = stamp();
writeFileSync(`${OUT}/readback.json`, JSON.stringify(results, null, 2));
await browser.close();
gateway.stop();
console.log(`done: ${results.steps.filter((s) => s.ok).length}/${results.steps.length} steps ok; failures: ${results.failures.join(' | ') || 'none'}`);
