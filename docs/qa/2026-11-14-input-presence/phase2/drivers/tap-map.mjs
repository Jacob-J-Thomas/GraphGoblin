// 2D map of REAL touch taps that wrongly invoke Omit, for one CSS variant of the Omit control.
//   node drivers/tap-map.mjs <label> <variant> [field=comment|payload] [fresh=0|1]
//
// variant (injected as CSS, coarse pointer only; "current" injects nothing):
//   current    the build as it is
//   noafter    ::after hit box removed (the drawn 20 px button only)
//   pad4       noafter + 4 px extra space under the label row
//   pad8       noafter + 8 px extra space under the label row
// For the field, taps a grid in (a) the input's top 14 px and (b) the bottom 12 px of the field
// above it, across the Omit's x-range +-26 px, and counts taps that fired Omit (typed text lost).
// A tap inside a control that fires Omit is the defect. fresh=1 reloads before every tap.
import { context, launch, saveJson, publishLoop, startServer, VISUAL_SCHEMA } from './common.mjs';

const [label = 'run', variant = 'current', fieldLabel = 'comment', fresh = '0'] = process.argv.slice(2);
const step = Number(process.env.GG_STEP ?? 4);
const entry = process.env.GG_ENTRY ?? 'newrun'; // newrun | wait
const width = Number(process.env.GG_WIDTH ?? 1280);
const CSS = {
  current: '',
  noafter: '@media (pointer: coarse) { button[aria-label^="Omit "]::after { display: none !important } }',
  pad2: '@media (pointer: coarse) { button[aria-label^="Omit "]::after { display: none !important } div:has(> span > button[aria-label^="Omit "]) { padding-bottom: 2px } }',
  pad3: '@media (pointer: coarse) { button[aria-label^="Omit "]::after { display: none !important } div:has(> span > button[aria-label^="Omit "]) { padding-bottom: 3px } }',
  pad4: '@media (pointer: coarse) { button[aria-label^="Omit "]::after { display: none !important } div:has(> span > button[aria-label^="Omit "]) { padding-bottom: 4px } }',
  pad8: '@media (pointer: coarse) { button[aria-label^="Omit "]::after { display: none !important } div:has(> span > button[aria-label^="Omit "]) { padding-bottom: 8px } }',
}[variant];
if (CSS === undefined) throw new Error(`unknown variant ${variant}`);

const server = await startServer();
const browser = await launch();
try {
  const loopId = await publishLoop(server.url, 'tap map', VISUAL_SCHEMA, VISUAL_SCHEMA);
  const ctx = await context(browser, { url: server.url, width, height: width < 640 ? 844 : 900, theme: 'light', touch: true });
  const page = await ctx.newPage();
  const form = page.getByRole('form', { name: entry === 'wait' ? 'Submit input' : 'Start run' });
  const field = form.getByLabel(fieldLabel, { exact: true });
  const omit = form.getByRole('button', { name: `Omit ${fieldLabel}`, exact: true });
  const prepare = async () => {
    if (entry === 'wait') {
      const res = await fetch(`${server.url}/loops/${loopId}/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { reason: '' } }) });
      await page.goto(`/app/runs/${(await res.json()).run.id}`);
    } else await page.goto(`/app/runs/new?loop=${loopId}`);
    if (CSS) await page.addStyleTag({ content: CSS });
    await field.fill('typed text');
    await omit.waitFor();
    await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(50);
  };
  await prepare();
  const b = await omit.boundingBox();
  const f = await field.boundingBox();
  const prev = await page.evaluate(([fieldEl, top]) => {
    const above = [...fieldEl.closest('form').querySelectorAll('input,textarea,select')]
      .map((el) => el.getBoundingClientRect()).filter((r) => r.bottom <= top && r.width > 40)
      .sort((p, q) => q.bottom - p.bottom)[0];
    return { bottom: above.bottom, top: above.top };
  }, [await field.elementHandle(), b.y + 1]);
  const gapPx = f.y - (b.y + b.height);
  const points = [];
  for (let x = Math.round(b.x - 26); x <= Math.round(b.x + b.width + 26); x += step) {
    for (let dy = 0; dy <= 14; dy += 1) points.push({ region: 'input', x, y: Math.round(f.y) + dy, depth: dy });
    for (let dy = 0; dy <= 12; dy += 2) points.push({ region: 'previous', x, y: Math.round(prev.bottom) - 1 - dy, depth: dy });
  }
  const fired = [];
  let n = 0;
  for (const p of points) {
    if (fresh === '1') await prepare();
    else if ((await omit.count()) === 0) { await field.fill('typed text'); await omit.waitFor(); await page.waitForTimeout(350); }
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(fresh === '1' ? 30 : 80);
    const lost = (await omit.count()) === 0;
    n++;
    if (lost) fired.push(p);
  }
  const summary = {
    label, variant, field: fieldLabel, fresh, entry, width, taps: n,
    geometry: { button: b, input: f, previousBottom: prev.bottom, gapButtonBottomToInputTopPx: gapPx },
    firedInInput: fired.filter((p) => p.region === 'input').length,
    maxDepthIntoInput: Math.max(-1, ...fired.filter((p) => p.region === 'input').map((p) => p.depth)),
    firedInPrevious: fired.filter((p) => p.region === 'previous').length,
    maxDepthIntoPrevious: Math.max(-1, ...fired.filter((p) => p.region === 'previous').map((p) => p.depth)),
    fired,
  };
  saveJson(`logs/tap-map-${label}-${variant}-${entry}-${width}-${fieldLabel}.json`, summary);
  console.log(JSON.stringify({ ...summary, fired: undefined, firedXRange: fired.length ? [Math.min(...fired.map((p) => p.x)), Math.max(...fired.map((p) => p.x))] : null }));
} finally {
  await browser.close();
  await server.stop();
}
