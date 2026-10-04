/**
 * Regression specs for the issue #7 QA pass (docs/qa/2026-10-04-issue-7-qa.md): reduced motion and
 * long text against the built app.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, control, expect, publishLoop, test } from './fixtures.js';

const start = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };
const done = { id: 'done', kind: 'exit', label: 'Done', config: {} };

/** A loop whose one inference turn takes as long as the harness script says. */
function slowLoop(name: string, prompt: string) {
  return {
    schemaVersion: 1,
    name,
    nodes: [
      start,
      { id: 'ask', kind: 'inference', label: 'Ask', config: { prompt: { template: prompt } } },
      done,
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'e2', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/** Every running animation's name, and how each pulsing element is drawn right now. */
function motion(page: Page) {
  return page.evaluate(() => ({
    animations: document
      .getAnimations()
      .map((a) => (a instanceof CSSAnimation ? a.animationName : a.constructor.name)),
    pulses: [...document.querySelectorAll('.animate-pulse-soft')].map((el) => {
      const style = getComputedStyle(el);
      return { name: style.animationName, opacity: style.opacity };
    }),
    transitions: [...document.querySelectorAll('button')].flatMap((el) =>
      getComputedStyle(el)
        .transitionDuration.split(',')
        .map((d) => parseFloat(d)),
    ),
  }));
}

/**
 * A turn the fake harness never finishes on its own: the longest delay setTimeout accepts (about
 * 24.8 days; anything longer would fire at once). The run stays running until the test cancels it,
 * which aborts the turn.
 */
const HELD_UNTIL_CANCELLED = 2 ** 31 - 1;

const runStatus = async (request: APIRequestContext, runId: string) =>
  ((await (await request.get(`/runs/${runId}`)).json()) as { status: string }).status;

test('I7-QA-03: reduced motion stops the running and live pulses at full opacity', async ({
  page,
  request,
}) => {
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'HELD PULSE', delayMs: HELD_UNTIL_CANCELLED }],
  });
  const loopId = await publishLoop(request, slowLoop('qa reduced motion', 'HELD PULSE'));
  const res = await request.post(`/loops/${loopId}/runs`, { data: {} });
  const runId = ((await res.json()) as { run: { id: string } }).run.id;
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/app/runs/${runId}`);
    await expect(page.locator('[data-status="running"]').first()).toBeVisible();
    await expect(page.getByText(/events, live/)).toBeVisible();
    // With motion allowed the glyph and the live dot pulse, so the measurement sees them.
    const moving = await motion(page);
    expect(moving.pulses.length).toBeGreaterThanOrEqual(2);
    expect(moving.animations).toContain('gg-pulse');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => (await motion(page)).animations).toEqual([]);
    const still = await motion(page);
    expect(still.pulses.length).toBeGreaterThanOrEqual(2);
    for (const pulse of still.pulses) expect(pulse).toEqual({ name: 'none', opacity: '1' });
    // Transitions stay collapsed to an instant change.
    expect(still.transitions.length).toBeGreaterThan(0);
    for (const seconds of still.transitions) expect(seconds).toBeLessThanOrEqual(0.00001);

    // A fresh load under reduced motion never starts the pulse at all.
    await page.reload();
    await expect(page.locator('[data-status="running"]').first()).toBeVisible();
    await expect(page.getByText(/events, live/)).toBeVisible();
    const reloaded = await motion(page);
    expect(reloaded.pulses.length).toBeGreaterThanOrEqual(2);
    expect(reloaded.animations).toEqual([]);
    // Every assertion above saw a run that was still running: the harness held it.
    expect(await runStatus(request, runId)).toBe('running');
  } finally {
    // Release the held turn; the run ends now rather than in 24 days.
    await request.post(`/runs/${runId}/cancel`);
    await expect.poll(() => runStatus(request, runId)).toBe('cancelled');
  }
});

const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('I7-QA-01: the longest valid loop name stays inside the editor toolbar and the lists', async ({
  page,
  request,
}) => {
  const name = 'W'.repeat(120);
  const loopId = await publishLoop(request, approvalLoop(name));
  await request.post(`/loops/${loopId}/runs`, { data: {} });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/app/loops/${loopId}/edit`);
    const heading = page.getByRole('heading', { level: 1, name });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute('title', name);
    // Cut short with an ellipsis, inside the page, with every action still on screen.
    expect(await heading.evaluate((h) => h.scrollWidth > h.clientWidth)).toBe(true);
    expect(await pageOverflows(page), `editor at ${viewport.width}`).toBe(false);
    for (const action of ['Loop settings', 'Run', 'Publish']) {
      await expect(page.getByRole('button', { name: action, exact: true })).toBeInViewport();
    }
    for (const path of ['/app/loops', '/app/runs']) {
      await page.goto(path);
      await expect(page.locator('td', { hasText: name }).first()).toBeVisible();
      expect(await pageOverflows(page), `${path} at ${viewport.width}`).toBe(false);
    }
  }
});

test('I7-QA-02: overlong text stays inside Alert, Badge, and Button', async ({ page, request }) => {
  const word = 'W'.repeat(350);
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'LONG FAILURE', error: { code: 'TURN_FAILED', message: word } }],
  });
  const loopId = await publishLoop(request, slowLoop('qa long text', 'LONG FAILURE'));
  const res = await request.post(`/loops/${loopId}/runs`, { data: {} });
  const runId = ((await res.json()) as { run: { id: string } }).run.id;

  // Alert: a real failure whose message is one 350-character word.
  await page.goto(`/app/runs/${runId}`);
  const alert = page.getByRole('alert').filter({ hasText: 'Failed: HARNESS_TURN_FAILED' });
  await expect(alert).toContainText(word);
  expect(await alert.evaluate((a) => a.scrollWidth <= a.clientWidth)).toBe(true);
  expect(await pageOverflows(page)).toBe(false);

  // Badge and Button: the editor's own, copied into the side panel with overlong labels.
  await page.goto(`/app/loops/${loopId}/edit`);
  const panel = page.getByRole('region', { name: 'Validation' });
  await expect(panel).toBeVisible();
  const fits = await panel.evaluate((region) => {
    const copy = (selector: string, text: string) =>
      [...document.querySelectorAll(selector)]
        .find((el) => el.textContent === text)!
        .cloneNode(true) as HTMLElement;
    const badge = copy('span.rounded-full', 'published v1');
    const button = copy('button', 'Loop settings');
    badge.lastElementChild!.textContent = 'long badge '.repeat(45);
    button.lastElementChild!.textContent = 'long action '.repeat(45);
    region.append(badge, button);
    const edge = region.getBoundingClientRect().right;
    return [badge, button].map((el) => {
      const label = el.lastElementChild!;
      return {
        inside: el.getBoundingClientRect().right <= edge + 0.5,
        cutShort: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
      };
    });
  });
  for (const element of fits) {
    expect(element).toEqual({ inside: true, cutShort: true, ellipsis: 'ellipsis' });
  }
  expect(await pageOverflows(page)).toBe(false);
});
