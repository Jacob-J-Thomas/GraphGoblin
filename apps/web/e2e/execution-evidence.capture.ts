import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  CURRENT_DEFINITION_FORMAT,
  RunRecordSchema,
  RunEventSchema,
  ContextThreadSchema,
  type RunEvent,
} from '@graphgoblin/contracts';
import { test, expect } from './fixtures.js';

test('exact recorded execution evidence across inspector, list and API (#255)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const cases = Object.fromEntries(
    Object.entries(
      JSON.parse(process.env['GG_EXECUTION_EVIDENCE'] ?? '{}') as Record<string, unknown>,
    ).map(([name, run]) => [name, RunRecordSchema.parse(run)]),
  );
  expect(Object.keys(cases)).toHaveLength(5);
  const stage = process.env['GG_EVIDENCE_STAGE'] === 'before' ? 'before' : 'after';
  const root = resolve('../../docs/qa/2026-10-24-wp-g1-255');
  await mkdir(root, { recursive: true });
  const captures: Record<string, unknown> = {};
  const rows: Record<string, string> = {};
  await page.goto('/app/runs');
  for (const [name, run] of Object.entries(cases)) {
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: run.id, exact: true }) });
    await expect(row).toBeVisible();
    rows[name] = await row.innerText();
  }
  const history = new Map<string, RunEvent[]>();
  for (const [name, started] of Object.entries(cases)) {
    const run = RunRecordSchema.parse(await (await request.get('/runs/' + started.id)).json());
    const events = RunEventSchema.array().parse(
      ((await (await request.get('/runs/' + run.id + '/events')).json()) as { items: unknown })
        .items,
    );
    const thread = ContextThreadSchema.parse(
      await (await request.get('/runs/' + run.id + '/thread')).json(),
    );
    const version: unknown = await (
      await request.get('/loops/' + run.loopId + '/versions/' + run.versionId)
    ).json();
    history.set(name, events);
    await page.goto('/app/runs/' + run.id);
    const timeline = page.getByRole('list', { name: 'Timeline' });
    await expect(timeline).toBeVisible();
    await expect(timeline.getByRole('button')).toHaveCount(events.length);
    const overview = await page.locator('body').innerText();
    const selected: Record<string, string> = {};
    for (const event of events.filter(
      (e) =>
        e.type === 'decision.made' ||
        (e.type === 'node.finished' && e.nodeId === 'work') ||
        e.type === 'run.cancelled' ||
        e.type === 'run.failed',
    )) {
      await timeline.getByRole('button').nth(events.indexOf(event)).click();
      selected[String(event.seq)] = await page.locator('body').innerText();
    }
    captures[name] = { run, events, thread, version, list: rows[name], overview, selected };
    await page.screenshot({ path: join(root, stage + '-' + name + '.png'), fullPage: true });
  }
  // Evidence paths use the agreed owner-neutral spelling; all other recorded values are retained.
  const json = JSON.stringify(captures, null, 2).replaceAll(
    JSON.stringify(homedir()).slice(1, -1),
    '%USERPROFILE%',
  );
  await writeFile(join(root, stage + '-readers.json'), json);
  const cancelledEvents = history.get('cancelled')!;
  expect(
    cancelledEvents.some(
      (e) => e.type === 'run.cancel_requested' && e.actor.kind === 'user' && e.actor.id === 'local',
    ),
  ).toBe(true);
  expect(cancelledEvents.some((e) => e.type === 'run.cancelled')).toBe(true);
  expect(cancelledEvents.some((e) => e.type === 'run.failed')).toBe(false);
  await page.goto('/app/runs/' + cases['provider']!.id);
  await expect(
    page
      .getByText('Recorded diagnostic: controlled provider connection closed', { exact: false })
      .first(),
  ).toBeVisible();
  await page.goto('/app/runs/' + cases['deadline']!.id);
  await expect(page.getByText(/RUN_DEADLINE_EXCEEDED/).first()).toBeVisible();

  // The short baseline timeout applies only after complete histories and readers were captured.
  const assertion = expect.configure({ soft: true, timeout: stage === 'before' ? 1000 : 10_000 });
  await page.goto('/app/runs/' + cases['append']!.id);
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await timeline
    .getByRole('button')
    .filter({ hasText: 'node.finished' })
    .filter({ hasText: 'work' })
    .click();
  const appends = page
    .getByRole('list', { name: 'Patch diff' })
    .getByRole('listitem')
    .filter({ hasText: '/messages/-' });
  await assertion(appends.filter({ hasText: 'Appended exact value α' })).toHaveCount(1);
  assertion(rows['append']).toContain('Original append loop');
  assertion(rows['append']).not.toContain('Renamed append loop');
  await assertion(timeline).toContainText('Original work');
  await page.goto('/app/runs/' + cases['decision']!.id);
  await assertion(page.getByRole('list', { name: 'Timeline' })).toContainText('Original accept');
  await assertion(page.getByRole('list', { name: 'Timeline' })).toContainText('Original ship');
  const decisions = history.get('decision')!;
  const chosen = decisions.find((e) => e.type === 'decision.made')!;
  await page
    .getByRole('list', { name: 'Timeline' })
    .getByRole('button')
    .nth(decisions.indexOf(chosen))
    .click();
  await assertion(page.getByRole('list', { name: 'Alternative probabilities' })).toContainText(
    'Original accept (accept): 87.65%',
  );
  await assertion(
    page.getByRole('button', { name: 'Exact recorded event #' + chosen.seq }),
  ).toBeVisible();
  await page.goto('/app/runs/' + cases['cancelled']!.id);
  await assertion(page.getByText(/Cancelled by user local/)).toBeVisible();
  assertion(rows['provider']).toContain(
    'Recorded diagnostic: controlled provider connection closed',
  );
  assertion(rows['deadline']).toContain('RUN_DEADLINE_EXCEEDED');

  if (stage === 'after') {
    await page.goto('/app/runs/' + cases['decision']!.id);
    await page
      .getByRole('list', { name: 'Timeline' })
      .getByRole('button')
      .nth(decisions.indexOf(chosen))
      .click();
    await page.getByRole('button', { name: 'Exact recorded event #' + chosen.seq }).click();
    expect(JSON.parse(await page.getByTestId('recorded-event-json').innerText())).toEqual(chosen);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Exact recorded event as JSON' }).click();
    const download = await downloaded;
    const path = join(root, 'after-decision-event.json');
    await download.saveAs(path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(chosen);
    await page.route('**/loops/*/versions/*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Unavailable fixture',
          status: 404,
          code: 'NOT_FOUND',
        }),
      }),
    );
    await page.reload();
    await expect(page.getByText(/Pinned definition unavailable/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Timeline' })).not.toContainText('Renamed');
    await page.unroute('**/loops/*/versions/*');
    await page.reload();
    await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Original ship');
  }
});

for (const width of [390, 768]) {
  test(
    'pinned node and route labels wrap across the inspector at ' + width + ' px (#255)',
    async ({ page, request }) => {
      const nodeLabel = 'N'.repeat(120);
      const waitLabel = 'A'.repeat(120);
      const routeLabel = 'L'.repeat(120);
      const created = await request.post('/loops', {
        data: {
          definition: {
            schemaVersion: CURRENT_DEFINITION_FORMAT,
            name: 'Long pinned labels ' + width,
            nodes: [
              { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
              {
                id: 'wait',
                kind: 'wait',
                label: waitLabel,
                config: { mode: 'input', prompt: 'Continue?' },
              },
              {
                id: 'work',
                kind: 'mutate',
                label: nodeLabel,
                config: {
                  operations: [{ op: 'append-message', role: 'note', content: 'Recorded message' }],
                },
              },
              {
                id: 'pick',
                kind: 'decision',
                label: 'P'.repeat(120),
                config: {
                  kind: 'expression',
                  jsonata: '"go"',
                  routes: [
                    { id: 'go', label: routeLabel },
                    { id: 'stop', label: 'Stop' },
                  ],
                },
              },
              { id: 'done', kind: 'exit', label: 'D'.repeat(120), config: {} },
            ],
            edges: [
              { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
              { id: 'e2', from: { node: 'wait', port: 'out' }, to: { node: 'work' } },
              { id: 'e3', from: { node: 'work', port: 'out' }, to: { node: 'pick' } },
              { id: 'e4', from: { node: 'pick', port: 'go' }, to: { node: 'done' } },
              { id: 'e5', from: { node: 'pick', port: 'stop' }, to: { node: 'done' } },
            ],
          },
        },
      });
      expect(created.status()).toBe(201);
      const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;
      expect((await request.post('/loops/' + loopId + '/publish')).status()).toBe(200);
      const started = await request.post('/loops/' + loopId + '/runs', { data: {} });
      expect(started.status()).toBe(202);
      const run = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/runs/' + run.id);
      await expect(page.getByText('At ' + waitLabel + ' (wait)', { exact: true })).toBeVisible();
      const fits = async () =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      await fits();
      await page.getByLabel('Input (JSON)').fill('true');
      await page.getByRole('button', { name: 'Submit input' }).click();
      await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
      const events = RunEventSchema.array().parse(
        ((await (await request.get('/runs/' + run.id + '/events')).json()) as { items: unknown })
          .items,
      );
      const timeline = page.getByRole('list', { name: 'Timeline' });
      await expect(timeline.getByRole('button')).toHaveCount(events.length);
      const completion = events.findIndex((e) => e.type === 'node.finished' && e.nodeId === 'work');
      await timeline.getByRole('button').nth(completion).click();
      await expect(
        page.getByRole('heading', { name: 'Patch from ' + nodeLabel + ' (work)', exact: true }),
      ).toBeVisible();
      await fits();
      const decision = events.findIndex((e) => e.type === 'decision.made');
      await timeline.getByRole('button').nth(decision).click();
      await expect(page.getByText(routeLabel, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Node progress/ }).click();
      await fits();
    },
  );
}
