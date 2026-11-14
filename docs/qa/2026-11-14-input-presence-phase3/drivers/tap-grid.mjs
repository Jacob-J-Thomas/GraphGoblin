// REAL touch taps (page.touchscreen.tap -> CDP Input.dispatchTouchEvent) around a revealed Omit on a
// coarse pointer. Wrong action = a tap whose point lies inside another control (the current field,
// the control before it, or the field's label) that makes Omit fire (the typed text is lost).
// Taps inside the drawn button must fire Omit.
//   node drivers/tap-grid.mjs <label>     env: GG_STEP (x step, default 4), GG_CONFIGS (filter)
import { context, launch, publishLoop, saveJson, startServer, VISUAL_SCHEMA } from './common.mjs';
import { LONG_TITLE, LONG_SCHEMA } from './schemas.mjs';

const label = process.argv[2] ?? 'candidate';
const step = Number(process.env.GG_STEP ?? 4);
const filter = process.env.GG_CONFIGS ? new RegExp(process.env.GG_CONFIGS) : null;

const server = await startServer();
const browser = await launch();
const summaries = [];
try {
  const visual = await publishLoop(server.url, 'tap visual', VISUAL_SCHEMA, VISUAL_SCHEMA);
  const long = await publishLoop(server.url, 'tap long', LONG_SCHEMA, LONG_SCHEMA);
  const configs = [];
  for (const entry of ['New run', 'Wait'])
    for (const width of [390, 1280])
      for (const [loopId, field, value] of [
        [visual, 'comment', 'typed text'],
        [visual, 'payload', '{"typed":1}'],
        ...(width === 390 ? [[long, LONG_TITLE, 'typed text']] : []),
      ])
        configs.push({ entry, width, loopId, field, value });
  for (const cfg of configs) {
    const name = `${cfg.entry} ${cfg.width} ${cfg.field.slice(0, 20)}`;
    if (filter && !filter.test(name)) continue;
    const ctx = await context(browser, { url: server.url, width: cfg.width, height: 844, theme: 'light', touch: true });
    const page = await ctx.newPage();
    if (cfg.entry === 'New run') await page.goto(`/app/runs/new?loop=${cfg.loopId}`);
    else {
      const res = await fetch(`${server.url}/loops/${cfg.loopId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: cfg.loopId === visual ? { reason: '' } : {} }),
      });
      await page.goto(`/app/runs/${(await res.json()).run.id}`);
    }
    const form = page.getByRole('form', { name: cfg.entry === 'New run' ? 'Start run' : 'Submit input' });
    await form.waitFor();
    const field = form.getByLabel(cfg.field, { exact: true });
    const omit = form.getByRole('button', { name: `Omit ${cfg.field}`, exact: true });
    const refill = async () => {
      await field.fill(cfg.value);
      await omit.waitFor();
    };
    await refill();
    await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const geo = await field.evaluate((el) => {
      const form = el.closest('form');
      const button = el.previousElementSibling.querySelector('button');
      const lab = form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const rect = (e) => {
        const b = e.getBoundingClientRect();
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      };
      const b = rect(button);
      const prev = [...form.querySelectorAll('input:not([type=radio]),textarea,select')]
        .filter((c) => c !== el && c.getBoundingClientRect().bottom <= b.top)
        .sort((p, q) => q.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom)[0];
      // The label's text lines, so a tap counts as "on the label" only on its glyph boxes.
      const range = document.createRange();
      range.selectNodeContents(lab);
      return {
        button: b,
        field: rect(el),
        previous: prev ? rect(prev) : null,
        labelBox: rect(lab),
        labelLines: [...range.getClientRects()].map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
      };
    });
    const inside = (p, r) => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
    const points = [];
    const b = geo.button;
    for (let x = Math.round(b.left - 26); x <= Math.round(b.right + 26); x += step) {
      for (let d = 0; d <= 14; d += 1) points.push({ region: 'current field', x, y: geo.field.top + 0.5 + d, depth: d });
      if (geo.previous)
        for (let d = 0; d <= 12; d += 2)
          points.push({ region: 'previous control', x, y: geo.previous.bottom - 0.5 - d, depth: d });
    }
    // The label: every 3 px over its box, nearest the button first.
    for (let x = Math.floor(geo.labelBox.right) - 1; x >= Math.max(geo.labelBox.left, geo.labelBox.right - 60); x -= 3)
      for (let y = geo.labelBox.top + 1; y < geo.labelBox.bottom; y += 3) points.push({ region: 'label', x, y, depth: Math.round(b.left - x) });
    // Taps inside the drawn button: corners 4 px in (inside its rounded shape), edge midpoints 1 px
    // in, centre. The 1 px corners lie outside the rounded corners: recorded for information only.
    const cx = (b.left + b.right) / 2;
    const cy = (b.top + b.bottom) / 2;
    const own = [
      [b.left + 4, b.top + 4], [b.right - 4, b.top + 4], [b.left + 4, b.bottom - 4], [b.right - 4, b.bottom - 4],
      [cx, b.top + 1], [cx, b.bottom - 1], [b.left + 1, cy], [b.right - 1, cy], [cx, cy],
    ].map(([x, y]) => ({ region: 'button', x, y }));
    own.push(...[[b.left + 1, b.top + 1], [b.right - 1, b.top + 1], [b.left + 1, b.bottom - 1], [b.right - 1, b.bottom - 1]]
      .map(([x, y]) => ({ region: 'outside rounded corner (info)', x, y })));
    const results = { wrong: [], missedButton: [], late: 0, taps: 0, byRegion: {} };
    // Count every click that reaches an Omit button (capture phase, before React handles it), so a
    // firing is attributed to its tap even when the re-render is slow.
    await page.evaluate(() => {
      window.__omitClicks = 0;
      document.addEventListener('click', (e) => { if (e.target.closest?.('button[aria-label^="Omit "]')) window.__omitClicks++; }, true);
    });
    const clicks = () => page.evaluate(() => window.__omitClicks);
    let seen = 0;
    let previous = null;
    for (const p of [...points, ...own]) {
      // Only points that are really inside the control they claim (the label: on a text line).
      if (p.region === 'label' && !geo.labelLines.some((r) => inside(p, r))) continue;
      if (p.region === 'current field' && !inside(p, geo.field)) continue;
      if (p.region === 'previous control' && !inside(p, geo.previous)) continue;
      const before = await clicks();
      if (before > seen && previous) {
        // A click that arrived after the previous tap's check: it belongs to the previous tap.
        results.late++;
        if (previous.region !== 'button' && !previous.region.endsWith('(info)')) results.wrong.push({ ...previous, late: true });
      }
      if ((await omit.count()) === 0) {
        await refill();
        await page.waitForTimeout(150);
      }
      seen = await clicks();
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(60);
      const after = await clicks();
      const fired = after > seen || (await omit.count()) === 0;
      seen = after;
      previous = p;
      results.taps++;
      results.byRegion[p.region] = (results.byRegion[p.region] ?? 0) + 1;
      if (p.region === 'button' && !fired) results.missedButton.push(p);
      if (p.region.endsWith('(info)')) (results.info ??= []).push({ ...p, fired });
      else if (p.region !== 'button' && fired) results.wrong.push(p);
    }
    await page.waitForTimeout(300);
    if ((await clicks()) > seen && previous && previous.region !== 'button' && !previous.region.endsWith('(info)')) results.wrong.push({ ...previous, late: true });
    results.totalOmitClicks = await clicks();
    await expectText(field, cfg);
    const summary = {
      config: name,
      coarse: await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
      geometry: geo,
      buttonSize: [b.right - b.left, b.bottom - b.top],
      taps: results.taps,
      byRegion: results.byRegion,
      wrongOmissions: results.wrong.length,
      lateClicks: results.late,
      totalOmitClicks: results.totalOmitClicks,
      wrong: results.wrong,
      buttonTapsThatDidNotOmit: results.missedButton.length,
      missedButton: results.missedButton,
      info: results.info,
    };
    summaries.push(summary);
    console.log(JSON.stringify({ ...summary, geometry: undefined, wrong: summary.wrong.slice(0, 5), missedButton: summary.missedButton }));
    await ctx.close();
  }
  saveJson(`logs/tap-grid-${label}.json`, summaries);
  const total = summaries.reduce((n, s) => n + s.taps, 0);
  const wrong = summaries.reduce((n, s) => n + s.wrongOmissions, 0);
  const missed = summaries.reduce((n, s) => n + s.buttonTapsThatDidNotOmit, 0);
  console.log(`TOTAL taps ${total}, wrong omissions ${wrong}, button taps that did not omit ${missed}`);
} finally {
  await browser.close();
  await server.stop();
}

async function expectText(field, cfg) {
  // The last tap was on the button, so the field is either empty (omitted) or refilled; refill and
  // confirm the field keeps typed text, i.e. the page is still usable.
  await field.fill(cfg.value);
  if ((await field.inputValue()) !== cfg.value) throw new Error(`${cfg.field}: text not kept`);
}
