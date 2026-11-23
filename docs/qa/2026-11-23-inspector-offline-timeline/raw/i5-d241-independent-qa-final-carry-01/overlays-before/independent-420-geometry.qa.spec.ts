import {
  ContextThreadSchema,
  RunEventSchema,
  RunRecordSchema,
  RunSnapshotSchema,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page, Route } from '@playwright/test';
import { approvalLoop, expect, publishLoop, test, uniqueLoopName } from './fixtures.js';
import {
  boundCandidate,
  createOwnedInstance,
  recordOwnedRequests,
  requireOwnedLoopback,
} from './independent-416-420-helpers.js';
import {
  enlargeTimelineText,
  expectActualTextGrowth,
  measureTimelineRow,
} from './independent-420-geometry.js';

const SEQUENCES = [10593, 123456, 123456789012345] as const;
async function controlledRows(page: Page, request: APIRequestContext) {
  boundCandidate();
  const instance = await createOwnedInstance(request);
  const origin = requireOwnedLoopback(instance.url).origin;
  const loop = await publishLoop(
    request,
    approvalLoop(uniqueLoopName('Independent geometry')),
    origin,
  );
  const started = await request.post(`${origin}/loops/${loop}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const run = RunRecordSchema.parse((await started.json()).run);
  const path = `/runs/${run.id}`;
  await expect
    .poll(
      async () => RunSnapshotSchema.parse(await (await request.get(origin + path)).json()).status,
    )
    .toBe('waiting');
  const actual = (await (await request.get(origin + path + '/events?limit=128')).json()) as {
    items: unknown[];
  };
  const native = actual.items.map((value) => RunEventSchema.parse(value));
  const node = native.find((value) => value.type === 'node.started');
  const queued = native.find((value) => value.type === 'run.queued');
  const running = native.find((value) => value.type === 'run.started');
  if (!node || !queued || !running)
    throw new Error('Actual owned run must supply complete schema-valid event prototypes');
  const events = [
    RunEventSchema.parse({ ...queued, seq: 1 }),
    RunEventSchema.parse({ ...running, seq: 2 }),
    ...SEQUENCES.map((seq) => RunEventSchema.parse({ ...node, seq })),
  ];
  const current = ContextThreadSchema.parse(
    await (await request.get(origin + path + '/thread')).json(),
  );
  const match = (url: URL) =>
    url.origin === origin &&
    (url.pathname === path + '/events' ||
      (url.pathname === path + '/thread' && url.searchParams.has('at')));
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/thread')) {
      await route.fulfill({ json: current });
      return;
    }
    if ((route.request().headers()['accept'] ?? '').includes('text/event-stream')) {
      const frames = events
        .map(
          (value) => `id: ${value.seq}\nevent: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`,
        )
        .join('');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          frames + `event: stream.complete\ndata: ${JSON.stringify({ after: SEQUENCES[2] })}\n\n`,
      });
    } else {
      const after = Number(url.searchParams.get('after') ?? 0);
      const around = url.searchParams.get('around');
      const items =
        around === null
          ? events.filter((value) => value.seq > after)
          : events.filter((value) => value.seq <= Number(around));
      await route.fulfill({
        json: {
          items,
          nextAfter: items.at(-1)?.seq ?? after,
          hasMore: false,
          olderCursor: null,
          newerCursor: null,
        },
      });
    }
  };
  await page.route(match, handler);
  const log = recordOwnedRequests(page, origin);
  await page.goto(`${origin}/app${path}`);
  await expect(page.locator(`[data-seq="${SEQUENCES[2]}"]`)).toBeVisible();
  return {
    origin,
    runId: run.id,
    eventType: node.type,
    events,
    log,
    close: async () => {
      await page.unroute(match, handler);
      log.stop();
    },
  };
}

test('G1: real built Timeline geometry at1440/320 and actual CSS200% page text for5/6/15digits', async ({
  page,
  request,
}, info) => {
  const fixture = await controlledRows(page, request);
  const measurements: unknown[] = [];
  try {
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const normal = new Map<number, Awaited<ReturnType<typeof measureTimelineRow>>>();
      for (const seq of SEQUENCES) {
        const value = await measureTimelineRow(page, seq, fixture.eventType);
        normal.set(seq, value);
        measurements.push({ width, textScale: 1, ...value });
      }
      const restore = await enlargeTimelineText(page, 2);
      try {
        for (const seq of SEQUENCES) {
          const enlarged = await measureTimelineRow(page, seq, fixture.eventType);
          const baseline = normal.get(seq);
          if (!baseline) throw new Error('Missing baseline measurement');
          expectActualTextGrowth(baseline, enlarged);
          measurements.push({ width, textScale: 2, ...enlarged });
        }
      } finally {
        await restore();
      }
    }
    expect(measurements).toHaveLength(12);
    await info.attach('real-geometry-matrix', {
      body: JSON.stringify({
        evidence:
          'Actual built DOM/fonts/text ranges; explicitly controlled schema-valid event sequences and selected-thread responses over owned real API. Not generated fifteen-digit server history. CSS text enlargement of existing whole-page elements, not browser zoom/deviceScaleFactor.',
        measurements,
        controlledEvents: fixture.events,
        requests: fixture.log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.close();
  }
});

test('G2: same-window Home/End, arrows, one Tab stop, selection and Follow live use real browser focus', async ({
  page,
  request,
}, info) => {
  const fixture = await controlledRows(page, request);
  try {
    const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
    const rows = timeline.getByRole('button');
    await expect(rows).toHaveCount(5);
    await expect(timeline.locator('button[tabindex="0"]')).toHaveCount(1);
    const first = rows.first();
    const last = rows.last();
    await last.focus();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    // This second Home stays in the same retained window and must still focus the first row.
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(last).toBeFocused();
    await expect(last).toHaveAccessibleName(
      new RegExp(`#${SEQUENCES[2]}.*${fixture.eventType.replace('.', '\\.')}`),
    );
    const before = fixture.log.rows.filter((row) => row.path.includes('/thread?at=')).length;
    expect(before).toBe(0);
    await page.keyboard.press('Enter');
    await expect(last).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('heading', { name: `Thread at event ${SEQUENCES[2]}`, exact: true }),
    ).toBeVisible();
    expect(fixture.log.rows.filter((row) => row.path.includes('/thread?at=')).length).toBe(1);
    await expect(timeline.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    expect(await timeline.evaluate((element) => element.contains(document.activeElement))).toBe(
      false,
    );
    await page.getByRole('button', { name: 'Follow live', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Current thread', exact: true })).toBeVisible();
    await info.attach('native-keyboard-control', {
      body: JSON.stringify({
        evidence:
          'Real browser focus over schema-valid controlled geometry rows; native full-history budgets are the separate byte-identical bounded-history.spec.ts selection',
        requests: fixture.log.rows,
      }),
      contentType: 'application/json',
    });
  } finally {
    await fixture.close();
  }
});
