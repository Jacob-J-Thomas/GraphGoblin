// Check 5 (+ inspector parts of check 2): a long run with child and script events in Edge.
// Timeline bounded, Load older, thread at an earlier event, consent dialog Cancel/Resume, live
// following of the resumed attempt without reload, and inspector Replay.
// Run: node --expose-gc check5-inspector.mjs
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiStore, chain, countType, eventually, exitNode, logger, makeDataDir, markerScript, qaDir,
  removeDir, scriptNode, sleep, subNode, TERMINAL, webDist, worktree, writeJson,
} from './lib.mjs';

const { chromium } = await import(pathToFileURL(join(worktree, 'apps/web/node_modules/@playwright/test/index.mjs')).href);
const log = logger('check5-inspector');
const PORT = Number(process.env.QA_PORT ?? 6390);
const PASSES = 40;
const violations = [];
const results = {};
const violate = (where, what, extra) => {
  violations.push({ where, what, ...(extra ? { extra } : {}) });
  log('VIOLATION', where, what, extra ?? '');
};
const check = (where, label, ok, extra) => {
  if (!ok) violate(where, label, extra);
  return ok;
};
const effects = (marker) => (existsSync(marker) ? (readFileSync(marker, 'utf8').match(/effect\n/g)?.length ?? 0) : 0);
function markerAlive(dir) {
  return readdirSync(dir).filter((n) => n.includes('.active-')).some((n) => {
    try {
      process.kill(Number(n.split('.active-')[1]), 0);
      return true;
    } catch {
      return false;
    }
  });
}
async function visible(locator, timeout = 15_000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

function longLoop(leafId, marker, release) {
  const tick = `process.stdout.write('tick')`;
  return {
    schemaVersion: 4,
    name: 'QA long inspector run',
    settings: { maxNodeVisits: 1000 },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'setn', kind: 'mutate', label: 'Count', config: { operations: [{ op: 'set', path: '/vars/n', value: { kind: 'expression', jsonata: '($exists(vars.n) ? vars.n : 0) + 1' } }] } },
      scriptNode('tick', ['-e', tick], { stdin: 'none', stdout: 'ignore' }),
      subNode(leafId),
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: `gates.gate.passes = ${PASSES} ? "done" : "repeat"`,
          routes: [{ id: 'repeat', label: 'Repeat', repeat: true }, { id: 'done', label: 'Done' }],
          maxPasses: PASSES,
        },
      },
      scriptNode('final', [markerScript, marker, release, '300000'], { stdin: 'none' }),
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.n' } },
      { id: 'exhausted', kind: 'exit', label: 'Exhausted', config: { outcome: 'exhausted' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'setn' } },
      { id: 'b', from: { node: 'setn', port: 'out' }, to: { node: 'tick' } },
      { id: 'c', from: { node: 'tick', port: 'out' }, to: { node: 'sub' } },
      { id: 'd', from: { node: 'sub', port: 'out' }, to: { node: 'gate' } },
      { id: 'r', from: { node: 'gate', port: 'repeat' }, to: { node: 'setn' } },
      { id: 'f', from: { node: 'gate', port: 'done' }, to: { node: 'final' } },
      { id: 'l', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'exhausted' } },
      { id: 'g', from: { node: 'final', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function makeUncertain(store, runId, marker, release, target = 1) {
  await eventually(() => effects(marker) === target, 180_000, 'final marker effect');
  await store.kill();
  writeFileSync(release, 'done');
  await eventually(() => !markerAlive(store.dataDir), 30_000, 'orphan marker exits');
  rmSync(release, { force: true });
  await store.start();
  await eventually(async () => (await store.run(runId)).status === 'failed', 60_000, 'failed after restart');
  return store.run(runId);
}

async function threadJson(page) {
  const json = page.getByTestId('thread-json');
  if (!(await json.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Full thread JSON' }).click();
  const more = page.getByRole('button', { name: 'Show all of Full thread JSON' });
  if (await more.isVisible().catch(() => false)) await more.click();
  return JSON.parse(await page.getByTestId('thread-json').innerText());
}

const dirs = [];
let store;
let browser;
try {
  const dir = await makeDataDir('c5');
  dirs.push(dir);
  store = apiStore({ dataDir: dir, port: PORT, log, env: { GG_WEB_DIST: webDist } });
  await store.start();
  const marker = join(dir, 'marker-long');
  const release = join(dir, 'release-long');
  const leaf = await store.publish(chain('QA inspector leaf', [exitNode('"leaf"')]));
  const loopId = await store.publish(longLoop(leaf, marker, release));
  const run = await store.startRun(loopId);
  const t0 = Date.now();
  const failed = await makeUncertain(store, run.id, marker, release);
  const events = await store.events(run.id);
  results.run = {
    id: run.id,
    secondsToFinalScript: Math.round((Date.now() - t0) / 1000),
    lastEventSeq: failed.lastEventSeq,
    failure: failed.failure,
    eventTypes: Object.fromEntries([...new Set(events.map((e) => e.type))].map((t) => [t, countType(events, t)])),
    children: (await store.children(run.id)).length,
  };
  log('long run', JSON.stringify(results.run));
  check('setup', 'several hundred events', failed.lastEventSeq >= 300, failed.lastEventSeq);
  check('setup', 'uncertain failure', failed.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN', failed.failure);

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let navigations = 0;
  let loads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  page.on('load', () => (loads += 1));
  await page.goto(`${store.origin}/app/runs/${run.id}`);
  // A document-level marker survives client-side route/query changes but not a reload.
  await page.evaluate(() => (window.__qaDocument = 'original'));
  const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
  const where = '5 bounded history';
  check(where, 'failure banner', await visible(page.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')));
  const heading = await page.getByRole('heading', { name: /^Timeline \(/ }).first().innerText().catch(() => 'missing');
  await page.screenshot({ path: join(qaDir, 'check5-01-uncertain.png') });
  const rowsInitial = await timeline.getByRole('listitem').count();
  const firstSeqInitial = Number(await timeline.getByRole('button').first().getAttribute('data-seq'));
  const lastSeqInitial = Number(await timeline.getByRole('button').last().getAttribute('data-seq'));
  const cache = async () =>
    page.evaluate(() => {
      const raw = JSON.parse(sessionStorage.getItem('graphgoblin-run-events-v4') ?? '{}');
      return Object.fromEntries(Object.entries(raw.state?.runs ?? {}).map(([id, r]) => [id, { lastSeq: r.lastSeq, events: r.events.length, bytes: r.bytes }]));
    });
  const cacheInitial = await cache();
  check(where, 'Timeline rows bounded', rowsInitial > 0 && rowsInitial <= 80, rowsInitial);
  check(where, 'cache bounded', (cacheInitial[run.id]?.events ?? 0) <= 512 && (cacheInitial[run.id]?.bytes ?? 0) <= 1_048_576, cacheInitial);
  await page.getByRole('button', { name: 'Load older' }).click();
  await sleep(1500);
  const rowsAfterOlder = await timeline.getByRole('listitem').count();
  const firstSeqAfterOlder = Number(await timeline.getByRole('button').first().getAttribute('data-seq'));
  check(where, 'Load older moves the window back', firstSeqAfterOlder < firstSeqInitial, { firstSeqInitial, firstSeqAfterOlder });
  check(where, 'rows stay bounded after Load older', rowsAfterOlder <= 80, rowsAfterOlder);
  // Thread at earlier events: the 7th Count completion and the 3rd child completion.
  const setn7 = events.filter((e) => e.type === 'node.finished' && e.nodeId === 'setn')[6];
  const child3 = events.filter((e) => e.type === 'child_run.finished')[2];
  const threads = [];
  for (const target of [setn7, child3]) {
    await page.getByRole('spinbutton', { name: 'Event sequence' }).fill(String(target.seq));
    await page.getByRole('button', { name: 'Go to event' }).click();
    const headingOk = await visible(page.getByRole('heading', { name: `Thread at event ${target.seq}`, exact: true }));
    const api = await store.call('GET', `/runs/${run.id}/thread?at=${target.seq}`);
    let browserThread;
    await eventually(async () => {
      browserThread = await threadJson(page);
      return JSON.stringify(browserThread) === JSON.stringify(api);
    }, 15_000, 'thread matches').catch(() => undefined);
    const same = JSON.stringify(browserThread) === JSON.stringify(api);
    threads.push({ seq: target.seq, type: target.type, headingOk, sameAsApi: same, varsN: browserThread?.vars?.n });
    check(where, `thread at ${target.seq} heading`, headingOk);
    check(where, `thread at ${target.seq} equals server thread`, same);
  }
  check(where, 'thread at 7th Count has n=7', threads[0]?.varsN === 7, threads[0]);
  await page.screenshot({ path: join(qaDir, 'check5-02-earlier-thread.png') });
  results.history = { heading, rowsInitial, firstSeqInitial, lastSeqInitial, cacheInitial: cacheInitial[run.id], rowsAfterOlder, firstSeqAfterOlder, threads };
  log(where, JSON.stringify(results.history));

  // Consent dialog: Cancel runs nothing.
  const w2 = '2 inspector consent dialog';
  await page.getByRole('button', { name: 'Recover script' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recover script' });
  const dialogText = await dialog.innerText();
  check(w2, 'dialog explains the possible effect', /may already have produced its effect/.test(dialogText), dialogText);
  await page.screenshot({ path: join(qaDir, 'check5-03-consent.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await sleep(2000);
  const afterCancel = await store.run(run.id);
  check(w2, 'Cancel leaves the run failed', afterCancel.status === 'failed' && afterCancel.lastEventSeq === failed.lastEventSeq, afterCancel.status);
  check(w2, 'Cancel runs nothing', effects(marker) === 1, effects(marker));
  // Resume: exactly one more effect, followed live without reload.
  await page.getByRole('button', { name: 'Recover script' }).click();
  await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
  await eventually(() => effects(marker) === 2, 30_000, 'resumed effect');
  const sawRunning = await visible(page.locator('[data-status="running"]'), 15_000);
  check(w2, 'inspector shows the resumed attempt running', sawRunning);
  writeFileSync(release, 'done');
  await eventually(async () => (await store.run(run.id)).finalizedAt, 60_000, 'resumed run finalized');
  const final = await store.run(run.id);
  const sawSucceeded = await visible(page.locator('[data-status="succeeded"]'), 30_000);
  check(w2, 'inspector shows success without reload', sawSucceeded);
  await page.getByRole('button', { name: 'Follow live' }).click().catch(() => undefined);
  const lastButton = await eventually(async () => {
    const text = await timeline.getByRole('button').last().innerText();
    return text.includes(`#${final.lastEventSeq}`) ? text : false;
  }, 20_000, 'timeline reaches final event').catch(() => 'not reached');
  const rowsFinal = await timeline.getByRole('listitem').count();
  const finalEvents = await store.events(run.id);
  const cacheFinal = await cache();
  await page.screenshot({ path: join(qaDir, 'check5-04-resumed-succeeded.png') });
  check(w2, 'timeline follows to the final event', lastButton !== 'not reached', lastButton);
  const documentMarker = await page.evaluate(() => window.__qaDocument ?? 'missing');
  check(w2, 'no page reload (document marker kept, one load event)', documentMarker === 'original' && loads === 1, { documentMarker, loads, navigations });
  check(w2, 'exactly two effects', effects(marker) === 2, effects(marker));
  check(w2, 'final succeeded', final.status === 'succeeded', final.status);
  check(w2, 'rows bounded at end', rowsFinal <= 80, rowsFinal);
  check(w2, 'earlier failed attempt retained in history', finalEvents.some((e) => e.type === 'run.failed') && finalEvents.some((e) => e.type === 'run.resumed'));
  results.resume = {
    dialogText,
    afterCancel: { status: afterCancel.status, lastEventSeq: afterCancel.lastEventSeq, effects: 1 },
    sawRunning,
    sawSucceeded,
    final: { status: final.status, lastEventSeq: final.lastEventSeq, result: final.result },
    lastTimelineButton: lastButton,
    rowsFinal,
    cacheFinal: cacheFinal[run.id],
    navigations,
    loads,
    documentMarker,
    finalTimelineHeading: await page.getByRole('heading', { name: /^Timeline \(/ }).first().innerText().catch(() => 'missing'),
    effects: effects(marker),
    lifecycleTail: finalEvents.filter((e) => ['run.failed', 'run.resumed', 'script.dispatched', 'run.finished'].includes(e.type)).slice(-6).map((e) => `${e.seq}:${e.type}`),
  };
  log(w2, JSON.stringify(results.resume));

  // Inspector Replay on a second uncertain run.
  const w3 = '2 inspector Replay';
  const marker2 = join(dir, 'marker-replay');
  const release2 = join(dir, 'release-replay');
  const small = await store.publish(chain('QA inspector replay', [scriptNode('script', [markerScript, marker2, release2, '120000'], { stdin: 'none' }), exitNode()]));
  const r2 = await store.startRun(small);
  const failed2 = await makeUncertain(store, r2.id, marker2, release2);
  writeFileSync(release2, 'done');
  await page.goto(`${store.origin}/app/runs/${r2.id}`);
  await visible(page.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN'));
  await page.getByRole('button', { name: 'Recover script' }).click();
  await dialog.getByRole('button', { name: 'Replay', exact: true }).click();
  await eventually(() => !page.url().includes(r2.id), 15_000, 'navigated to the fork').catch(() => undefined);
  const forkUrl = page.url();
  const forkId = forkUrl.split('/').at(-1);
  const forkFinal = await eventually(async () => {
    const r = await store.run(forkId);
    return TERMINAL.includes(r.status) ? r : false;
  }, 60_000, 'fork terminal').catch((e) => ({ status: String(e) }));
  const sourceAfter = await store.run(r2.id);
  const sourceEvents = await store.events(r2.id);
  const forkShown = await visible(page.locator('[data-status="succeeded"]'), 20_000);
  check(w3, 'Replay navigates to a new run', forkId && forkId !== r2.id, forkUrl);
  check(w3, 'fork succeeded', forkFinal.status === 'succeeded', forkFinal.status);
  check(w3, 'source unchanged', sourceAfter.status === 'failed' && sourceAfter.lastEventSeq === failed2.lastEventSeq, sourceAfter.status);
  check(w3, 'source not re-dispatched', countType(sourceEvents, 'script.dispatched') === 1);
  check(w3, 'effects: one original + one fork', effects(marker2) === 2, effects(marker2));
  results.replay = { source: r2.id, forkUrl: forkUrl.replace(store.origin, '<origin>'), forkStatus: forkFinal.status, forkShownSucceeded: forkShown, sourceStatus: sourceAfter.status, sourceDispatches: countType(sourceEvents, 'script.dispatched'), effects: effects(marker2) };
  log(w3, JSON.stringify(results.replay));
} catch (error) {
  violate('harness', error instanceof Error ? error.stack : String(error));
} finally {
  await browser?.close();
  await store?.kill();
  results.violations = violations;
  results.verdict = violations.length ? 'FAIL' : 'PASS';
  writeJson('check5-inspector.json', results);
  log('verdict', results.verdict, `${violations.length} violations`);
  for (const d of dirs) {
    await eventually(() => !markerAlive(d), 30_000, 'markers exit').catch(() => undefined);
    await removeDir(d);
  }
  log('removed', dirs.map((d) => (existsSync(d) ? `${d} STILL PRESENT` : `${d} removed`)));
}
