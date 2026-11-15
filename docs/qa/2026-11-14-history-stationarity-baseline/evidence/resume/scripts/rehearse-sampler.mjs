// Instrument rehearsal ONLY: exercises the driver's in-page sampler on a static synthetic toolbar
// served from a loopback server owned by this process. It never touches the GraphGoblin product,
// a gateway, a store or the owner ports. Output: rehearsal/rehearsal-result.json next to the script.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/98jak/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const driverFile = process.argv[2] || 'measure.playwright.js';
const driver = await readFile(join(here, driverFile), 'utf8');
const startMarker = 'const installSampler = () => {';
const endMarker = '  // ---------------------------------------------------------------- node-side plumbing';
const a = driver.indexOf(startMarker), b = driver.indexOf(endMarker);
assert(a > 0 && b > a, 'markers');
const installSrc = driver.slice(a, b);
const installSampler = new Function(installSrc + '\nreturn installSampler;')();

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px sans-serif}
header.app{height:56px;background:#222;color:#fff}
.frame{display:flex;flex-direction:column;height:calc(100dvh - 3.5rem)}
header.tb{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 16px;border-bottom:1px solid #999}
.grp{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;max-width:100%}
button.h{width:32px;height:32px;padding:0;border:1px solid transparent;transition:translate .12s}
button.h:active{translate:0 1px}
[role=status].ban{padding:8px 24px;background:#fe9}
main{flex:1}
.react-flow__node{display:inline-block;width:40px;height:20px;background:#ccc}
</style></head><body>
<header class="app">app</header>
<div id="banner-slot"></div>
<div class="frame"><header class="tb"><a href="/loops">Loops</a><span>/</span><h1 style="font-size:18px;margin:0">Rehearsal loop</h1><span>draft only</span>
<span data-testid="save-state">All changes saved</span>
<div class="grp"><button class="h" type="button" title="Undo" data-history="undo" aria-keyshortcuts="Control+Z" aria-disabled="true"><span class="sr-only">Undo</span>U</button>
<button class="h" type="button" title="Redo" data-history="redo" aria-keyshortcuts="Control+Shift+Z Control+Y" aria-disabled="true"><span class="sr-only">Redo</span>R</button>
<span role="link" aria-disabled="true" tabindex="0">Open in Runs</span>
<span id="val" style="display:inline-flex;height:36px;align-items:center">Ready to publish</span>
<button type="button" id="pub">Publish</button></div></header>
<main><div class="react-flow__node" data-id="a">a</div></main></div></body></html>`;

const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }).end(html); });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = { origin, checks: {} };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(installSampler);
  await page.goto(origin + '/');
  await page.waitForTimeout(300);
  const base = await page.evaluate(() => window.__qa.setBase());
  result.checks.base = base;
  const snap0 = await page.evaluate(() => window.__qa.snap());
  result.checks.snap0 = snap0;
  result.checks.attrs = await page.evaluate(() => window.__qa.attrs());
  result.checks.meta = await page.evaluate(() => window.__qa.meta());
  result.checks.deviceDraft = await page.evaluate(() => window.__qa.deviceDraft());
  result.checks.gridRest = await page.evaluate(() => window.__qa.hitGrid('[data-history=undo]'));
  // held press -> translate 0px 1px expected
  const c = await page.evaluate(() => { const r = document.querySelector('[data-history=undo]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(c[0], c[1], { steps: 2 });
  await page.mouse.down();
  await page.waitForTimeout(250);
  result.checks.pressHeld = await page.evaluate(() => window.__qa.press('[data-history=undo]'));
  result.checks.gridHeld = await page.evaluate((r) => window.__qa.hitGrid('[data-history=undo]', r), result.checks.gridRest.rect);
  result.checks.intRowsHeld = result.checks.gridHeld.intRows || null;
  await page.mouse.up();
  await page.waitForTimeout(250);
  result.checks.pressAfter = await page.evaluate(() => window.__qa.press('[data-history=undo]'));
  result.checks.intRowsRest = result.checks.gridRest.intRows || null;
  // injected 1px offset must be seen, and removal must restore exactly
  const before = await page.evaluate(() => window.__qa.snap());
  await page.evaluate(() => { const s = document.createElement('style'); s.id = 'k'; s.textContent = '[data-history=undo]{margin-inline-end:1px !important}'; document.head.appendChild(s); });
  await page.waitForTimeout(120);
  const during = await page.evaluate(() => window.__qa.snap());
  await page.evaluate(() => document.getElementById('k').remove());
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => window.__qa.snap());
  result.checks.control = { before: [before.ub, before.rb], during: [during.ub, during.rb], after: [after.ub, after.rb] };
  // one-frame injection must appear in at least one rAF frame
  const nFrames0 = await page.evaluate(() => window.__qa.frames.length);
  await page.evaluate(() => new Promise((done) => { const s = document.createElement('style'); s.textContent = '[data-history=undo]{position:relative !important;top:1px !important}'; document.head.appendChild(s); requestAnimationFrame(() => requestAnimationFrame(() => { s.remove(); done(); })); }));
  await page.waitForTimeout(150);
  // banner insertion / removal and a variable-width label change
  await page.evaluate(() => { const d = document.createElement('div'); d.setAttribute('role', 'status'); d.className = 'ban'; d.textContent = 'Cannot reach the GraphGoblin API'; document.getElementById('banner-slot').appendChild(d); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.getElementById('val').textContent = '2 errors'; document.querySelector('[data-testid=save-state]').textContent = 'Unsaved changes'; });
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.getElementById('banner-slot').textContent = ''; });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  const raw = await page.evaluate(() => { window.__qa.on = false; return { frames: window.__qa.frames, events: window.__qa.events }; });
  result.frameCount = raw.frames.length;
  result.eventTypes = Object.fromEntries([...new Set(raw.events.map((e) => e.type))].map((t) => [t, raw.events.filter((e) => e.type === t).length]));
  const f = raw.frames;
  const uy = f.map((x) => x.u && x.u[1]).filter((v) => v !== null && v !== undefined);
  const ux = f.map((x) => x.u && x.u[0]).filter((v) => v !== null && v !== undefined);
  result.checks.oneFrameSeen = f.slice(nFrames0).some((x) => x.u && x.u[1] !== base.ub[1]);
  result.checks.distinctUndoY = [...new Set(uy)];
  result.checks.distinctUndoX = [...new Set(ux)];
  result.checks.bannerFramesSeen = f.some((x) => x.b !== null && x.b !== undefined);
  result.checks.bannerEvents = raw.events.filter((e) => e.type === 'banner').map((e) => ({ sig: e.sig, undoY: e.f.u && e.f.u[1], frameY: e.f.fr && e.f.fr[1] }));
  result.checks.hitBaseSeen = [...new Set(f.map((x) => x.hu))];
  result.checks.keyEvents = raw.events.filter((e) => e.type === 'keydown').map((e) => [e.key, e.ctrl, e.tg]);
  result.pageErrors = errors;
  // assertions (instrument validity)
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  assert.equal(result.checks.pressHeld.translate, '0px 1px', 'pressed translate seen by sampler');
  assert.equal(result.checks.pressAfter.translate, 'none', 'rest translate');
  assert.equal(result.checks.control.during[0][0], result.checks.control.before[0][0] - 1, 'Undo x moves -1 under margin-inline-end control');
  assert.equal(result.checks.control.during[1][0], result.checks.control.before[1][0], 'Redo x unchanged');
  assert.deepEqual(result.checks.control.after, result.checks.control.before, 'exact restoration after removal');
  assert(result.checks.oneFrameSeen, 'one-frame injection seen by rAF sampler');
  const sigs = result.checks.bannerEvents.map((e) => e.sig); // first callback also logs the initial 'off' state
  assert(result.checks.bannerFramesSeen && sigs.includes('on:Cannot reach the GraphGoblin API') && sigs.at(-1) === 'off' && sigs.indexOf('on:Cannot reach the GraphGoblin API') < sigs.length - 1, 'banner appearance and removal recorded');
  if (result.checks.intRowsRest) {
    const r0 = result.checks.intRowsRest, r1 = result.checks.intRowsHeld;
    assert.deepEqual([r0.insideTopRow[2], r0.insideBottomRow[2], r0.outsideAboveRow[2], r0.outsideBelowRow[2]], [true, true, false, false], 'rest integer rows');
    assert.deepEqual([r1.insideTopRow[2], r1.insideBottomRow[2], r1.outsideAboveRow[2], r1.outsideBelowRow[2]], [false, true, false, true], 'held (1px down) integer rows');
  }
  result.verdict = 'sampler instrument rehearsal passed (' + driverFile + ')';
} catch (e) {
  result.verdict = 'FAILED: ' + String(e && e.stack ? e.stack : e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  await mkdir(join(here, 'rehearsal'), { recursive: true });
  await writeFile(join(here, 'rehearsal', 'rehearsal-result-' + driverFile.replace('.playwright.js', '') + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.verdict);
}
