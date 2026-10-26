import { CURRENT_DEFINITION_FORMAT, RunRecordSchema } from '@graphgoblin/contracts';
import { LIVE_REFRESH_MS } from '../src/runs/live-refresh.js';
import { expect, publishLoop, test } from './fixtures.js';

/** A cycle that never ends by itself: Grow increments `vars.n`, an uncapped gate repeats. */
function endlessCycle(name: string) {
  const edge = (from: string, port: string, to: string) => ({
    id: `${from}-${port}-${to}`,
    from: { node: from, port },
    to: { node: to },
  });
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    settings: { maxNodeVisits: null },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'grow',
        kind: 'mutate',
        label: 'Grow',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/n',
              value: { kind: 'expression', jsonata: '($exists(vars.n) ? vars.n : 0) + 1' },
            },
          ],
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          maxPasses: null,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.n' } },
    ],
    edges: [
      edge('start', 'out', 'grow'),
      edge('grow', 'out', 'gate'),
      edge('gate', 'again', 'grow'),
      edge('gate', 'done', 'finish'),
      edge('gate', 'limit-reached', 'finish'),
    ],
  };
}

test('following a fast run live refreshes bounded read models and reads no historical thread (#186)', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, endlessCycle('Live follow'));
  const started = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const run = RunRecordSchema.parse((await started.json()).run);
  try {
    // Every read this page makes of the run, by route, with any `at` boundary.
    const reads: { route: string; at: string | null }[] = [];
    page.on('request', (sent) => {
      const url = new URL(sent.url());
      const prefix = `/runs/${run.id}`;
      if (!url.pathname.startsWith(prefix)) return;
      reads.push({ route: url.pathname.slice(prefix.length), at: url.searchParams.get('at') });
    });
    const lastEventSeq = async () =>
      RunRecordSchema.parse(await (await request.get(`/runs/${run.id}`)).json()).lastEventSeq;
    await page.goto(`/app/runs/${run.id}`);
    await expect(
      page.getByRole('heading', { name: /^Timeline \(\d+ events, live\)$/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Current thread' })).toBeVisible();

    // A window of live following: the run keeps appending completions throughout.
    const from = await lastEventSeq();
    const begin = Date.now();
    const mark = reads.length;
    await page.waitForTimeout(5_000);
    const window = reads.slice(mark);
    const elapsed = Date.now() - begin;
    const to = await lastEventSeq();
    const counts = Object.fromEntries(
      ['', '/observation', '/thread', '/events'].map((route) => [
        `GET /runs/{id}${route}`,
        window.filter((read) => read.route === route).length,
      ]),
    );
    console.log(
      `Followed live for ${elapsed} ms while the run advanced from event ${from} to ${to}: ${JSON.stringify(counts)}, ${window.filter((read) => read.at !== null).length} thread?at reads`,
    );
    expect(to).toBeGreaterThan(from);
    expect(window.filter((read) => read.at !== null)).toEqual([]);
    // At most one refresh starts per interval, one at the window's start and one whose request
    // was reported at its boundary; a slower machine starts fewer.
    const bound = Math.floor(elapsed / LIVE_REFRESH_MS) + 2;
    for (const route of ['', '/observation', '/thread']) {
      const count = window.filter((read) => read.route === route).length;
      expect(count, `GET /runs/{id}${route}`).toBeGreaterThan(0);
      expect(count, `GET /runs/{id}${route}`).toBeLessThanOrEqual(bound);
    }
    await expect(page.getByRole('heading', { name: 'Current thread' })).toBeVisible();

    // Selecting a completion reads exactly its thread and the one before it, for the diff.
    const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
    await timeline
      .getByRole('button', { name: /node\.finished Grow \(grow\)/ })
      .last()
      .click();
    const heading = page.getByRole('heading', { name: /^Thread at event \d+$/ });
    await expect(heading).toBeVisible();
    const selected = Number(/\d+/.exec((await heading.textContent()) ?? '')?.[0]);
    await expect(page.getByRole('list', { name: 'Patch diff' })).toContainText('/vars/n');
    const boundaries = () =>
      reads
        .filter((read) => read.at !== null)
        .map((read) => Number(read.at))
        .sort((a, b) => a - b);
    expect(boundaries()).toEqual([selected - 1, selected]);

    // Following live again shows the current thread and reads no further boundaries.
    await page.getByRole('button', { name: 'Follow live' }).click();
    await expect(page.getByRole('heading', { name: 'Current thread' })).toBeVisible();
    const resumed = await lastEventSeq();
    await expect.poll(lastEventSeq).toBeGreaterThan(resumed);
    expect(boundaries()).toEqual([selected - 1, selected]);
  } finally {
    await request.post(`/runs/${run.id}/cancel`);
  }
});

test('following live stays quiet for screen readers and keyboard focus can always leave (#186 QA)', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, endlessCycle('Live follow accessibility'));
  const started = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const run = RunRecordSchema.parse((await started.json()).run);
  try {
    await page.goto(`/app/runs/${run.id}`);
    const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
    await expect(timeline.getByRole('button').last()).toBeVisible();
    // The announcement while following does not change as events stream in.
    const announcement = page.getByText('Following live.', { exact: true });
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await announcement.evaluate((node) => {
      const changes = { count: 0 };
      new MutationObserver((records) => (changes.count += records.length)).observe(node, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      Object.assign(window, { liveAnnouncementChanges: changes });
    });
    const rows = await page
      .getByText(/^Showing events \d+–\d+ of the retained window\.$/)
      .textContent();
    await page.waitForTimeout(3_000);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { liveAnnouncementChanges: { count: number } })
            .liveAnnouncementChanges.count,
      ),
    ).toBe(0);
    // The visible window text kept following the tail meanwhile.
    await expect(
      page.getByText(/^Showing events \d+–\d+ of the retained window\.$/),
    ).not.toHaveText(rows ?? '');

    // Focusing a row pauses following and says so; Shift+Tab leaves the rows at once.
    await timeline.getByRole('button').last().focus();
    await expect(page.getByText(/^Following paused\. Showing events/)).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Go to event' })).toBeFocused();

    // Follow live from the keyboard keeps focus on the control.
    const follow = page.getByRole('button', { name: 'Follow live' });
    await follow.focus();
    await page.keyboard.press('Enter');
    await expect(follow).toHaveAttribute('aria-disabled', 'true');
    await expect(follow).toBeFocused();
    await expect(page.getByText('Following live.', { exact: true })).toBeAttached();
  } finally {
    await request.post(`/runs/${run.id}/cancel`);
  }
});
