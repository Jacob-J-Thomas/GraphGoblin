// Dense sweep of REAL touch taps around the Omit button, to find which taps invoke Omit.
//   node drivers/tap-sweep.mjs <label> [radius]
// For New run (1280, coarse) and the `comment` and `payload` fields, taps every 1 px down the
// Omit's centre line and every 4 px across, from 20 px above the button to 20 px into the input,
// and records for each point: elementFromPoint's target, and whether Omit fired (text lost).
// Optional `radius` sets the CDP touch radius (default: Playwright's tap, which sends none).
import { context, launch, publishLoop, saveJson, startServer, VISUAL_SCHEMA } from './common.mjs';

const label = process.argv[2] ?? 'candidate';
const radius = process.argv[3] ? Number(process.argv[3]) : undefined;
const server = await startServer();
const browser = await launch();
const rows = [];
try {
  const loopId = await publishLoop(server.url, 'sweep', VISUAL_SCHEMA, VISUAL_SCHEMA);
  const ctx = await context(browser, { url: server.url, width: 1280, theme: 'light', touch: true });
  const page = await ctx.newPage();
  const cdp = radius === undefined ? undefined : await ctx.newCDPSession(page);
  await page.goto(`/app/runs/new?loop=${loopId}`);
  const form = page.getByRole('form', { name: 'Start run' });
  const tap = async (x, y) => {
    if (!cdp) return page.touchscreen.tap(x, y);
    const point = { x, y, radiusX: radius, radiusY: radius, force: 1, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (const fieldLabel of ['comment', 'payload']) {
    const field = form.getByLabel(fieldLabel, { exact: true });
    const omit = form.getByRole('button', { name: `Omit ${fieldLabel}`, exact: true });
    const restore = async () => {
      if (await omit.count()) return;
      await field.fill('typed text');
      await omit.waitFor();
    };
    await field.fill('typed text');
    await omit.waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    // Scroll the field to mid-screen so every probe point is on screen.
    await field.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await omit.boundingBox();
    const f = await field.boundingBox();
    const cx = b.x + b.width / 2;
    const fast = process.env.GG_SWEEP_FAST === '1'; // centre line only, input top -12 .. +30
    const xs = fast ? [cx] : [b.x - 8, b.x + 2, cx - 10, cx, cx + 10, b.x + b.width - 2, b.x + b.width + 8];
    for (const dx of xs) {
      for (let y = fast ? Math.round(f.y) - 12 : Math.round(b.y) - 20; y <= Math.round(f.y) + (fast ? 30 : 20); y += 1) {
        await restore();
        const under = await page.evaluate(([x, yy]) => {
          const t = document.elementFromPoint(x, yy);
          return t ? `${t.tagName.toLowerCase()}${t.getAttribute('aria-label') ? `[${t.getAttribute('aria-label')}]` : ''}` : null;
        }, [dx, y]);
        await tap(dx, y);
        await page.waitForTimeout(40);
        const fired = (await omit.count()) === 0;
        rows.push({ field: fieldLabel, x: Math.round(dx * 10) / 10, y, under, fired });
      }
    }
    rows.push({ field: fieldLabel, summary: { button: b, input: f } });
  }
  saveJson(`logs/tap-sweep-${label}.json`, rows);
  // Per field: for each x, the y range where Omit fired.
  for (const fieldLabel of ['comment', 'payload']) {
    const sum = rows.find((r) => r.field === fieldLabel && r.summary).summary;
    console.log(`${fieldLabel}: button y ${sum.button.y.toFixed(1)}..${(sum.button.y + sum.button.height).toFixed(1)} x ${sum.button.x.toFixed(1)}..${(sum.button.x + sum.button.width).toFixed(1)}; input top ${sum.input.y.toFixed(1)}`);
    const xsSeen = [...new Set(rows.filter((r) => r.field === fieldLabel && !r.summary).map((r) => r.x))];
    for (const x of xsSeen) {
      const fired = rows.filter((r) => r.field === fieldLabel && !r.summary && r.x === x && r.fired).map((r) => r.y);
      console.log(`  x=${x}: fired y ${fired.length ? `${Math.min(...fired)}..${Math.max(...fired)} (${fired.length} taps; ${Math.max(...fired) - sum.input.y >= 0 ? `+${(Math.max(...fired) - sum.input.y).toFixed(1)}` : (Math.max(...fired) - sum.input.y).toFixed(1)} px vs input top)` : 'never'}`);
    }
  }
} finally {
  await browser.close();
  await server.stop();
}
