const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.cwd();
const { chromium, expect } = createRequire(path.join(root, 'apps/web/package.json'))(
  '@playwright/test',
);
const dir = path.join(root, 'docs/qa/2026-10-21-wp-g4-qa');
const base = 'http://127.0.0.1:5641';
const phase = process.argv[2] || 'before';
let state = fs.existsSync(dir + '/ids.json') ? JSON.parse(fs.readFileSync(dir + '/ids.json')) : {};
let checks = [];
let browser, page;
const clean = (x) =>
  JSON.stringify(x, null, 2)
    .replaceAll(root, '<worktree>')
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%');
const save = (name, x) => fs.writeFileSync(dir + '/' + name, clean(x) + '\n');
async function api(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const t = await r.text();
  if (!r.ok) throw Error(method + ' ' + url + ' ' + r.status + ' ' + t);
  return t ? JSON.parse(t) : null;
}
async function check(id, steps, expected, work) {
  if (phase === 'fixture-corrections' && !['gate-run', 'null-before', 'unfinished'].includes(id))
    return;
  try {
    checks.push({ id, steps, expected, actual: await work(), verdict: 'PASS' });
    console.log('PASS ' + id);
  } catch (e) {
    checks.push({ id, steps, expected, actual: e.message, verdict: 'FAIL' });
    console.log('FAIL ' + id + ' ' + e.message.slice(0, 200));
  }
  save(phase + '-checks.json', checks);
  save('ids.json', state);
}
async function publish(def) {
  const x = await api('POST', '/loops', { definition: def });
  await api('POST', '/loops/' + x.loop.id + '/publish', {});
  return x.loop.id;
}
async function run(loop, body = {}) {
  const x = await api('POST', '/loops/' + loop + '/runs', body);
  await expect
    .poll(async () => (await api('GET', '/runs/' + x.run.id)).status, { timeout: 60000 })
    .toMatch(/^(succeeded|exhausted|waiting.*)$/);
  return x.run.id;
}
async function editor(loop, node) {
  await page.goto(base + '/app/loops/' + loop + '/edit');
  await page.getByTestId('node-' + node).click({ position: { x: 60, y: 12 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  return page.getByRole('dialog');
}
const quiet =
  'Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure.';
const suppressed =
  'No value was returned: Returns is None, so no destination received anything (caller, log from the exit). This is the exit’s configuration, not a failure.';
const ambiguous =
  'No value was recorded for this run. The exit’s Returns is an expression, so the history alone does not show whether it returned nothing or a null that an older build did not record.';
const missing =
  'No value was recorded for this run. The pinned definition is not available, so whether the exit’s Returns is None cannot be shown.';
async function inspect(id, reason, result) {
  await page.goto(base + '/app/runs/' + id);
  await expect(
    page.getByRole('list', { name: 'Timeline' }).getByText('run.finished', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  if (reason) await expect(page.getByTestId('exit-returns')).toHaveText(reason);
  else {
    await expect(page.getByTestId('run-result')).toHaveText(result);
    await expect(page.getByTestId('exit-returns')).toHaveCount(0);
  }
  await expect(page.getByTestId('run-result')).toHaveCount(result === undefined ? 0 : 1);
  const top = await page.locator('body').innerText();
  await page
    .getByRole('list', { name: 'Timeline' })
    .getByText('exit.evaluated', { exact: true })
    .last()
    .click();
  if (reason)
    await expect(page.getByText(/^Exit outcome:/)).toHaveText(
      'Exit outcome: success. This exit is terminal. ' + reason,
    );
  return {
    top,
    detail: await page.getByText(/^Exit outcome:/).textContent(),
    run: await api('GET', '/runs/' + id),
    events: (await api('GET', '/runs/' + id + '/events')).items.filter(
      (e) => ['exit.evaluated', 'run.finished'].includes(e.type) || e.type.startsWith('return.'),
    ),
  };
}
async function main() {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  save('browser.json', { browser: 'Microsoft Edge', version: browser.version(), port: 5641 });
  if (phase === 'before' || phase === 'fixture-corrections') {
    for (const name of ['gate', 'suppressed', 'quiet'])
      await check(
        'import-' + name,
        'POST owner JSON fixture; publish with JSON {}.',
        '201 created, 200 published.',
        async () => {
          const x = JSON.parse(
            fs.readFileSync('docs/qa/2026-10-19-wp-g4-exit-evidence/' + name + '-loop.json'),
          );
          state[name] = { loop: await publish(x.definition) };
          return state[name];
        },
      );
    await check(
      'gate-editor',
      'Open Gate; check exact help; duplicate second route label as Again; restore Done; inspect at 768px.',
      'Exact Routes/Id/Label help, inline unique-label error clears on restoration, dialog fits viewport.',
      async () => {
        const d = await editor(state.gate.loop, 'gate');
        const routes = d.getByRole('group', { name: 'Routes', exact: true });
        await expect(routes).toHaveAccessibleDescription(
          'At least 2 items. Two to sixty-four routes with unique ids and unique labels; the expression returns one id.',
        );
        await expect(
          routes.locator('[data-field="routes.1.id"] input'),
        ).toHaveAccessibleDescription(
          'Stable route id and output port; changing display order does not change the route.',
        );
        const label = routes.locator('[data-field="routes.1.label"] input');
        await expect(label).toHaveAccessibleDescription(
          'Unique readable route label, shown on the canvas and in Connections.',
        );
        await label.fill('Again');
        await label.blur();
        await expect(
          routes.getByText('route labels must be unique', { exact: true }),
        ).toBeVisible();
        const duplicate = await d.innerText();
        await label.fill('Done');
        await label.blur();
        await expect(routes.getByText('route labels must be unique', { exact: true })).toHaveCount(
          0,
        );
        await page.setViewportSize({ width: 768, height: 900 });
        const box = await d.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(769);
        const restored = await d.innerText();
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1440, height: 900 });
        await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
        return { duplicate, restored, viewport: 768, box };
      },
    );
    await check(
      'suppressed-editor',
      'Open Done in the suppressed fixture.',
      'Returns None and both exact help sentences.',
      async () => {
        const d = await editor(state.suppressed.loop, 'done');
        await expect(
          d.getByText(
            'No returned value. The run finishes without a result, and destinations receive nothing.',
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          d.getByRole('group', { name: 'Destinations', exact: true }),
        ).toHaveAccessibleDescription(
          'Returns is None, so these 2 destinations receive nothing. Choose a JSONata expression to deliver a value, or remove destinations for a quiet exit.',
        );
        return await d.innerText();
      },
    );
    await check(
      'quiet-editor',
      'Open Quiet, then Kept; add an Exit from palette and inspect default caller; undo addition.',
      'Exact quiet help, ordinary destinations help for expression, singular suppressed-destination help for new Exit.',
      async () => {
        let d = await editor(state.quiet.loop, 'quiet');
        await expect(
          d.getByRole('group', { name: 'Destinations', exact: true }),
        ).toHaveAccessibleDescription(
          'Quiet exit: nothing is returned or delivered. The run still finishes with its outcome.',
        );
        const q = await d.innerText();
        await page.keyboard.press('Escape');
        await page.getByTestId('node-kept').click({ position: { x: 60, y: 12 } });
        d = page.getByRole('dialog');
        const k = await d.innerText();
        expect(k).toContain(
          'Return destinations; caller by default. No delivery when returns is none.',
        );
        await page.keyboard.press('Escape');
        const prior = await page
          .locator('.react-flow__node')
          .evaluateAll((ns) => ns.map((n) => n.getAttribute('data-id')));
        await page.getByRole('button', { name: 'Add Exit node', exact: true }).click();
        const added = await page
          .locator('.react-flow__node')
          .evaluateAll(
            (ns, prior) =>
              ns.map((n) => n.getAttribute('data-id')).find((id) => !prior.includes(id)),
            prior,
          );
        if (!(await page.getByRole('dialog').isVisible()))
          await page.getByTestId('node-' + added).click({ position: { x: 60, y: 12 } });
        await expect(
          page.getByRole('dialog').getByRole('group', { name: 'Destinations', exact: true }),
        ).toHaveAccessibleDescription(
          'Returns is None, so this destination receives nothing. Choose a JSONata expression to deliver a value, or remove destinations for a quiet exit.',
        );
        const n = await page.getByRole('dialog').innerText();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^Undo/ }).click();
        await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
        return { quiet: q, kept: k, newExit: n };
      },
    );
    for (const name of ['gate', 'suppressed', 'quiet'])
      await check(
        name + '-run',
        'Runs → New run; choose imported published fixture; Start run; inspect top and timeline.',
        name === 'gate'
          ? 'exhausted, Result 3, route again, port limit-reached, passes 3/3, Maximum passes.'
          : 'succeeded; no Result or return events; exact distinct explanation in top and exit detail.',
        async () => {
          await page.goto(base + '/app/runs');
          await page.getByRole('link', { name: 'New run', exact: true }).click();
          await page.getByLabel('Loop', { exact: true }).selectOption(state[name].loop);
          const response = page.waitForResponse(
            (r) =>
              r.request().method() === 'POST' &&
              r.url().endsWith('/loops/' + state[name].loop + '/runs'),
          );
          await page.getByRole('button', { name: /^(Start run|Run|Start)$/ }).click();
          const started = await (await response).json();
          state[name].run = started.run.id;
          save('ids.json', state);
          await expect
            .poll(async () => (await api('GET', '/runs/' + started.run.id)).status, {
              timeout: 60000,
            })
            .toBe(name === 'gate' ? 'exhausted' : 'succeeded');
          if (name !== 'gate') {
            const x = await inspect(started.run.id, name === 'quiet' ? quiet : suppressed);
            expect(x.events.filter((e) => e.type.startsWith('return.'))).toHaveLength(0);
            return x;
          }
          await page.goto(base + '/app/runs/' + started.run.id);
          await expect(page.getByTestId('run-result')).toHaveText('3');
          await expect(page.getByText('Exited: exhausted', { exact: true }).first()).toBeVisible();
          await expect(
            page.getByText(
              'Last gate decision: gate chose again on pass 3 of 3; maximum passes stopped the repeat, so it took Limit reached.',
              { exact: true },
            ),
          ).toBeVisible();
          await page
            .getByRole('list', { name: 'Timeline' })
            .getByText('decision.made', { exact: true })
            .last()
            .click();
          for (const [term, value] of Object.entries({
            'Route ID': 'again',
            'Selected port': 'limit-reached',
            Label: 'Again',
            'Previous passes': '3',
            'Current passes': '3',
            'Limit stopping repeat': 'Maximum passes',
          }))
            await expect(
              page.getByText(term, { exact: true }).locator('xpath=following-sibling::dd[1]'),
            ).toHaveText(value);
          return {
            text: await page.locator('body').innerText(),
            events: (await api('GET', '/runs/' + started.run.id + '/events')).items.filter((e) =>
              ['decision.made', 'run.finished', 'exit.evaluated'].includes(e.type),
            ),
          };
        },
      );
    await check(
      'kept-before',
      'Change only disposable quiet draft Check expression to "keep" via API; publish v2; run.',
      'API result kept; Result card "kept"; no exit-returns sentence.',
      async () => {
        const x = await api('GET', '/loops/' + state.quiet.loop);
        const definition = (x.draft || x.current).definition;
        definition.nodes.find((n) => n.id === 'check').config.jsonata = '"keep"';
        await api('PUT', '/loops/' + state.quiet.loop + '/draft', { definition });
        await api('POST', '/loops/' + state.quiet.loop + '/publish', {});
        state.kept = { loop: state.quiet.loop, run: await run(state.quiet.loop) };
        save('ids.json', state);
        const actual = await inspect(state.kept.run, undefined, '"kept"');
        expect(actual.run.result).toBe('kept');
        return actual;
      },
    );
    await check(
      'null-before',
      'Publish trigger→exit returns:"null", destinations:[caller]; run twice; preserve one unamended control.',
      'API has result:null; Result card null; no exit-returns sentence.',
      async () => {
        const loop = await publish({
          schemaVersion: 4,
          name: 'QA 129 audit null',
          nodes: [
            { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
            {
              id: 'done',
              kind: 'exit',
              label: 'Done',
              config: { returns: 'null', destinations: [{ kind: 'caller' }] },
            },
          ],
          edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
        });
        state.null = { loop, run: await run(loop) };
        state.presentNull = { loop, run: await run(loop) };
        save('ids.json', state);
        const x = await inspect(state.null.run, undefined, 'null');
        expect(Object.hasOwn(x.run, 'result')).toBe(true);
        expect(x.run.result).toBe(null);
        return x;
      },
    );
    await check(
      'unfinished',
      'Publish trigger→input-wait→exit None/caller; run; inspect waiting; cancel through API.',
      'No exit-returns sentence while unfinished or cancelled.',
      async () => {
        const loop = await publish({
          schemaVersion: 4,
          name: 'QA 129 unfinished',
          nodes: [
            { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
            {
              id: 'wait',
              kind: 'wait',
              label: 'Wait',
              config: { mode: 'input', prompt: 'QA hold' },
            },
            {
              id: 'done',
              kind: 'exit',
              label: 'Done',
              config: { returns: 'none', destinations: [{ kind: 'caller' }] },
            },
          ],
          edges: [
            { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
            { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
          ],
        });
        state.waiting = { loop, run: await run(loop) };
        save('ids.json', state);
        await page.goto(base + '/app/runs/' + state.waiting.run);
        await expect(page.getByText('QA hold', { exact: true })).toBeVisible();
        await expect(page.getByTestId('exit-returns')).toHaveCount(0);
        const waiting = await page.locator('body').innerText();
        await api('POST', '/runs/' + state.waiting.run + '/cancel', {});
        await expect
          .poll(async () => (await api('GET', '/runs/' + state.waiting.run)).status)
          .toBe('cancelled');
        await page.reload();
        await expect(page.getByRole('list', { name: 'Timeline' })).toBeVisible();
        await expect(page.getByTestId('exit-returns')).toHaveCount(0);
        return { waiting, cancelled: await page.locator('body').innerText() };
      },
    );
  } else {
    for (const name of ['kept', 'null'])
      await check(
        name + '-amended',
        'Stop built process; remove result from run.finished and set runs.result=NULL; restart; inspect top and exit detail.',
        'Exact ambiguous expression sentence; no Result card.',
        () => inspect(state[name].run, ambiguous),
      );
    for (const [name, reason] of [
      ['quiet', quiet],
      ['suppressed', suppressed],
    ])
      await check(
        name + '-restart',
        'Reopen original v1 run after restart and publication of quiet v2.',
        'Exact original None/quiet explanation; no Result.',
        () => inspect(state[name].run, reason),
      );
    await check(
      'present-null-restart',
      'Open unamended null control after restart.',
      'Result null, API result:null; no exit-returns.',
      () => inspect(state.presentNull.run, undefined, 'null'),
    );
    await check(
      'missing-definition',
      'Block pinned version request with controlled 404 in a fresh context; open amended null run.',
      'Exact pinned-definition-unavailable sentence; no asserted None or quiet configuration; no Result.',
      async () => {
        const c = await browser.newContext({ serviceWorkers: 'block' });
        const prev = page;
        page = await c.newPage();
        let blocked = [];
        try {
          await page.route('**/loops/*/versions/*', async (r) => {
            blocked.push(new URL(r.request().url()).pathname);
            await r.fulfill({
              status: 404,
              contentType: 'application/json',
              body: JSON.stringify({ code: 'NOT_FOUND', message: 'QA unavailable definition' }),
            });
          });
          const x = await inspect(state.null.run, missing);
          expect(blocked.length).toBeGreaterThan(0);
          expect(x.top).not.toContain('No value was returned: Returns is None');
          expect(x.top).not.toContain('Quiet exit: Returns is None');
          return { blocked, ...x };
        } finally {
          page = prev;
          await c.close();
        }
      },
    );
  }
}
main()
  .catch((e) => {
    checks.push({ id: 'harness', verdict: 'FAIL', actual: e.stack });
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    save(phase + '-checks.json', checks);
    save('ids.json', state);
    await browser?.close();
    if (checks.some((x) => x.verdict === 'FAIL')) process.exitCode = 1;
  });
