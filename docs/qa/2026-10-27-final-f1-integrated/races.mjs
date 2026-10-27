import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import * as L from './lib.mjs';
let api, browser, proxy;
const E = {};
const boot = async () => (api = await L.startApi('races-corrected', 6633));
const state = (id) => api.get('/runs/' + id);
async function mark(id) {
  await L.until(async () => !!(await state(id)).finalizedAt);
  const preview = await api.post('/runs/deletion-eligibility/preview', { runIds: [id] });
  return api.post('/runs/deletion-eligibility', {
    runIds: [id],
    token: preview.token,
    action: 'mark',
    confirmed: true,
  });
}
async function tabs(id) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pages = [await ctx.newPage(), await ctx.newPage()];
  for (const p of pages) {
    await p.goto(api.base + '/app/runs/' + id);
    await p.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  }
  return pages;
}
async function race(pages, id, action, button) {
  let arrivals = 0,
    release;
  const gate = new Promise((r) => (release = r));
  for (const p of pages)
    await p.route(`**/runs/${id}/${action}`, async (route) => {
      if (++arrivals === 2) release();
      await gate;
      await route.continue();
    });
  const replies = pages.map((p) =>
    p.waitForResponse((r) => r.url().endsWith(`/runs/${id}/${action}`)),
  );
  for (const p of pages) await p.getByRole('button', { name: button, exact: true }).click();
  return Promise.all(
    (await Promise.all(replies)).map(async (r) => ({ status: r.status(), body: await r.json() })),
  );
}
try {
  await boot();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-first-run'] });
  let r = await L.run(api, await L.publish(api, L.loop('QA two tab Resume', [L.waitNode()])));
  await L.state(api, r.id, ['waiting']);
  await api.post(`/runs/${r.id}/pause`);
  let paused = await L.state(api, r.id, ['paused']);
  let pages = await tabs(r.id);
  let responses = await race(pages, r.id, 'resume', 'Resume');
  await L.state(api, r.id, ['waiting']);
  let events = await L.events(api, r.id);
  L.check(
    'two Edge tabs admit exactly one Resume',
    responses
      .map((r) => r.status)
      .sort()
      .join() === '200,409' &&
      responses.find((r) => r.status === 409).body.code === 'RECOVERY_STALE' &&
      events.filter((e) => e.type === 'run.resumed').length === 1,
    responses,
  );
  E.twoTabResume = { paused, responses, events };
  // Keep a page's real earlier observation while the public API advances the run.
  await api.post(`/runs/${r.id}/pause`);
  paused = await L.state(api, r.id, ['paused']);
  let stalePage = await browser.newPage();
  await stalePage.route(api.base + `/runs/${r.id}`, (route) => route.fulfill({ json: paused }));
  await stalePage.goto(api.base + '/app/runs/' + r.id);
  await stalePage.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  await api.post(`/runs/${r.id}/resume`, { observedSeq: paused.recovery.observedSeq });
  await L.state(api, r.id, ['waiting']);
  let refuse = stalePage.waitForResponse((x) => x.url().endsWith('/resume'));
  await stalePage.getByRole('button', { name: 'Resume', exact: true }).click();
  let refused = await refuse;
  let refusal = await refused.json();
  await stalePage.getByRole('alert').filter({ hasText: 'changed since it was shown' }).waitFor();
  L.check(
    'stale Edge observation is refused and announced',
    refused.status() === 409 && refusal.code === 'RECOVERY_STALE',
    refusal,
  );
  await stalePage.screenshot({ path: path.join(L.RECORD, 'stale-resume.png') });
  E.stale = { paused, refusal };
  // Two-tab Replay uses one source/node/sequence intent.
  let def = L.loop('QA two tab Replay');
  let loopId = await L.publish(api, def);
  let source = await L.run(api, loopId);
  await L.state(api, source.id, ['succeeded']);
  await L.until(async () => !!(await state(source.id)).finalizedAt);
  let before = await L.events(api, source.id);
  pages = await tabs(source.id);
  for (const p of pages) {
    await p.getByRole('button', { name: 'Replay...', exact: true }).click();
    await p.getByLabel('Replay from node').selectOption('done');
  }
  responses = await race(pages, source.id, 'replay', 'Create replay run');
  let fork = responses.find((r) => r.status === 202)?.body.run;
  L.check(
    'two Edge tabs admit exactly one Replay',
    responses
      .map((r) => r.status)
      .sort()
      .join() === '202,409' &&
      responses.find((r) => r.status === 409)?.body.code === 'RECOVERY_STALE' &&
      fork?.id !== source.id,
    responses,
  );
  await L.state(api, fork.id, ['succeeded']);
  L.check(
    'Replay leaves source history unchanged',
    JSON.stringify(before) === JSON.stringify(await L.events(api, source.id)),
  );
  E.twoTabReplay = { source, responses, fork };
  // Double click the actual Replay submit button.
  let double = await L.run(api, loopId);
  await L.state(api, double.id, ['succeeded']);
  await L.until(async () => !!(await state(double.id)).finalizedAt);
  let p = await browser.newPage();
  await p.goto(api.base + '/app/runs/' + double.id);
  await p.getByRole('button', { name: 'Replay...', exact: true }).click();
  await p.getByLabel('Replay from node').selectOption('done');
  let sent = [];
  p.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/replay')) sent.push(req.postDataJSON());
  });
  let ack = p.waitForResponse((r) => r.url().endsWith('/replay'));
  await p.getByRole('button', { name: 'Create replay run', exact: true }).dblclick();
  let result = await ack;
  let doubleFork = (await result.json()).run;
  await L.state(api, doubleFork.id, ['succeeded']);
  await L.sleep(300);
  L.check('double click submits one Replay', sent.length === 1 && result.status() === 202, {
    sent,
    fork: doubleFork,
  });
  E.doubleReplay = { sent, doubleFork };
  // Admission commits, gateway restarts, then a network fault loses the acknowledgement.
  const lostSource = await L.run(api, loopId);
  await L.state(api, lostSource.id, ['succeeded']);
  await L.until(async () => !!(await state(lostSource.id)).finalizedAt);
  const observed = await state(lostSource.id);
  const intent = { nodeId: 'done', observedSeq: observed.recovery.observedSeq };
  let admitted;
  proxy = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const b of req) body += b;
      const backend = await fetch(api.base + req.url, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body,
      });
      admitted = { status: backend.status, body: await backend.json() };
      await api.kill();
      await boot();
      res.destroy();
    } catch (error) {
      E.proxyError = String(error);
      res.destroy();
    }
  });
  await new Promise((r) => proxy.listen(6634, '127.0.0.1', r));
  let lost;
  try {
    await fetch(`http://127.0.0.1:6634/runs/${lostSource.id}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intent),
    });
    lost = false;
  } catch {
    lost = true;
  }
  await new Promise((r) => proxy.close(r));
  proxy = undefined;
  const repeat = await api.call('POST', `/runs/${lostSource.id}/replay`, intent);
  const list = (await api.get('/runs?limit=100')).items;
  let forks = [];
  for (const run of list) {
    let snap = await state(run.id);
    if (snap.recovery.replayOf?.runId === lostSource.id) forks.push(snap.id);
  }
  L.check(
    'lost Replay ack and restart retain exactly one admitted fork',
    lost &&
      admitted?.status === 202 &&
      repeat.status === 409 &&
      repeat.body.code === 'RECOVERY_STALE' &&
      forks.length === 1 &&
      forks[0] === admitted.body.run.id,
    { lost, admitted, repeat, forks },
  );
  E.lostAck = { lost, admitted, repeat, forks };
  // Explicit deletion approval is revoked by Resume and Replay through public routes.
  const marker = path.join(L.ROOT, 'delete-resume-marker');
  const release = path.join(L.ROOT, 'delete-resume-release');
  const failing = await L.run(
    api,
    await L.publish(
      api,
      L.loop('QA deletion Resume', [
        L.scriptNode(path.join(L.RECORD, 'effect.mjs'), ['exit', marker, release]),
      ]),
    ),
  );
  await L.state(api, failing.id, ['failed']);
  let marked = await mark(failing.id);
  let failed = await state(failing.id);
  fs.writeFileSync(release, 'fixed');
  await api.post(`/runs/${failing.id}/resume`, { observedSeq: failed.recovery.observedSeq });
  await L.state(api, failing.id, ['succeeded']);
  let preview = await api.post('/runs/deletion-eligibility/preview', { runIds: [failing.id] });
  L.check(
    'Resume revokes deletion approval',
    !!marked.items[0].approval && !preview.items[0].approval,
    { marked, preview },
  );
  E.deletionResume = { marked, preview };
  const deletionSource = await L.run(api, loopId);
  await L.state(api, deletionSource.id, ['succeeded']);
  marked = await mark(deletionSource.id);
  let observedSource = await state(deletionSource.id);
  let forked = await api.post(`/runs/${deletionSource.id}/replay`, {
    nodeId: 'done',
    observedSeq: observedSource.recovery.observedSeq,
  });
  preview = await api.post('/runs/deletion-eligibility/preview', { runIds: [deletionSource.id] });
  L.check(
    'Replay revokes source deletion approval',
    !!marked.items[0].approval && !preview.items[0].approval,
    { marked, preview, forked },
  );
  E.deletionReplay = { marked, preview, forked };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('race driver completed', false, E.error);
} finally {
  if (proxy) await new Promise((r) => proxy.close(r));
  if (browser) await browser.close();
  await L.cleanup();
  L.save(
    'race-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('race-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
