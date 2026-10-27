// Check 3 (history mode and selection) and the keyboard/wording half of check 5.
// On an endless cycle that keeps running throughout:
//  - selecting a completion shows its exact historical thread and patch diff, compared with
//    GET /runs/{id}/thread?at=N and at=N-1, and reads exactly those two boundaries;
//  - the selection pauses following (window and thread hold still while the run advances) and
//    reads no current thread meanwhile;
//  - returning to live shows the current thread including changes made meanwhile;
//  - a non-completion selection reads only its own boundary; rapid selection settles on the
//    last one; a status change during a selection still reaches the header;
//  - older-history browsing (Load older, Previous rows, Go to event) and the 80-row window;
//  - keyboard-only selection and Follow live, and what the page says in each mode.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle,
  recordRequests, countByKind, inspectorState, HERE,
} from './lib.mjs';

const PORT = 6562;
const log = logger('history.log.txt');
const data = await makeTemp('hist');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'QA history' }));
  const run = await rest.start(loop.loop.id);
  await until(async () => (await rest.run(run.id)).lastEventSeq >= 1500, { timeout: 120_000, what: '1,500 events' });
  browser = await edge();
  results.edgeVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rec = recordRequests(context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    // Every text a polite or assertive live region announces, in order.
    window.__announced = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[aria-live]')) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t && window.__announced.at(-1) !== t) window.__announced.push(t);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  await delay(2000);
  const following = await inspectorState(page);
  results.ariaFollowing = (await page.getByRole('heading', { name: 'Current thread' }).locator('xpath=ancestor::section[1]').ariaSnapshot()).slice(0, 1500);
  check('following: thread panel is "Current thread", no patch diff, latest row marked current, Follow live disabled', following.threadHeading === 'Current thread' && !following.patchDiff && following.currentRow === following.lastRow && following.followLiveEnabled === false, {
    threadHeading: following.threadHeading, patchDiff: following.patchDiff, currentRow: following.currentRow, lastRow: following.lastRow, followLiveEnabled: following.followLiveEnabled, timeline: following.timeline,
  });

  // A. Select the latest Grow completion by pointer.
  const timeline = page.getByRole('list', { name: 'Timeline', exact: true });
  const tSelect = Date.now();
  await timeline.getByRole('button', { name: /node\.finished Grow \(grow\)/ }).last().click();
  const heading = page.getByRole('heading', { name: /^Thread at event \d+$/ });
  await heading.waitFor({ timeout: 30_000 });
  await page.getByRole('list', { name: 'Patch diff' }).waitFor({ timeout: 30_000 });
  const n = Number(/\d+/.exec((await heading.textContent()) ?? '')?.[0]);
  const [atN, atPrev, eventN] = await Promise.all([
    rest('GET', `/runs/${run.id}/thread?at=${n}`),
    rest('GET', `/runs/${run.id}/thread?at=${n - 1}`),
    rest('GET', `/runs/${run.id}/events?around=${n}&limit=5`).then((p) => p.items.find((e) => e.seq === n)),
  ]);
  await delay(500);
  const sel = await inspectorState(page);
  const before = parse(await page.locator('pre[aria-label="Value before /vars/n"]').textContent());
  const after = parse(await page.locator('pre[aria-label="Value after /vars/n"]').textContent());
  check('selected completion: thread equals thread?at=N; patch diff before/after equal at=N-1 and at=N', isDeepStrictEqual(sel.vars, atN.vars) && before === atPrev.vars.n && after === atN.vars.n && eventN?.type === 'node.finished', {
    n, uiVars: sel.vars, apiAtN: atN.vars, apiAtPrev: atPrev.vars, patchBefore: before, patchAfter: after, patchTitle: sel.patchTitle, eventType: eventN?.type, eventPatch: eventN?.patch,
  });
  const boundaries = () => rec.since(tSelect, run.id).filter((r) => r.kind === 'thread?at').map((r) => r.at).sort((a, b) => a - b);
  check('selection reads exactly thread?at=N-1 and N', isDeepStrictEqual(boundaries(), [n - 1, n]), { boundaries: boundaries() });
  results.ariaSelected = (await heading.locator('xpath=ancestor::section[1]').ariaSnapshot()).slice(0, 1500);
  const patchSection = (await page.getByRole('list', { name: 'Patch diff' }).locator('xpath=ancestor::section[1]').ariaSnapshot()).slice(0, 1500);
  results.ariaPatch = patchSection;

  // B. The selection holds while the run advances; no current-thread read meanwhile.
  const tHold = Date.now();
  const seqHold = (await rest.run(run.id)).lastEventSeq;
  await delay(5000);
  const held = await inspectorState(page);
  const seqLater = (await rest.run(run.id)).lastEventSeq;
  const holdReads = countByKind(rec.since(tHold, run.id));
  check('selection pauses following: rows, thread heading and values hold while the run advances; Follow live enabled', held.firstRow === sel.firstRow && held.lastRow === sel.lastRow && held.threadHeading === `Thread at event ${n}` && isDeepStrictEqual(held.vars, atN.vars) && held.followLiveEnabled === true && seqLater > seqHold + 100, {
    rowsBefore: [sel.firstRow, sel.lastRow], rowsAfter: [held.firstRow, held.lastRow], heading: held.threadHeading, runAdvanced: [seqHold, seqLater], followLiveEnabled: held.followLiveEnabled, timeline: held.timeline,
  });
  check('while a selection is shown: run record keeps refreshing, no current-thread or further boundary read', (holdReads.run ?? 0) > 0 && !holdReads.thread && !holdReads['thread?at'], { readsIn5s: holdReads });

  // C. Changes meanwhile, then Follow live: pause the run (so the API thread is stable), return.
  await rest('POST', `/runs/${run.id}/pause`, {});
  await rest.waitStatus(run.id, ['paused']);
  await delay(800);
  const pausedThread = await rest('GET', `/runs/${run.id}/thread`);
  const statusDuringSelection = (await inspectorState(page)).status;
  const tLive = Date.now();
  await page.getByRole('button', { name: 'Follow live' }).click();
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
  await until(async () => isDeepStrictEqual((await inspectorState(page)).vars, pausedThread.vars), { timeout: 10_000, what: 'current thread after Follow live' }).catch(() => {});
  const back = await inspectorState(page);
  const liveReads = countByKind(rec.since(tLive, run.id));
  check('Follow live shows the current thread including changes made during the selection', back.threadHeading === 'Current thread' && isDeepStrictEqual(back.vars, pausedThread.vars) && back.vars.n > atN.vars.n && !back.patchDiff && back.lastRow === (await rest.run(run.id)).lastEventSeq, {
    uiVars: back.vars, apiCurrent: pausedThread.vars, selectedWas: atN.vars, lastRow: back.lastRow, readsAfterFollowLive: liveReads,
  });
  check('a status change during the selection reached the header (paused)', statusDuringSelection === 'paused', { statusDuringSelection });
  await rest('POST', `/runs/${run.id}/resume`, {});
  await delay(3000);

  // D. Selecting a decision and a node start reads only that boundary; shows no patch diff.
  for (const [label, pattern] of [['decision.made', /decision\.made/], ['node.started', /node\.started Grow/]]) {
    const t = Date.now();
    await timeline.getByRole('button', { name: pattern }).last().click();
    const h = page.getByRole('heading', { name: /^Thread at event \d+$/ });
    await h.waitFor({ timeout: 30_000 });
    const m = Number(/\d+/.exec((await h.textContent()) ?? '')?.[0]);
    await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 30_000, what: 'read finished' });
    const st = await inspectorState(page);
    const apiAt = await rest('GET', `/runs/${run.id}/thread?at=${m}`);
    const reads = rec.since(t, run.id).filter((r) => r.kind === 'thread?at').map((r) => r.at);
    check(`selected ${label}: thread equals thread?at=N, reads only that boundary, no patch diff`, isDeepStrictEqual(st.vars, apiAt.vars) && isDeepStrictEqual(reads, [m]) && !st.patchDiff, {
      m, reads, uiVars: st.vars, apiVars: apiAt.vars, patchDiff: st.patchDiff,
    });
    await page.getByRole('button', { name: 'Follow live' }).click();
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    await delay(1500);
  }

  // E. Keyboard only: focus the latest row, move up three rows, select with Enter, Follow live.
  {
    const rows = page.locator('ol[aria-label="Timeline"] button[data-seq]');
    await rows.last().focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
    const focusedSeq = await page.evaluate(() => Number(document.activeElement?.dataset?.seq));
    const tKey = Date.now();
    await page.keyboard.press('Enter');
    const h = page.getByRole('heading', { name: `Thread at event ${focusedSeq}` });
    await h.waitFor({ timeout: 30_000 });
    await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 30_000, what: 'read finished' });
    const st = await inspectorState(page);
    const stillFocused = await page.evaluate(() => Number(document.activeElement?.dataset?.seq));
    const apiAt = await rest('GET', `/runs/${run.id}/thread?at=${focusedSeq}`);
    const announced = await page.evaluate(() => window.__announced.slice(-12));
    check('keyboard: Arrow keys move focus (pausing), Enter selects; focus stays on the row; thread equals thread?at', isDeepStrictEqual(st.vars, apiAt.vars) && stillFocused === focusedSeq && st.currentRow === focusedSeq, {
      focusedSeq, stillFocused, currentRow: st.currentRow, reads: rec.since(tKey, run.id).filter((r) => r.kind === 'thread?at').map((r) => r.at), announcedRecently: announced,
    });
    const follow = page.getByRole('button', { name: 'Follow live' });
    await follow.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    const afterFollow = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: (document.activeElement?.textContent ?? '').trim().slice(0, 60) }));
    check('keyboard: Follow live via Enter returns to the current thread', true, { focusAfterFollowLive: afterFollow });
    await delay(1500);
  }

  // F. Rapid selection changes settle on the last selection.
  {
    const t = Date.now();
    const finished = timeline.getByRole('button', { name: /node\.finished/ });
    const count = await finished.count();
    const picks = [count - 1, count - 3, count - 5, count - 7, count - 9, count - 11].filter((i) => i >= 0);
    let lastSeq;
    for (const i of picks) {
      const b = finished.nth(i);
      lastSeq = Number(await b.getAttribute('data-seq'));
      await b.click();
      await delay(40);
    }
    await page.getByRole('heading', { name: `Thread at event ${lastSeq}` }).waitFor({ timeout: 60_000 });
    await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 60_000, what: 'read finished' });
    await delay(500);
    const st = await inspectorState(page);
    const apiAt = await rest('GET', `/runs/${run.id}/thread?at=${lastSeq}`);
    const reads = rec.since(t, run.id).filter((r) => r.kind === 'thread?at');
    check('rapid selection settles on the last selected completion with its exact thread', st.threadHeading === `Thread at event ${lastSeq}` && isDeepStrictEqual(st.vars, apiAt.vars) && Boolean(st.patchDiff), {
      selections: picks.length, lastSeq, threadAtReadsIssued: reads.length, failedOrAborted: reads.filter((r) => r.failed).length, uiVars: st.vars, apiVars: apiAt.vars,
    });
  }

  // G. Older-history browsing and the 80-row window, while the run keeps executing.
  {
    await page.getByRole('button', { name: 'Follow live' }).click();
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    await delay(1000);
    const windows = [];
    const snap = async (what) => {
      const st = await inspectorState(page);
      windows.push({ what, first: st.firstRow, last: st.lastRow, rows: st.rowsMounted, contiguous: st.contiguous });
      return st;
    };
    await snap('live');
    await page.getByRole('button', { name: 'Load older' }).click();
    await until(async () => (await inspectorState(page)).firstRow < windows[0].first, { timeout: 30_000, what: 'older rows' });
    await snap('after Load older');
    await page.getByRole('button', { name: 'Previous rows' }).click().catch(() => {});
    await delay(800);
    await snap('after Previous rows');
    await page.getByRole('button', { name: 'Load older' }).click().catch(() => {});
    await delay(1500);
    const s3 = await snap('after a second Load older');
    await delay(3000);
    const s4 = await snap('3 s later (run still executing)');
    await page.getByRole('button', { name: 'Next rows' }).click().catch(() => {});
    await delay(800);
    await snap('after Next rows');
    check('older-history browsing: every window contiguous, at most 80 rows, holds still while the run executes', windows.every((w) => w.contiguous && w.rows <= 80 && w.rows > 0) && s3.firstRow === s4.firstRow && s3.lastRow === s4.lastRow, { windows });
    // Go to event 137: exact thread.
    await page.getByLabel('Event sequence').fill('137');
    await page.getByRole('button', { name: 'Go to event' }).click();
    await page.getByRole('heading', { name: 'Thread at event 137' }).waitFor({ timeout: 30_000 });
    await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 30_000, what: 'read finished' });
    const st = await inspectorState(page);
    const api137 = await rest('GET', `/runs/${run.id}/thread?at=137`);
    check('Go to event 137 selects the row and shows the exact thread at 137', st.currentRow === 137 && isDeepStrictEqual(st.vars, api137.vars) && st.rowsMounted <= 80 && st.contiguous, {
      currentRow: st.currentRow, uiVars: st.vars, apiVars: api137.vars, rows: st.rowsMounted, window: [st.firstRow, st.lastRow],
    });
    await page.getByRole('button', { name: 'Follow live' }).click();
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    await delay(1500);
    const live = await inspectorState(page);
    const lastSeq = (await rest.run(run.id)).lastEventSeq;
    check('Follow live after browsing returns to the contiguous tail', live.contiguous && live.rowsMounted <= 80 && lastSeq - live.lastRow < 400 && live.threadHeading === 'Current thread', {
      window: [live.firstRow, live.lastRow], apiLastSeq: lastSeq, rows: live.rowsMounted,
    });
  }

  // H. A terminal transition while a completion is selected; then Follow live.
  {
    await timeline.getByRole('button', { name: /node\.finished Grow \(grow\)/ }).last().click();
    const h = page.getByRole('heading', { name: /^Thread at event \d+$/ });
    await h.waitFor({ timeout: 30_000 });
    const m = Number(/\d+/.exec((await h.textContent()) ?? '')?.[0]);
    await rest('POST', `/runs/${run.id}/cancel`, {});
    await rest.waitStatus(run.id, ['cancelled']);
    await until(async () => (await inspectorState(page)).status === 'cancelled', { timeout: 15_000, what: 'header shows cancelled' }).catch(() => {});
    const during = await inspectorState(page);
    await page.getByRole('button', { name: 'Follow live' }).click();
    await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
    const apiThread = await rest('GET', `/runs/${run.id}/thread`);
    const finalRun = await rest.run(run.id);
    await until(async () => {
      const s = await inspectorState(page);
      return isDeepStrictEqual(s.vars, apiThread.vars) && s.timeline.total === finalRun.lastEventSeq && s.timeline.stream === 'complete';
    }, { timeout: 15_000, what: 'final current thread' }).catch(() => {});
    const fin = await inspectorState(page);
    check('cancellation while a completion is selected: header updates, selection holds; Follow live shows the final current thread', during.status === 'cancelled' && during.threadHeading === `Thread at event ${m}` && isDeepStrictEqual(fin.vars, apiThread.vars) && fin.timeline.stream === 'complete' && fin.timeline.total === finalRun.lastEventSeq && (fin.executionContext ?? '').includes('Cancelled by'), {
      during: { status: during.status, heading: during.threadHeading }, final: { vars: fin.vars, api: apiThread.vars, timeline: fin.timeline, lastEventSeq: finalRun.lastEventSeq, executionContext: fin.executionContext },
    });
  }
  results.announced = await page.evaluate(() => window.__announced);
  results.allRequests = countByKind(rec.all);
  await page.screenshot({ path: join(HERE, 'history-final.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  results.ok = !results.error && results.checks.every((c) => c.ok);
  await writeFile(join(HERE, 'history.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
