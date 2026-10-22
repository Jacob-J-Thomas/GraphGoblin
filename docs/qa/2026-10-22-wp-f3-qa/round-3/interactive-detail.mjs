// The two historical inspector gaps are observations outside #243, per dispatch.
import { createRequire } from 'node:module';
import {
  assert,
  api,
  state,
  create,
  startRun,
  newStore,
  launch,
  stop,
  removeStore,
  report,
} from './qa-lib.mjs';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url)),
  { chromium, expect } = require('@playwright/test');
const r = report('interactive-detail'),
  data = await newStore('detail'),
  port = 5907;
let server, browser, run;
try {
  server = await launch(data, 'claude', port);
  await r.check('complete native final result and bounded stored detail', async () => {
    const definition = {
      schemaVersion: 4,
      name: 'QA inspector native large result',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'work',
          kind: 'inference',
          label: 'Work',
          config: {
            harness: 'claude',
            model: 'claude-opus-5-5',
            effort: 'high',
            harnessOptions: { sandbox: 'read-only', approval: 'never' },
            prompt: { template: 'QA fake only' },
            output: { captureTranscript: 'artifact', toMessages: 'none' },
          },
        },
        { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
        { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
      ],
    };
    run = await startRun(await create(definition, port), port);
    const done = await state(run.id, 'succeeded', port);
    assert.equal(done.result.length, 20000);
    const items = (await api('GET', `/qa/transcript/${run.id}`, undefined, port)).items;
    assert.equal(items.find((x) => x.type === 'message').detail.text.length, 16384);
    return { runId: run.id, finalChars: done.result.length, itemTextChars: 16384 };
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  r.data.followups = [];
  for (const width of [1440, 390])
    await r.check(
      `visible complete final result at ${width}px; follow-up observations recorded`,
      async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(`http://127.0.0.1:${port}/app/runs/${run.id}`);
        await expect(page.getByTestId('run-result')).toBeVisible();
        assert.equal(JSON.parse(await page.getByTestId('run-result').innerText()).length, 20000);
        const measure = () =>
          page.evaluate(() => ({
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          }));
        const initial = await measure();
        await page.getByRole('button', { name: /Node progress/ }).click();
        const progress = await measure();
        await page
          .getByRole('list', { name: 'Timeline' })
          .getByRole('button')
          .filter({ hasText: 'node.progress' })
          .last()
          .click();
        await page
          .getByRole('list', { name: 'Timeline' })
          .getByRole('button')
          .filter({ hasText: 'run.finished' })
          .last()
          .click();
        await page.getByRole('button', { name: 'Full thread JSON', exact: true }).click();
        const finalLayout = await measure(),
          controls = await page.getByRole('button').allTextContents(),
          text = await page.locator('body').innerText();
        r.data.followups.push({
          disposition: 'pre-existing, outside #243, follow-up per round-3 dispatch',
          ids: ['QA-243-R2-01', 'QA-243-R2-02'],
          width,
          initial,
          progress,
          finalLayout,
          detailControls: controls.filter((x) =>
            /item detail|show detail|expand detail|transcript/i.test(x),
          ),
          boundedNotice: /\b(?:bounded|truncated|excerpt|16,?384|16\s*KiB)\b/i.test(text),
          latestThreadContainsTranscript: (
            await page.getByTestId('thread-json').innerText()
          ).includes('transcript'),
          visibleText: text.replace(/X{8,}/g, (x) => `[X repeated ${x.length} characters]`),
        });
        await page.close();
        return { completeFinalChars: 20000 };
      },
    );
} finally {
  if (browser) await browser.close();
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = await removeStore(data, true);
  await r.finish();
}
