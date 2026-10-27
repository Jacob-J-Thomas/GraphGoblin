import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api, browser;
const E = {};
const prior = JSON.parse(fs.readFileSync(path.join(L.RECORD, 'restart-results.json'), 'utf8'));
const ownLoop = (name) =>
  L.loop(
    name,
    [
      L.inference('think', { policy: 'resume-own' }),
      L.waitNode(),
      {
        id: 'gate',
        kind: 'decision',
        label: 'Repeat gate',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          maxPasses: 2,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'finish', label: 'Finish' },
          ],
        },
      },
    ],
    {},
    [
      L.edge('a', 'start', 'think'),
      L.edge('b', 'think', 'park'),
      L.edge('c', 'park', 'gate'),
      L.edge('d', 'gate', 'think', 'again'),
      L.edge('e', 'gate', 'done', 'finish'),
      L.edge('f', 'gate', 'done', 'limit-reached'),
    ],
  );
async function answer(id) {
  const s = await api.get('/runs/' + id);
  return api.post(`/runs/${id}/input`, { waitId: s.waiting.waitId, input: 'go' });
}
try {
  api = await L.startApi('restart-store', 6631);
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-first-run'] });
  let id = prior.evidence.states['missing-session'].run.id;
  let before = await api.get('/runs/' + id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(api.base + '/app/runs/' + id);
  let button = page.getByRole('button', { name: 'Start fresh session for think', exact: true });
  await button.waitFor();
  await page.screenshot({ path: path.join(L.RECORD, 'missing-session-fresh-choice.png') });
  await button.click();
  let fresh = await L.state(api, id, ['waiting']);
  let history = await L.events(api, id);
  let choices = history.filter((e) => e.type === 'run.resumed' && e.freshSession);
  L.check(
    'fresh-session Edge choice retains same run and records one explicit choice',
    fresh.id === id && choices.length === 1,
    { before, fresh, choices },
  );
  await answer(id);
  let end = await L.state(api, id, ['succeeded']);
  await L.until(() => page.locator('[data-status="succeeded"]').isVisible());
  E.fresh = { before, fresh, end, history: await L.events(api, id) };
  const childLoop = await L.publish(api, ownLoop('QA child missing followup'));
  let parent = await L.run(
    api,
    await L.publish(
      api,
      L.loop('QA parent missing followup', [
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Child',
          config: { loopRef: { loopId: childLoop, version: 'latest' } },
        },
      ]),
    ),
  );
  let child = await L.until(async () => (await api.get('/runs?parent=' + parent.id)).items[0]);
  await L.state(api, child.id, ['waiting']);
  let reqs = fs
    .readFileSync(path.join(L.CLI, 'requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  let req = reqs.findLast((r) => r.prompt.includes(child.id));
  fs.unlinkSync(path.join(L.CLI, 'sessions', req.sessionId));
  await answer(child.id);
  let childFailed = await L.state(api, child.id, ['failed']);
  let parentFailed = await L.state(api, parent.id, ['failed']);
  let early = await api.call('POST', `/runs/${parent.id}/resume`, {
    observedSeq: parentFailed.recovery.observedSeq,
  });
  L.check(
    'parent Resume refuses before child fresh choice',
    early.status === 409 && early.body.code === 'SESSION_RECOVERY_REQUIRED',
    early,
  );
  let failedSeq = (await L.events(api, child.id)).findLast((e) => e.type === 'run.failed').seq;
  let choice = await api.call('POST', `/runs/${child.id}/recover-session`, {
    nodeId: 'think',
    failureSeq: failedSeq,
  });
  await L.state(api, child.id, ['waiting']);
  let parentReady = await api.get('/runs/' + parent.id);
  let parentResume = await api.call('POST', `/runs/${parent.id}/resume`, {
    observedSeq: parentReady.recovery.observedSeq,
  });
  await answer(child.id);
  let parentDone = await L.state(api, parent.id, ['succeeded']);
  let children = (await api.get('/runs?parent=' + parent.id)).items;
  L.check(
    'child fresh choice then parent Resume retains one exact child',
    choice.status === 200 &&
      parentResume.status === 200 &&
      children.length === 1 &&
      children[0].id === child.id,
    { choice, parentResume, parentDone, children },
  );
  E.child = {
    childFailed,
    parentFailed,
    early,
    choice,
    parentReady,
    parentResume,
    parentDone,
    children,
  };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('fresh followup completed', false, E.error);
} finally {
  if (browser) await browser.close();
  await L.cleanup();
  L.save(
    'fresh-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('fresh-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
