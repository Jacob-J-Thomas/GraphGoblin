import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, control, expect, publishLoop, test, uniqueLoopName } from './fixtures.js';

const STALE = 'Last observed, may be out of date';

async function runStatus(request: APIRequestContext, runId: string, base = ''): Promise<string> {
  const response = await request.get(`${base}/runs/${runId}`);
  return ((await response.json()) as { status: string }).status;
}

test('a waiting run stays last observed through a refused API listener, sends nothing, then recovers (#416)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const loopId = await publishLoop(request, approvalLoop(uniqueLoopName('Outage approval')));
  const started = await request.post(`/loops/${loopId}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  expect(started.ok()).toBe(true);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect.poll(() => runStatus(request, run.id), { timeout: 30_000 }).toBe('waiting');
  // Every write the page attempts against runs, whether or not the listener answers it.
  const writes: string[] = [];
  page.on('request', (sent) => {
    const path = new URL(sent.url()).pathname;
    if (sent.method() === 'GET' || !path.startsWith('/runs')) return;
    writes.push(`${sent.method()} ${path}`);
  });
  await page.goto(`/app/runs/${run.id}`);
  const heading = page.getByRole('heading', { name: `Run ${run.id}` });
  const answer = page.getByLabel('Input (JSON)');
  const submit = page.getByRole('button', { name: 'Submit input' });
  await expect(heading).toBeVisible();
  await answer.fill('{"approved":true}');
  await expect(submit).toBeEnabled();

  await control(request, '/api/listener', { listening: false });
  try {
    await expect(page.getByText(STALE, { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(heading).toBeVisible();
    await expect(page.getByText('Input requested')).toBeVisible();
    await expect(answer).toHaveValue('{"approved":true}');
    for (const locked of [
      submit,
      page.getByRole('button', { name: /Pause/ }),
      page.getByRole('button', { name: /Cancel run/ }),
      page.getByRole('button', { name: 'Replay...' }),
      page.getByRole('button', { name: 'Review delete-ready history' }),
    ]) {
      await expect(locked).toBeDisabled();
    }
    // Implicit (keyboard-equivalent) submission of the answer form also sends nothing.
    await page
      .getByRole('form', { name: 'Submit input' })
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(writes).toEqual([]);
  } finally {
    await control(request, '/api/listener', { listening: true });
  }

  // Health or the browser being online is not enough: the run read after the outage unlocks.
  await expect(page.getByText(STALE, { exact: true })).toBeHidden({ timeout: 45_000 });
  await expect(submit).toBeEnabled();
  await expect(answer).toHaveValue('{"approved":true}');
  expect(writes).toEqual([]);
  await submit.click();
  await expect.poll(() => writes).toEqual([`POST /runs/${run.id}/input`]);
  await expect.poll(() => runStatus(request, run.id), { timeout: 30_000 }).toBe('succeeded');
});

test('a run read begun before the stream loses the listener cannot make the run current (#575)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // An isolated API, so only this test's page loses its listener.
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const loopId = await publishLoop(request, approvalLoop(uniqueLoopName('Outage race')), url);
  const started = await request.post(`${url}/loops/${loopId}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  expect(started.ok()).toBe(true);
  const { run } = (await started.json()) as { run: { id: string } };
  const status = () => runStatus(request, run.id, url);
  await expect.poll(status, { timeout: 30_000 }).toBe('waiting');
  const writes: string[] = [];
  page.on('request', (sent) => {
    const path = new URL(sent.url()).pathname;
    if (sent.method() === 'GET' || !path.startsWith('/runs')) return;
    writes.push(`${sent.method()} ${path}`);
  });
  // Once armed, the next run read is answered by the running listener at once and that answer is
  // held from the page until released. Every run read is counted.
  const barrier = { armed: false, answered: false, reads: 0 };
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (target) => target.pathname === `/runs/${run.id}`,
    async (route) => {
      if (route.request().method() === 'GET') barrier.reads += 1;
      if (route.request().method() !== 'GET' || !barrier.armed) {
        await route.continue();
        return;
      }
      barrier.armed = false;
      const response = await route.fetch();
      barrier.answered = true;
      await released;
      await route.fulfill({ response });
    },
  );
  try {
    await page.goto(`${url}/app/runs/${run.id}`);
    const heading = page.getByRole('heading', { name: `Run ${run.id}` });
    const answer = page.getByLabel('Input (JSON)');
    const submit = page.getByRole('button', { name: 'Submit input' });
    const timeline = (status: string) =>
      page.getByRole('heading', { name: new RegExp(`^Timeline \\(\\d+ events, ${status}\\)`) });
    const locked = [
      submit,
      page.getByRole('button', { name: /Pause/ }),
      page.getByRole('button', { name: /Cancel run/ }),
      page.getByRole('button', { name: 'Replay...' }),
      page.getByRole('button', { name: 'Review delete-ready history' }),
    ];
    // Implicit (keyboard-equivalent) submission of the answer form, then two frames.
    const submitImplicitly = async () => {
      await page
        .getByRole('form', { name: 'Submit input' })
        .evaluate((form) => (form as HTMLFormElement).requestSubmit());
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    };
    await expect(heading).toBeVisible();
    await expect(timeline('live')).toBeVisible();
    await answer.fill('{"approved":true}');
    await expect(submit).toBeEnabled();

    // The tab becoming visible again reads the run once it is stale, as returning to it does.
    barrier.armed = true;
    await expect
      .poll(
        async () => {
          if (!barrier.answered)
            await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
          return barrier.answered;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const held = barrier.reads;

    await control(request, '/api/listener', { instanceId, listening: false });
    try {
      // The stream reports the transport loss while the earlier read is still held.
      await expect(timeline('connecting…')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(STALE, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      await expect(heading).toBeVisible();
      await expect(page.getByText('Input requested')).toBeVisible();
      await expect(answer).toHaveValue('{"approved":true}');
      for (const writer of locked) await expect(writer).toBeDisabled();
      await submitImplicitly();
      expect(writes).toEqual([]);
      // The read in flight was joined rather than replaced.
      expect(barrier.reads).toBe(held);

      // The earlier read now returns its successful answer. Once it settles, the run is read
      // again, which the stopped listener refuses; the run stays last observed.
      release();
      await expect.poll(() => barrier.reads, { timeout: 20_000 }).toBeGreaterThan(held);
      await expect(page.getByText(STALE, { exact: true })).toBeVisible();
      for (const writer of locked) await expect(writer).toBeDisabled();
      await expect(answer).toHaveValue('{"approved":true}');
      await submitImplicitly();
      expect(writes).toEqual([]);
    } finally {
      release();
      await control(request, '/api/listener', { instanceId, listening: true });
    }

    // Only a run read that started after the loss unlocks, keeping the typed answer.
    await expect(page.getByText(STALE, { exact: true })).toBeHidden({ timeout: 45_000 });
    await expect(submit).toBeEnabled();
    await expect(answer).toHaveValue('{"approved":true}');
    expect(writes).toEqual([]);
    await submit.click();
    await expect.poll(() => writes).toEqual([`POST /runs/${run.id}/input`]);
    await expect.poll(status, { timeout: 30_000 }).toBe('succeeded');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

/** Contract-valid events with five, six, eleven and sixteen digit sequences. */
function longSequences(runId: string) {
  const ts = new Date().toISOString();
  return [
    { runId, seq: 10_593, ts, type: 'run.started', attempt: 1 },
    { runId, seq: 123_456, ts, type: 'iteration.incremented', from: 1, to: 2, targetNodeId: 'n' },
    { runId, seq: 12_345_678_901, ts, type: 'return.delivered', channel: { kind: 'log' } },
    {
      runId,
      seq: Number.MAX_SAFE_INTEGER,
      ts,
      type: 'run.finished',
      status: 'succeeded',
      outcome: 'success',
    },
  ];
}

/** Serve the run's history and live tail from `events` only, as the API's SSE frames would. */
async function serveEvents(page: Page, runId: string, events: { seq: number; type: string }[]) {
  const last = events.at(-1)!.seq;
  await page.route(
    (url) => url.pathname === `/runs/${runId}/events`,
    async (route) => {
      const after = Number(new URL(route.request().url()).searchParams.get('after') ?? 0);
      const items = events.filter((item) => item.seq > after);
      if (route.request().headers()['accept'] === 'text/event-stream') {
        const frame = (item: { seq: number; type: string }) =>
          `id: ${item.seq}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`;
        const frames = items.map(frame).join('');
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: `${frames}event: stream.complete\ndata: ${JSON.stringify({ after: last })}\n\n`,
        });
      } else {
        await route.fulfill({
          json: { items, nextAfter: last, hasMore: false, olderCursor: null, newerCursor: null },
        });
      }
    },
  );
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Real text ranges of every Timeline row, and the card's narrowest possible width. */
function measureTimeline(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Timeline"]');
    const title = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(
      (heading) => heading.textContent?.startsWith('Timeline ('),
    );
    if (!(list instanceof HTMLOListElement) || !title) throw new Error('no Timeline');
    const box = ({ left, right, top, bottom }: DOMRect) => ({ left, right, top, bottom });
    const text = (element: Element | undefined) => {
      if (!element) return [];
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].filter((rect) => rect.width > 0).map(box);
    };
    // The Timeline card: the nearest ancestor of the rows that also holds its title.
    let card: HTMLElement = list;
    while (card.parentElement && !card.contains(title)) card = card.parentElement;
    const width = card.style.width;
    card.style.width = 'min-content';
    const minContent = card.getBoundingClientRect().width;
    card.style.width = width;
    return {
      viewport: document.documentElement.clientWidth,
      minContent,
      list: { ...box(list.getBoundingClientRect()), overflow: list.scrollWidth - list.clientWidth },
      rows: [...list.querySelectorAll('button[data-seq]')].map((row) => {
        const [seq, type, description] = [...row.children];
        return {
          dataSeq: row.getAttribute('data-seq'),
          seqText: seq?.textContent ?? '',
          typeText: type?.textContent ?? '',
          fontSize: seq ? parseFloat(getComputedStyle(seq).fontSize) : 0,
          row: box(row.getBoundingClientRect()),
          seq: text(seq),
          type: text(type),
          description: text(description),
          clipped: [seq, type].some(
            (part) => part instanceof HTMLElement && part.scrollWidth > part.clientWidth + 1,
          ),
        };
      }),
    };
  });
}

const overlap = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/** Text enlargement, not device scaling: rem-sized text doubles and the layout reflows. */
async function enlargeText(page: Page, baseline: number) {
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect
    .poll(async () => (await measureTimeline(page)).rows[0]?.fontSize)
    .toBeGreaterThanOrEqual(1.9 * baseline);
}

for (const layout of [
  { name: '1440px', width: 1440, enlarged: false },
  { name: '320px', width: 320, enlarged: false },
  { name: '320px with 200% text', width: 320, enlarged: true },
]) {
  test(`Timeline rows keep long sequences and types whole at ${layout.name} (#420)`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const loopId = await publishLoop(request, {
      ...minimalLoop(),
      name: uniqueLoopName('Long sequences'),
    });
    const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
    expect(started.status()).toBe(202);
    const { run } = (await started.json()) as { run: { id: string } };
    await expect.poll(() => runStatus(request, run.id), { timeout: 30_000 }).toBe('succeeded');
    const events = longSequences(run.id);
    await serveEvents(page, run.id, events);
    await page.setViewportSize({ width: layout.width, height: 900 });
    try {
      await page.goto(`/app/runs/${run.id}`);
      const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
      await expect(timeline.getByRole('button')).toHaveCount(events.length);
      const before = await measureTimeline(page);
      if (layout.enlarged) await enlargeText(page, before.rows[0]!.fontSize);
      const metrics = await measureTimeline(page);
      // Enlarged text may still widen the page through other sections (the run ID heading); the
      // Timeline's own bound is then its card's narrowest width, checked below.
      const pageBound = layout.enlarged ? Number.POSITIVE_INFINITY : metrics.viewport + 0.5;
      expect(metrics.rows.map((row) => row.dataSeq)).toEqual(events.map(({ seq }) => `${seq}`));
      expect(metrics.list.overflow).toBeLessThanOrEqual(0);
      // The card's narrowest layout fits the viewport: no number or type forces it wider.
      expect(metrics.minContent).toBeLessThanOrEqual(metrics.viewport);
      for (const [index, row] of metrics.rows.entries()) {
        expect(row.seqText).toBe(`#${events[index]!.seq}`);
        expect(row.typeText).toBe(events[index]!.type);
        expect(row.clipped).toBe(false);
        expect(row.row.left).toBeGreaterThanOrEqual(metrics.list.left - 0.5);
        expect(row.row.right).toBeLessThanOrEqual(metrics.list.right + 0.5);
        for (const rect of [...row.seq, ...row.type, ...row.description]) {
          expect(rect.left).toBeGreaterThanOrEqual(row.row.left - 0.5);
          expect(rect.right).toBeLessThanOrEqual(row.row.right + 0.5);
          expect(rect.right).toBeLessThanOrEqual(pageBound);
        }
        for (const a of row.seq) {
          for (const b of [...row.type, ...row.description]) expect(overlap(a, b)).toBe(false);
        }
        for (const a of row.type) {
          for (const b of row.description) expect(overlap(a, b)).toBe(false);
        }
      }
      // Keyboard movement and the single Tab stop still work across the long sequences.
      const rows = timeline.getByRole('button');
      await rows.last().focus();
      await page.keyboard.press('Home');
      await expect(rows.first()).toBeFocused();
      await page.keyboard.press('End');
      await expect(rows.last()).toBeFocused();
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}
