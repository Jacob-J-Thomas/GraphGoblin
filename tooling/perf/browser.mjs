/* global performance, window, PerformanceObserver, requestAnimationFrame, document, sessionStorage, process, setInterval, clearInterval */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dependency, sleep, json } from './common.mjs';

export async function measureBrowser({ base, runId, output, durationMs, warmupPass, call }) {
  const waiting = performance.now();
  for (;;) {
    const thread = await json(base, '/runs/' + runId + '/thread');
    if ((thread.vars.history?.length ?? 0) >= warmupPass) break;
    if (performance.now() - waiting > 600_000) throw new Error('Browser history warmup timed out');
    await sleep(1000);
  }
  const warmupMs = performance.now() - waiting;
  const { chromium } = await dependency('@playwright/test', 'web');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = {
    browser: browser.version(),
    channel: 'msedge',
    headless: true,
    shellDefinition:
      'navigation start to visible heading and actionable link or Events state, then two animation frames',
    historyDefinition:
      'navigation start until acknowledgement and rendered Timeline tail reach the pre-navigation server cursor',
    sampleIntervalMs: 250,
    processIds: [],
    pages: [],
  };
  const browserSession = await browser.newBrowserCDPSession();
  const recordProcesses = async () => {
    const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
    results.processIds = [...new Set([...results.processIds, ...processInfo.map((p) => p.id)])];
  };
  try {
    await recordProcesses();
    results.warmup = { passes: warmupPass, wallMs: warmupMs };
    results.inbound = { events: 50, payloadValueBytes: 32_768 };
    // Independent contexts avoid carrying inspector event logs into the Events-page heap.
    for (const [name, path] of [
      ['events-empty', '/app/events'],
      ['inspector', '/app/runs/' + runId],
      ['events', '/app/events'],
    ]) {
      if (name === 'events') {
        for (let index = 0; index < 50; index++)
          await json(base, '/events', {
            type: 'perf.measurement',
            payload: { index, nested: { value: 'v'.repeat(32_768) } },
          });
      }
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__perf = { longTasks: [], started: performance.now() };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            window.__perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }).observe({ type: 'longtask', buffered: true });
      });
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      const beforeRun = await json(base, '/runs/' + runId);
      const began = performance.now();
      await page.goto(base + path, { waitUntil: 'domcontentloaded' });
      const metrics = [];
      let inFlight;
      const metricErrors = [];
      const collect = async () => {
        const at = performance.now();
        const probe = await page.evaluate(() => ({
          entries: window.__perf.longTasks,
          nodes: document.querySelectorAll('*').length,
          timelineItems: document.querySelector('ol[aria-label="Timeline"]')?.children.length ?? 0,
          timelineNodes:
            document.querySelector('ol[aria-label="Timeline"]')?.querySelectorAll('*').length ?? 0,
          sessionStorageBytes: Object.values(sessionStorage).reduce(
            (sum, value) => sum + value.length * 2,
            0,
          ),
          heap: performance.memory
            ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
            : null,
        }));
        const cdp = await session.send('Performance.getMetrics');
        metrics.push({
          elapsedMs: performance.now() - began,
          evaluateRoundTripMs: performance.now() - at,
          ...probe,
          cdp: Object.fromEntries(cdp.metrics.map(({ name, value }) => [name, value])),
        });
      };
      const tick = () => {
        if (!inFlight)
          inFlight = collect()
            .catch((error) => metricErrors.push(error.message))
            .finally(() => {
              inFlight = undefined;
            });
      };
      const timer = setInterval(tick, 250);
      tick();
      let shellReadyMs,
        firstRowsMs = null,
        historyReadyMs = null,
        historyReadyCount = null;
      const observedMs = name === 'events-empty' ? Math.min(1000, durationMs) : durationMs;
      try {
        await page.getByRole('heading', { level: 1 }).waitFor();
        if (name === 'inspector')
          await page.getByRole('link', { name: 'loop', exact: true }).click({ trial: true });
        else if (name === 'events-empty')
          await page.getByText('No inbound events yet.', { exact: true }).waitFor();
        else await page.getByRole('table').waitFor();
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        shellReadyMs = performance.now() - began;
        if (name === 'inspector') {
          await page
            .getByRole('list', { name: 'Timeline', exact: true })
            .getByRole('listitem')
            .first()
            .waitFor();
          firstRowsMs = performance.now() - began;
          await page.waitForFunction((target) => {
            const count = document.querySelector('ol[aria-label="Timeline"]')?.children.length ?? 0;
            const heading = [...document.querySelectorAll('h1,h2,h3')]
              .map((h) => h.textContent)
              .find((text) => /^Timeline \(/.test(text ?? ''));
            const reported = Number(/^Timeline \((\d+) events/.exec(heading ?? '')?.[1] ?? 0);
            const buttons = [...document.querySelectorAll('ol[aria-label="Timeline"] button')];
            const last = buttons.at(-1);
            const renderedTail = Number(
              last?.getAttribute('data-seq') ??
                last?.querySelector('span')?.textContent?.replace('#', '') ??
                0,
            );
            return Math.max(count, reported) >= target && renderedTail >= target;
          }, beforeRun.lastEventSeq);
          historyReadyMs = performance.now() - began;
          historyReadyCount = await page
            .getByRole('list', { name: 'Timeline', exact: true })
            .getByRole('listitem')
            .count();
        }
        await sleep(observedMs);
      } finally {
        clearInterval(timer);
        await inFlight;
      }
      await collect();
      if (metricErrors.length)
        throw new Error('Browser metric sampling failed: ' + metricErrors.join('; '));
      const screenshot = join(output, 'browser-' + name + '.png');
      await page.screenshot({ path: screenshot });
      const afterRun = await json(base, '/runs/' + runId);
      const result = {
        name,
        path,
        shellReadyMs,
        firstRowsMs,
        historyReadyMs,
        historyTargetSeq: name === 'inspector' ? beforeRun.lastEventSeq : null,
        historyReadyCount,
        durationMs: observedMs,
        executionContinued:
          beforeRun.status === 'running' && afterRun.lastEventSeq > beforeRun.lastEventSeq,
        runningThroughout: beforeRun.status === 'running' && afterRun.status === 'running',
        beforeRun,
        afterRun,
        metrics,
        errors,
        screenshot,
        serverMemory: await call('memory'),
      };
      results.pages.push(result);
      await context.close();
    }
  } finally {
    try {
      await recordProcesses();
    } finally {
      await browser.close();
    }
  }
  await writeFile(join(output, 'browser.json'), JSON.stringify(results, null, 2));
  process.stderr.write('PERF_BROWSER complete\n');
  return results;
}
