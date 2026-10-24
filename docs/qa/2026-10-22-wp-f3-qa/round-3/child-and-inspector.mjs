import { createRequire } from 'node:module';
import {
  assert,
  api,
  state,
  create,
  startRun,
  waitDefinition,
  newStore,
  launch,
  stop,
  removeStore,
  report,
  until,
} from './qa-lib.mjs';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url)),
  { chromium, expect } = require('@playwright/test');
const r = report('child-inspector'),
  data = await newStore('child');
let server, browser;
try {
  server = await launch(data);
  let finished;
  await r.check('five-second parent deadline cancels input-wait child', async () => {
    const child = await create(waitDefinition('QA child input'));
    const d = waitDefinition('QA parent deadline', { runDeadlineSeconds: 5 });
    d.nodes[1] = {
      id: 'ask',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: child.loop.id } },
    };
    const parent = await startRun(await create(d));
    const waiting = await until(async () =>
      (await api('GET', `/runs?parent=${parent.id}`)).items.find((x) => x.status === 'waiting'),
    );
    finished = await state(parent.id, 'failed');
    const stopped = await state(waiting.id, 'cancelled');
    assert.equal(finished.failure.code, 'RUN_DEADLINE_EXCEEDED');
    assert.equal(finished.failure.resumable, false);
    return {
      parent: {
        failure: finished.failure,
        elapsedMs: Date.parse(finished.finishedAt) - Date.parse(finished.startedAt),
      },
      child: { status: stopped.status, pin: stopped.pinned.limits },
    };
  });
  await r.check(
    'inspector shows authored pinned limits and absolute deadline at 390px',
    async () => {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto('http://127.0.0.1:5905/app/runs/' + finished.id);
      const text = 'Maximum node visits: 10. Run deadline: 5 seconds.';
      await expect(page.getByText(text)).toBeVisible();
      const at = new Date(Date.parse(finished.startedAt) + 5000).toISOString();
      await expect(page.getByText('Deadline at: ' + at)).toBeVisible();
      return { card: text, absoluteDeadline: at };
    },
  );
} finally {
  if (browser) await browser.close();
  if (server) r.data.lifecycle.push(await stop(server));
  r.data.cleanup = await removeStore(data);
  await r.finish();
}
