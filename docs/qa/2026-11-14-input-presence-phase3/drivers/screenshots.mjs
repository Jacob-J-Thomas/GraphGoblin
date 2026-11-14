// Screenshots of New run and the Wait card with Omit, phase 3.
//   node drivers/screenshots.mjs <set-name>
// Output: screenshots/<set>/<entry>-<width>-<pointer>-<theme>-<state>.png (device scale 2)
//   entry  : newrun | wait (every field kind) | long-newrun | long-wait (long titles) |
//            rawopt-newrun | rawopt-wait (raw JSON editor, no schema)
//   states : untouched; edited (Omit on the edited optional fields); focus-omit / focus-omit-json
//            (keyboard focus on a text / JSON Omit by Shift+Tab, padded crop); rows-* (padded crop of
//            the edited rows); number-error ('-').
// 390 px uses a coarse pointer (hasTouch), 1280 px a fine pointer; 1280 coarse is also captured in light.
// Forced colours are NOT painted by Playwright's emulation, so none are captured here.
import { context, launch, out, publishLoop, saveJson, startServer, VISUAL_SCHEMA } from './common.mjs';
import { LONG_JSON_TITLE, LONG_SCHEMA, LONG_TITLE } from './schemas.mjs';

const set = process.argv[2] ?? 'candidate';
const server = await startServer();
const browser = await launch();
const notes = [];

async function open(page, entry, loopId) {
  if (entry.endsWith('newrun')) await page.goto(`/app/runs/new?loop=${loopId}`);
  else {
    const body = entry.startsWith('rawopt') ? {} : { input: entry === 'wait' ? { reason: '' } : {} };
    const res = await fetch(`${server.url}/loops/${loopId}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.run) throw new Error(`start run for ${entry} -> ${res.status} ${JSON.stringify(json)}`);
    await page.goto(`/app/runs/${json.run.id}`);
  }
  const form = page.getByRole('form', { name: entry.endsWith('newrun') ? 'Start run' : 'Submit input' });
  await form.waitFor();
  await page.evaluate(() => document.fonts.ready);
  return form;
}

const file = (name) => out('screenshots', set, `${name}.png`);

/** A padded crop around fields, from above the first label row to below the last control. */
async function crop(page, form, first, last = first) {
  const a = await form.getByLabel(first, { exact: true }).boundingBox();
  const b = await form.getByLabel(last, { exact: true }).boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, a.x - 24);
  const y = Math.max(0, a.y - 96);
  return { x, y, width: Math.min(vp.width - x, a.width + 48), height: b.y + b.height + 24 - y };
}

async function focusShot(page, form, field, tag, name) {
  await form.getByLabel(field, { exact: true }).press('Shift+Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  const visible = await page.evaluate(() => document.activeElement?.matches(':focus-visible'));
  notes.push({ tag, state: name, focused, focusVisible: visible });
  await page.screenshot({ path: file(`${tag}-${name}`), clip: await crop(page, form, field) });
}

async function states(page, entry, loopId, tag) {
  const form = await open(page, entry, loopId);
  await form.screenshot({ path: file(`${tag}-untouched`) });
  const f = (l) => form.getByLabel(l, { exact: true });
  if (entry.startsWith('rawopt')) {
    await f('Input (JSON)').fill('{"a": 1}');
    await form.screenshot({ path: file(`${tag}-edited`) });
    await focusShot(page, form, 'Input (JSON)', tag, 'focus-omit');
    return;
  }
  if (entry.startsWith('long')) {
    await f(LONG_TITLE).fill('typed text');
    await f(LONG_JSON_TITLE).fill('{"a": 1}');
    await form.screenshot({ path: file(`${tag}-edited`) });
    await focusShot(page, form, LONG_TITLE, tag, 'focus-omit');
    await focusShot(page, form, LONG_JSON_TITLE, tag, 'focus-omit-json');
    return;
  }
  await f('comment').fill('drop this');
  await f('message').fill('x');
  await f('message').clear();
  await f('title').fill('x');
  await f('title').clear();
  await f('payload').fill('{"a": 1}');
  await f('number').fill('5');
  await form.screenshot({ path: file(`${tag}-edited`) });
  await page.screenshot({ path: file(`${tag}-rows-text`), clip: await crop(page, form, 'untouched', 'title') });
  await page.screenshot({ path: file(`${tag}-rows-json`), clip: await crop(page, form, 'number', 'payload') });
  await focusShot(page, form, 'comment', tag, 'focus-omit');
  await focusShot(page, form, 'payload', tag, 'focus-omit-json');
  await f('number').fill('');
  await f('number').press('-');
  await form.getByRole('button', { name: entry.endsWith('newrun') ? 'Start run' : 'Submit input' }).click();
  await form.getByText('number: enter a number').waitFor();
  await form.screenshot({ path: file(`${tag}-number-error`) });
}

try {
  const loops = {
    newrun: await publishLoop(server.url, 'visual newrun', VISUAL_SCHEMA, VISUAL_SCHEMA),
    wait: await publishLoop(server.url, 'visual wait', VISUAL_SCHEMA, VISUAL_SCHEMA),
    'long-newrun': await publishLoop(server.url, 'long newrun', LONG_SCHEMA, LONG_SCHEMA),
    'long-wait': await publishLoop(server.url, 'long wait', LONG_SCHEMA, LONG_SCHEMA),
    'rawopt-newrun': await publishLoop(server.url, 'raw optional newrun', undefined, undefined),
    'rawopt-wait': await publishLoop(server.url, 'raw optional wait', undefined, undefined),
  };
  const matrix = [
    [390, true, 'light'], [390, true, 'dark'],
    [1280, false, 'light'], [1280, false, 'dark'],
    [1280, true, 'light'],
  ];
  for (const entry of Object.keys(loops)) {
    for (const [width, touch, theme] of matrix) {
      const ctx = await context(browser, { url: server.url, width, height: 2600, theme, touch, dsf: 2 });
      const page = await ctx.newPage();
      const tag = `${entry}-${width}-${touch ? 'coarse' : 'fine'}-${theme}`;
      await states(page, entry, loops[entry], tag);
      notes.push({ tag, coarse: await page.evaluate(() => matchMedia('(pointer: coarse)').matches), theme: await page.evaluate(() => document.documentElement.dataset.theme) });
      await ctx.close();
    }
  }
  saveJson(`logs/screenshots-${set}-notes.json`, notes);
  console.log(JSON.stringify(notes));
} finally {
  await browser.close();
  await server.stop();
}
