// Independent real Edge inspection through Playwright's browser API (no test framework).
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { independentStates, at } from './oracle.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('./', import.meta.url));
const reqWeb = createRequire(join(root, 'apps/web/package.json'));
const reqTest = createRequire(reqWeb.resolve('@playwright/test'));
const { chromium } = reqTest('playwright');
const matrix = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
const data = join(tmpdir(), matrix.data.split('/').at(-1));
const auth = JSON.parse(await readFile(join(data, 'browser-state.json'), 'utf8'));
const results = {
  browser: 'Microsoft Edge',
  checks: [],
  sequences: [],
  screenshots: [],
  patches: [],
};
function canonical(x) {
  return JSON.stringify(x, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
const check = (name, actual, expected) =>
  results.checks.push({
    name,
    status: canonical(actual) === canonical(expected) ? 'PASS' : 'FAIL',
    ...(canonical(actual) === canonical(expected) ? {} : { actual, expected }),
  });
async function api(path) {
  const r = await fetch(auth.origin + path, { headers: { authorization: `Bearer ${auth.key}` } });
  if (!r.ok) throw new Error(`${r.status}: ${path}`);
  return r.json();
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
results.version = browser.version();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  storageState: {
    cookies: [],
    origins: [
      { origin: auth.origin, localStorage: [{ name: 'graphgoblin-api-key', value: auth.key }] },
    ],
  },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function screenshot(name, locator) {
  await (locator ?? page).screenshot({
    path: join(out, name),
    ...(locator ? {} : { fullPage: true }),
  });
  results.screenshots.push(name);
}
async function selected(seq) {
  await page.getByRole('heading', { name: `Thread at event ${seq}`, exact: true }).waitFor();
  const json = page.getByTestId('thread-json');
  if (!(await json.isVisible()))
    await page.getByRole('button', { name: 'Full thread JSON' }).click();
  return JSON.parse(await json.innerText());
}
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [label, id] of [
      ['append-seed-2', auth.primaryId],
      ['gate-seed-1', auth.gateId],
      ['guard', auth.guardId],
    ]) {
      const events = (await api(`/runs/${id}/events?limit=1000`)).items;
      const current = await api(`/runs/${id}/thread`);
      const states = independentStates(events[0].initialThread, events);
      check(
        `${width}/${label}: terminal API agrees with independent reconstruction`,
        current,
        states.at(-1).thread,
      );
      await page.goto(`${auth.origin}/app/runs/${id}`);
      const timeline = page.getByRole('list', { name: 'Timeline' }).getByRole('button');
      await timeline.first().waitFor();
      await page.getByRole('heading', { name: /Timeline.*complete/ }).waitFor();
      const missing = [];
      for (let i = 0; i < events.length; i++) {
        const eventButton = page
          .getByRole('list', { name: 'Timeline' })
          .getByRole('button', { name: new RegExp('^#' + events[i].seq + '\\b') });
        if ((await eventButton.count()) === 0) {
          missing.push({ seq: events[i].seq, type: events[i].type });
          continue;
        }
        if (i === 0) {
          await timeline.nth(i).focus();
          await page.keyboard.press('Enter');
        } else await eventButton.click();
        const actual = await selected(events[i].seq);
        const expected = states[i].thread;
        const fields = Object.keys(expected).filter(
          (k) => canonical(actual[k]) !== canonical(expected[k]),
        );
        results.sequences.push({
          width,
          label,
          id,
          seq: events[i].seq,
          type: events[i].type,
          fields,
          status: fields.length ? 'FAIL' : 'PASS',
        });
        if (i === 0) {
          check(
            `${width}/${label}: keyboard-selected first event equals recorded seed`,
            actual,
            events[0].initialThread,
          );
          await screenshot(`${width}-${label}-seed.png`, page.getByTestId('thread-json'));
        }
        if (
          events[i].type === 'node.finished' &&
          !results.patches.some((p) => p.width === width && p.label === label)
        ) {
          const lines = page.getByRole('list', { name: 'Patch diff' }).locator('li');
          const patch = events[i].patch;
          const before = states[i - 1].thread;
          const captured = [];
          for (let p = 0; p < patch.length; p++) {
            const op = patch[p];
            const values = await lines.nth(p).locator('pre').allTextContents();
            const parse = (t) =>
              t.replace(/^[−+]\s*/, '') === '(absent)'
                ? undefined
                : JSON.parse(t.replace(/^[−+]\s*/, ''));
            const displayedBefore = parse(values[0]);
            const displayedAfter = parse(values[1]);
            const expectedBefore = at(before, op.path);
            const expectedAfter =
              op.op === 'add' && op.path.endsWith('/-') ? op.value : at(expected, op.path);
            const status =
              canonical(displayedBefore) === canonical(expectedBefore) &&
              canonical(displayedAfter) === canonical(expectedAfter)
                ? 'PASS'
                : 'FAIL';
            captured.push({ op, displayed: values, expectedBefore, expectedAfter, status });
          }
          results.patches.push({ width, label, id, seq: events[i].seq, lines: captured });
          check(
            `${width}/${label}: patch before and after values agree with events/API`,
            captured.filter((p) => p.status === 'FAIL').map((p) => p.op.path),
            [],
          );
          await screenshot(
            `${width}-${label}-patch.png`,
            patch.length
              ? page.getByRole('list', { name: 'Patch diff' })
              : page.getByTestId('thread-json'),
          );
        }
      }
      check(`${width}/${label}: timeline contains every durable event`, missing, []);
      if (label === 'guard') {
        check(
          `${width}/guard: inspector shows inherited append visits plus two own starts`,
          (await selected(events.at(-1).seq)).counters.nodeVisits.append,
          3,
        );
        const text = await page.locator('body').innerText();
        results.guardText = text.slice(0, 8000);
        await screenshot(`${width}-guard-failure.png`);
      }
      await page.reload();
      await timeline.first().waitFor();
      await timeline.first().click();
      check(
        `${width}/${label}: reload preserves seed reconstruction`,
        await selected(1),
        events[0].initialThread,
      );
      results.checks.push({
        name: `${width}/${label}: horizontal document overflow`,
        status: (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
          ? 'FAIL'
          : 'PASS',
      });
    }
  }
  const second = await context.newPage();
  await second.goto(`${auth.origin}/app/runs/${auth.primaryId}`);
  await second.getByRole('list', { name: 'Timeline' }).getByRole('button').first().click();
  await second.getByRole('button', { name: 'Full thread JSON' }).click();
  const first = JSON.parse(await second.getByTestId('thread-json').innerText());
  const ev = (await api(`/runs/${auth.primaryId}/events?limit=1000`)).items;
  check('two independent tabs show the same recorded seed', first, ev[0].initialThread);
  await second.close();
  check('browser page errors', errors, []);
} catch (error) {
  results.fatal = String(error.stack)
    .replaceAll(root, '<worktree>/')
    .replace(/C:[\\/]Users[\\/][^\\/\r\n]+/gi, '<local>');
} finally {
  await browser.close();
  await writeFile(join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
}
process.stdout.write(
  JSON.stringify({
    checks: results.checks.length,
    failures: results.checks.filter((c) => c.status === 'FAIL').map((c) => c.name),
    sequences: results.sequences.length,
    fatal: results.fatal,
  }) + '\n',
);
