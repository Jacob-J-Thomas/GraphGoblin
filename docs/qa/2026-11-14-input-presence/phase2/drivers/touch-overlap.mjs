// Real touch evidence for the Omit control's coarse-pointer target (the ~7.5 px overlap claim).
//
//   node drivers/touch-overlap.mjs [label]        (label names the result file; default "candidate")
//
// For New run and Wait, at 1280 and 390 px, on a coarse pointer (hasTouch), it:
//   1. measures the Omit button, its ::after hit box (computed style), and the input below;
//   2. hit-tests every CSS pixel of the input's top strip with elementFromPoint (what Chromium
//      says is under the finger), listing the points the Omit button owns;
//   3. performs REAL touch taps (page.touchscreen.tap, CDP Input.dispatchTouchEvent) at the input
//      centre, on and around the overlap, on the button, and above the button, then records
//      which element took focus, whether the typed text survived, and whether Omit fired.
import { chromium, context, getJson, launch, publishLoop, saveJson, startServer, VISUAL_SCHEMA } from './common.mjs';

const label = process.argv[2] ?? 'candidate';
const results = [];

const server = await startServer();
const browser = await launch();
const log = (...a) => console.log(...a);

async function fresh(ctx, entry, loopId, fieldLabel, fill) {
  const page = await ctx.newPage();
  if (entry === 'New run') {
    await page.goto(`/app/runs/new?loop=${loopId}`);
  } else {
    const run = await (
      await fetch(`${server.url}/loops/${loopId}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { reason: '' } }),
      })
    ).json();
    await page.goto(`/app/runs/${run.run.id}`);
  }
  const submit = entry === 'New run' ? 'Start run' : 'Submit input';
  const form = page.getByRole('form', { name: submit });
  await form.waitFor();
  const field = form.getByLabel(fieldLabel, { exact: true });
  await field.fill(fill);
  const omit = form.getByRole('button', { name: `Omit ${fieldLabel}`, exact: true });
  await omit.waitFor();
  return { page, form, field, omit };
}

async function geometry({ page, field, omit }) {
  return page.evaluate(
    ([fieldEl, omitEl]) => {
      const f = fieldEl.getBoundingClientRect();
      const b = omitEl.getBoundingClientRect();
      const after = getComputedStyle(omitEl, '::after');
      const w = parseFloat(after.width);
      const h = parseFloat(after.height);
      // The ::after rect from its resolved offsets (relative to the button's padding box) and
      // transform, so it is right for any positioning, not just a centred box.
      const bs = getComputedStyle(omitEl);
      const m = new DOMMatrix(after.transform === 'none' ? undefined : after.transform);
      const padLeft = b.left + parseFloat(bs.borderLeftWidth);
      const padTop = b.top + parseFloat(bs.borderTopWidth);
      const bl = padLeft + parseFloat(after.left) + m.m41;
      const bt = padTop + parseFloat(after.top) + m.m42;
      const box = { left: bl, right: bl + w, top: bt, bottom: bt + h };
      // Hit-test the strip of the input and 6 px above it, every px.
      const owned = [];
      for (let y = Math.floor(f.top) - 6; y <= Math.floor(f.top) + 14; y++) {
        for (let x = Math.floor(f.left); x <= Math.ceil(f.right); x++) {
          const t = document.elementFromPoint(x + 0.5, y + 0.5);
          if (t && (t === omitEl || omitEl.contains(t))) owned.push([x, y]);
        }
      }
      const insideInput = owned.filter(([x, y]) => y >= f.top && y < f.bottom && x >= f.left && x < f.right);
      const ys = insideInput.map(([, y]) => y);
      const xs = insideInput.map(([x]) => x);
      // The control above the Omit's row (the previous field's input/textarea/select).
      const above = [...fieldEl.closest('form').querySelectorAll('input,textarea,select')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => el !== fieldEl && r.bottom <= b.top + 1 && r.width > 40)
        .sort((p, q) => q.r.bottom - p.r.bottom)[0];
      const p = above?.r;
      let ownedInPrev = 0;
      if (p) {
        for (let y = Math.floor(p.bottom) - 14; y < Math.ceil(p.bottom); y++) {
          for (let x = Math.floor(p.left); x <= Math.ceil(p.right); x++) {
            const t = document.elementFromPoint(x + 0.5, y + 0.5);
            if (t && (t === omitEl || omitEl.contains(t))) ownedInPrev++;
          }
        }
      }
      // Rows of the hit box that are not over a control (the 6 px gap, the label row, the 16 px gap).
      const ownedYs = owned.map(([, y]) => y);
      const ringBottom = b.bottom + 4; // outline 2 px + offset 2 px outside the border box
      return {
        prev: p ? { bottom: p.bottom, left: p.left, right: p.right } : null,
        ownedPointsInPrevControl: ownedInPrev,
        afterClearsPrevBy: p ? Math.max(0, 0) + (box.top - p.bottom) : null,
        afterClearsInputBy: f.top - box.bottom,
        focusRingClearsInputBy: f.top - ringBottom,
        ownedPointsRowRange: ownedYs.length ? [Math.min(...ownedYs), Math.max(...ownedYs)] : null,
        coarse: matchMedia('(pointer: coarse)').matches,
        input: { left: f.left, right: f.right, top: f.top, bottom: f.bottom, width: f.width, height: f.height },
        button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height },
        afterBox: { ...box, width: w, height: h, position: after.position },
        afterOverlapsInputPx: Math.max(0, box.bottom - f.top),
        ownedPointsInsideInput: insideInput.length,
        ownedInputXRange: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
        ownedInputYRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null,
        ownedAboveInput: owned.filter(([, y]) => y < f.top).length,
      };
    },
    [await field.elementHandle(), await omit.elementHandle()],
  );
}

async function tapAt(ctx, entry, loopId, fieldLabel, point, name, geom0) {
  const s = await fresh(ctx, entry, loopId, fieldLabel, 'typed text');
  const g = await geometry(s);
  const [x, y] = point(g);
  if (![x, y].every(Number.isFinite)) { await s.page.close(); return { name, skipped: 'no ::after hit box on this build', omitted: false, textSurvived: true, focusedLabel: '-', tap: [] }; }
  await s.page.touchscreen.tap(x, y);
  await s.page.waitForTimeout(150);
  const state = await s.page.evaluate(
    ([fieldEl]) => ({
      value: fieldEl.value,
      focusedLabel: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? document.activeElement?.tagName,
      activeIsField: document.activeElement === fieldEl,
      omitCount: document.querySelectorAll('button[aria-label^="Omit "]').length,
    }),
    [await s.field.elementHandle()],
  );
  const omitted = state.omitCount === 0 || state.value === '';
  await s.page.close();
  return { name, tap: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], ...state, omitted, textSurvived: state.value === 'typed text' };
}

try {
for (const entry of ['New run', 'Wait']) {
  const loopId = await publishLoop(server.url, `touch ${entry}`, VISUAL_SCHEMA, VISUAL_SCHEMA);
  for (const width of [390, 1280]) {
    for (const fieldLabel of ['comment', 'payload']) {
      const ctx = await context(await browser, { url: server.url, width, theme: 'light', touch: true });
      const probe = await fresh(ctx, entry, loopId, fieldLabel, 'typed text');
      const g = await geometry(probe);
      await probe.page.close();
      const row = { entry, width, field: fieldLabel, geometry: g, taps: [] };
      const inputCentre = (g2) => [(g2.input.left + g2.input.right) / 2, (g2.input.top + g2.input.bottom) / 2];
      const taps = [
        ['input centre', inputCentre],
        ['input top-left+4,+4', (g2) => [g2.input.left + 4, g2.input.top + 4]],
        ['input top edge +1 under the Omit centre x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.input.top + 1]],
        ['input top edge +4 under the Omit centre x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.input.top + 4]],
        ['input top edge +7 under the Omit centre x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.input.top + 7]],
        ['input top edge +9 under the Omit centre x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.input.top + 9]],
        ['input top-right corner -2,+2', (g2) => [g2.input.right - 2, g2.input.top + 2]],
        ['input top-right corner -6,+6', (g2) => [g2.input.right - 6, g2.input.top + 6]],
        ['inside the drawn Omit button, top-left +2,+2', (g2) => [g2.button.left + 2, g2.button.top + 2]],
        ['inside the drawn Omit button, bottom-right -2,-2', (g2) => [g2.button.right - 2, g2.button.bottom - 2]],
        ['Omit button centre', (g2) => [(g2.button.left + g2.button.right) / 2, (g2.button.top + g2.button.bottom) / 2]],
        ['just below the drawn Omit button (in the gap)', (g2) => [(g2.button.left + g2.button.right) / 2, g2.button.bottom + 2]],
        ['top of the hit box (above the label line, +2 px)', (g2) => [(g2.button.left + g2.button.right) / 2, g2.afterBox.top + 2]],
        ['bottom of the hit box (-2 px), nearest the input', (g2) => [(g2.button.left + g2.button.right) / 2, g2.afterBox.bottom - 2]],
        ['bottom of the previous field, 2 px up, under the Omit x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.prev.bottom - 2]],
        ['bottom of the previous field, 8 px up, under the Omit x', (g2) => [(g2.button.left + g2.button.right) / 2, g2.prev.bottom - 8]],
      ];
      for (const [name, point] of taps) {
        row.taps.push(await tapAt(ctx, entry, loopId, fieldLabel, point, name));
      }
      await ctx.close();
      results.push(row);
      log(`${entry} ${width} ${fieldLabel}: coarse=${g.coarse} afterOverlapsInput=${g.afterOverlapsInputPx}px owned inside input=${g.ownedPointsInsideInput} x=${JSON.stringify(g.ownedInputXRange)} y=${JSON.stringify(g.ownedInputYRange)}`);
      for (const t of row.taps) log(`   ${t.omitted ? 'OMITTED ' : 'kept    '} ${t.textSurvived ? 'text kept ' : 'TEXT LOST '} focus=${t.focusedLabel}  <- ${t.name} @ ${t.tap}`);
    }
  }
}

saveJson(`logs/touch-overlap-${label}.json`, results);
log('done');
} finally {
  await browser.close();
  await server.stop();
}
