// #265 child-run recovery as seen in the inspector: what the parent page offers after its child's
// session goes missing, what the child page offers, and the parent after the child's choice.
import { createRequire } from 'node:module';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CLI,
  RECORD,
  ROOT,
  WORKTREE,
  byMarker,
  call,
  createPublished,
  edge,
  events,
  gate,
  get,
  loop,
  post,
  requests,
  resetCli,
  saveJson,
  startApi,
  startRun,
  waitRun,
} from './lib.mjs';

const require = createRequire(join(WORKTREE, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const api = await startApi({ name: 's5b', port: 6447, dataDir: join(ROOT, 'data-s5b') });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ baseURL: api.base, viewport: { width: 1440, height: 900 } })).newPage();
const out = { browserVersion: browser.version() };
try {
  await resetCli();
  const child = loop(
    'acc-a child',
    [
      {
        id: 'worker',
        kind: 'inference',
        label: 'Worker',
        config: {
          harness: 'codex',
          model: 'gpt-6-luna',
          effort: 'low',
          session: { policy: 'resume-own' },
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          prompt: { template: 'CHILD265 run={{ run.id }} visit={{ counters.nodeVisits.worker }} task.' },
        },
      },
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue', exposeTo: ['api', 'ui'] } },
      gate('again', 2),
    ],
    [
      edge('s-w', 'start', 'worker'),
      edge('w-h', 'worker', 'hold'),
      edge('h-g', 'hold', 'again'),
      edge('g-w', 'again', 'worker', 'repeat'),
      edge('g-limit', 'again', 'done', 'limit-reached'),
      edge('g-finish', 'again', 'done', 'finish'),
    ],
  );
  const childId = await createPublished(api.base, child);
  const parentId = await createPublished(
    api.base,
    loop(
      'acc-a parent',
      [{ id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: childId, version: 'latest' } } }],
      [edge('s-sub', 'start', 'sub'), edge('sub-done', 'sub', 'done')],
    ),
  );
  const parent = await startRun(api.base, parentId);
  let childRun;
  for (let i = 0; i < 200 && !childRun; i += 1) {
    childRun = (await get(api.base, `/runs?parent=${parent.id}`)).items[0];
    if (!childRun) await delay(100);
  }
  const waiting = await waitRun(api.base, childRun.id, ['waiting']);
  const v1 = byMarker(await requests(), `CHILD265 run=${childRun.id} `)[0];
  await rm(join(CLI, 'sessions', v1.sessionId));
  await post(api.base, `/runs/${childRun.id}/input`, { waitId: waiting.waiting.waitId, input: 'go' });
  await waitRun(api.base, childRun.id, ['failed']);
  await waitRun(api.base, parent.id, ['failed']);

  await page.goto(`/app/runs/${parent.id}`);
  await page.getByText('Failed: HARNESS_SESSION_MISSING').waitFor();
  await delay(1000);
  out.parentPage = {
    text: (await page.locator('body').innerText()).slice(0, 1500),
    freshButtons: await page.getByRole('button', { name: /Start fresh session/ }).count(),
    buttonNames: await page.getByRole('button').evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 120))),
    resumeButtons: await page.getByRole('button', { name: /^Resume/ }).count(),
    resumeEnabled: await page.getByRole('button', { name: /^Resume/ }).first().isEnabled().catch(() => null),
    childLinks: await page.getByRole('link', { name: /child/i }).allTextContents(),
  };
  await page.screenshot({ path: join(RECORD, '265-parent-after-child-missing.png'), fullPage: true });

  await page.goto(`/app/runs/${childRun.id}`);
  const choose = page.getByRole('button', { name: 'Start fresh session for worker' });
  await choose.waitFor();
  out.childPage = { parentLinks: await page.getByRole('link', { name: /parent/i }).allTextContents() };
  await page.screenshot({ path: join(RECORD, '265-child-missing.png') });
  await choose.click();
  await waitRun(api.base, childRun.id, ['waiting']);

  await page.goto(`/app/runs/${parent.id}`);
  await delay(1500);
  const resume = page.getByRole('button', { name: /^Resume/ });
  out.parentAfterChoice = {
    resumeButtons: await resume.count(),
    buttonNames: await page.getByRole('button').evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 120))),
    resumeEnabled: (await resume.count()) ? await resume.first().isEnabled() : null,
  };
  await page.screenshot({ path: join(RECORD, '265-parent-after-child-choice.png'), fullPage: true });
  if (out.parentAfterChoice.resumeEnabled) await resume.first().click();
  else await call(api.base, 'POST', `/runs/${parent.id}/resume`, {});
  const childWaiting = await waitRun(api.base, childRun.id, ['waiting', 'succeeded']);
  if (childWaiting.status === 'waiting')
    await post(api.base, `/runs/${childRun.id}/input`, { waitId: childWaiting.waiting.waitId, input: 'go' });
  out.parentEnd = (await waitRun(api.base, parent.id, ['succeeded', 'failed'], 60_000)).status;
  out.parentEvents = (await events(api.base, parent.id)).map((e) => e.type);
  console.log(JSON.stringify(out, null, 2));
} finally {
  await browser.close();
  await api.kill();
  await saveJson('s5b-child-inspector-results.json', out);
}
process.exitCode = 0;
