// #273 phase 2 keystroke-to-paint measurement in Edge (Claude, not part of the change).
//   node perf-keystroke.mjs <webRootForPlaywright> <gatewayUrl> <label> <evidenceDir> <run> [references=true]
// One fresh Edge launch per run. The fixture is phase 1's realistic generator (perf-273.test.ts.txt,
// `graph(count, references)`), 300 nodes. Cold: the first 20 keystrokes after the editor loads in a
// new browser. Warm: 20 more in the same page after the autosave settles. Per keystroke:
//   nextPaintMs  keydown timeStamp -> requestAnimationFrame -> setTimeout(0) (after that frame)
//   eventTiming  Event Timing entries >= 16 ms (duration includes presentation; 8 ms granularity)
import { createRequire } from 'node:module';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const [webRoot, base, label, evidence, run, refs = 'true'] = process.argv.slice(2);
const references = refs === 'true';
const require = createRequire(join(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');

function producer(i) {
  for (let j = i; j >= 1; j -= 1) if (j % 3 !== 0) return `n${String(j)}`;
  return 'n0';
}
function graph(count, references = true) {
  const nodes = [{ id: 'n0', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 0 } }];
  const edges = [];
  for (let i = 1; i < count - 1; i += 1) {
    const prev = references ? producer(i - 1) : 'none';
    const back = references ? producer(Math.max(1, i - 7)) : 'none';
    const out = (id) => (references ? `outputs.${id}` : 'trigger.payload');
    const visits = (id) => (references ? `counters.nodeVisits.${id}` : 'vars.count');
    const id = `n${String(i)}`;
    const ui = { x: (i % 20) * 300, y: Math.floor(i / 20) * 200 };
    if (i % 3 === 0)
      nodes.push({ id, kind: 'mutate', label: id, ui, config: { operations: [
        { op: 'set', path: `/vars/v${String(i)}`, value: { kind: 'expression', jsonata: `${out(prev)}.value & "-" & $string(${visits(back)})` } },
        { op: 'set', path: `/vars/w${String(i)}`, value: { kind: 'template', template: `{{ ${out(back)}.value }} after {{ ${visits(prev)} }}` } },
      ] } });
    else
      nodes.push({ id, kind: 'inference', label: id, ui, config: { prompt: {
        template: `Step ${String(i)}.\n{% if ${out(prev)} %}Previous: {{ ${out(prev)}.value | json }}{% endif %}\n{% for item in ${out(back)}.value.items %}- {{ item }}\n{% endfor %}Visits: {{ ${visits(back)} }}`,
      } } });
    edges.push({ id: `e${String(i)}`, from: { node: `n${String(i - 1)}`, port: 'out' }, to: { node: id, port: 'in' } });
  }
  const last = `n${String(count - 2)}`;
  const read = references ? producer(count - 2) : 'none';
  nodes.push({ id: 'done', kind: 'exit', label: 'Done', config: { returns: `{"result": ${references ? `outputs.${read}` : 'trigger.payload'}.value, "visits": ${references ? `counters.nodeVisits.${read}` : 'vars.count'}}` }, ui: { x: 0, y: 4000 } });
  edges.push({ id: 'e-done', from: { node: last, port: 'out' }, to: { node: 'done', port: 'in' } });
  return { schemaVersion: 4, name: `perf 300 ${label} ${run} ${Date.now().toString(36)}`, variables: { count: { type: 'number' } }, nodes, edges };
}

const definition = graph(300, references);
const created = await fetch(`${base}/loops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition }) });
if (created.status !== 201) throw new Error(`create ${created.status} ${await created.text()}`);
const loopId = (await created.json()).loop.id;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__lat = [];
  window.__ev = [];
  document.addEventListener('keydown', (event) => {
    const t0 = event.timeStamp;
    requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0));
  }, true);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.interactionId) window.__ev.push({ name: e.name, duration: e.duration, interactionId: e.interactionId, inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart });
    }).observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch {}
});
const loadStart = Date.now();
await page.goto(`${base}/app/loops/${loopId}/edit`);
await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 60_000 });
const loadMs = Date.now() - loadStart;
const issues = await page.getByRole('button', { name: /error|warning/ }).first().innerText().catch(() => 'none');
await page.getByTestId('rf__node-n2').focus();
await page.keyboard.press('Enter');
const dialog = page.getByRole('dialog');
await dialog.waitFor();
// The prompt is on the inference dialog's Context tab.
await dialog.getByRole('tab', { name: /^Context/ }).click();
const field = dialog.locator('[data-field="prompt.template"] .cm-content');
await field.click();
await page.keyboard.press('Control+End');
await page.waitForTimeout(500);
const session = async (text) => {
  await page.evaluate(() => { window.__lat = []; window.__ev = []; });
  await page.keyboard.type(text, { delay: 120 });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ nextPaintMs: window.__lat, eventTiming: window.__ev }));
};
const cold = await session('abcdefghijklmnopqrst');
await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(500);
const warm = await session('uvwxyzabcdefghijklmn');
await page.getByTestId('save-state').filter({ hasText: 'All changes saved' }).waitFor({ timeout: 60_000 });
const stored = await (await fetch(`${base}/loops/${loopId}`)).json();
const template = (stored.draft ?? stored.current).definition.nodes.find((n) => n.id === 'n2').config.prompt.template;
const typedSaved = template.endsWith('abcdefghijklmnopqrstuvwxyzabcdefghijklmn');
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return { n: s.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +s.at(-1).toFixed(2), over16_7: s.filter((x) => x > 16.7).length };
};
const row = {
  label, run, references, loopId, browser: browser.version(), loadToSavedMs: loadMs, indicator: issues, typedSaved,
  cold: { ...stats(cold.nextPaintMs), raw: cold.nextPaintMs.map((x) => +x.toFixed(2)), eventTiming: cold.eventTiming },
  warm: { ...stats(warm.nextPaintMs), raw: warm.nextPaintMs.map((x) => +x.toFixed(2)), eventTiming: warm.eventTiming },
  at: new Date().toISOString(),
};
await appendFile(join(evidence, 'perf-keystroke.jsonl'), JSON.stringify(row) + '\n');
console.log(label, run, 'cold', JSON.stringify({ ...row.cold, raw: undefined, eventTiming: row.cold.eventTiming.length }), 'warm', JSON.stringify({ ...row.warm, raw: undefined, eventTiming: row.warm.eventTiming.length }), 'saved', typedSaved);
await browser.close();
