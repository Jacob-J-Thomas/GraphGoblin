import { ContextThreadSchema, RunRecordSchema, type RunEvent } from '@graphgoblin/contracts';
import { replaySeedLoop } from '../scripts/replay-seed-fixture.js';
import { expect, publishLoop, test } from './fixtures.js';

test('bounded Timeline browses a long run with keyboard focus, exact threads and persisted resume', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const definition = replaySeedLoop('Bounded browser history');
  definition.settings = { maxNodeVisits: 1000 };
  const gate = definition.nodes.find((node) => node.kind === 'decision');
  if (!gate || gate.kind !== 'decision') throw new Error('Missing gate');
  gate.config.maxPasses = 150;
  const loopId = await publishLoop(request, definition);
  const started = await request.post(`/loops/${loopId}/runs`, { data: {} });
  const run = RunRecordSchema.parse((await started.json()).run);
  await expect
    .poll(
      async () => RunRecordSchema.parse(await (await request.get(`/runs/${run.id}`)).json()).status,
      { timeout: 90_000 },
    )
    .toBe('succeeded');
  const record = RunRecordSchema.parse(await (await request.get(`/runs/${run.id}`)).json());
  expect(record.lastEventSeq).toBeGreaterThan(512);
  const current = ContextThreadSchema.parse(
    await (await request.get(`/runs/${run.id}/thread`)).json(),
  );
  await page.goto(`/app/runs/${run.id}`);
  const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
  const browserThread = async () => {
    const more = page.getByRole('button', { name: 'Show all of Full thread JSON' });
    if (await more.isVisible()) await more.click();
    return ContextThreadSchema.parse(JSON.parse(await page.getByTestId('thread-json').innerText()));
  };
  await expect(
    page.getByRole('heading', { name: `Timeline (${record.lastEventSeq} events, complete)` }),
  ).toBeVisible();
  await expect(timeline.getByRole('listitem')).toHaveCount(80);
  const last = timeline.getByRole('button').last();
  await last.focus();
  await page.keyboard.press('Home');
  await expect(timeline.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(timeline.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  const selected = Number(await timeline.getByRole('button').first().getAttribute('data-seq'));
  const exact = ContextThreadSchema.parse(
    await (await request.get(`/runs/${run.id}/thread?at=${selected}`)).json(),
  );
  await page.getByRole('button', { name: 'Full thread JSON' }).click();
  await expect.poll(browserThread).toEqual(exact);
  await page.getByRole('button', { name: 'Load older' }).click();
  await expect(timeline.getByRole('listitem')).toHaveCount(80);
  await page.getByRole('spinbutton', { name: 'Event sequence' }).fill('1');
  await page.getByRole('button', { name: 'Go to event' }).click();
  await expect(page.getByRole('heading', { name: 'Thread at event 1', exact: true })).toBeVisible();
  const firstPage = (await (
    await request.get(`/runs/${run.id}/events?around=1&limit=1`)
  ).json()) as { items: RunEvent[] };
  const first = firstPage.items[0];
  expect(first?.type).toBe('run.queued');
  if (first?.type !== 'run.queued' || !first.initialThread) throw new Error('Missing seed');
  if (!(await page.getByTestId('thread-json').isVisible()))
    await page.getByRole('button', { name: 'Full thread JSON' }).click();
  await expect.poll(browserThread).toEqual(first.initialThread);
  await page.reload();
  await expect(timeline.getByRole('button').first()).toContainText('#1');
  const cache = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('graphgoblin-run-events-v4') ?? '{}') as {
        state: { runs: Record<string, { lastSeq: number; events: unknown[]; bytes: number }> };
      },
  );
  expect(cache.state.runs[run.id]?.lastSeq).toBe(record.lastEventSeq);
  expect(cache.state.runs[run.id]?.events.length).toBeLessThanOrEqual(512);
  expect(cache.state.runs[run.id]?.bytes).toBeLessThanOrEqual(1_048_576);
  await page.getByRole('button', { name: 'Follow live' }).click();
  await expect(timeline.getByRole('button').last()).toContainText(`#${record.lastEventSeq}`);
  await timeline.hover();
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole('button', { name: 'Follow live' })).toBeEnabled();
  await page.getByRole('button', { name: 'Follow live' }).click();
  await expect(page.getByRole('button', { name: 'Follow live' })).toBeDisabled();
  await page.getByRole('button', { name: 'Full thread JSON' }).click();
  if (await page.getByRole('button', { name: 'Show all of Full thread JSON' }).isVisible())
    await page.getByRole('button', { name: 'Show all of Full thread JSON' }).click();
  await expect.poll(browserThread).toEqual(current);
});
