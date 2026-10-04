/**
 * Regression specs for the issue #7 QA pass (docs/qa/2026-10-04-issue-7-qa.md): reduced motion and
 * long text against the built app.
 */
import type { Page } from '@playwright/test';
import { control, expect, publishLoop, test } from './fixtures.js';

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

test('I7-QA-03: reduced motion stops the running and live pulses at full opacity', async ({
  page,
  request,
}) => {
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'SLOW PULSE', delayMs: 20_000 }],
  });
  const loopId = await publishLoop(request, slowLoop('qa reduced motion', 'SLOW PULSE'));
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
    expect((await motion(page)).animations).toEqual([]);
  } finally {
    await request.post(`/runs/${runId}/cancel`);
  }
});
