import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
const evidence = { states: {}, scenarios: {} };
let api, browser, client, transport;
const pages = [];
const effect = path.join(L.RECORD, 'effect.mjs');
const marker = (name) => path.join(L.ROOT, name + '.jsonl');
const release = (name) => path.join(L.ROOT, name + '.release');
const count = (name) =>
  fs.existsSync(marker(name)) ? fs.readFileSync(marker(name), 'utf8').trim().split('\n').length : 0;
const held = (name) => L.scriptNode(effect, ['hold', marker(name), release(name)]);
const exited = (name) => L.scriptNode(effect, ['exit', marker(name), release(name)]);
const snapshot = (id) => api.get(`/runs/${id}`);
async function view(name, run, node = 'script') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pages.push(page);
  await page.goto(api.base + '/app/runs/' + run.id);
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  const reason = await page.locator('#resume-reason-' + run.id).innerText();
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send('Accessibility.getFullAXTree');
  const ax = tree.nodes.find((n) => n.role?.value === 'button' && n.name?.value === 'Resume');
  await cdp.detach();
  const ui = { resumeDisabled: await resume.isDisabled(), reason, accessibleResume: ax };
  L.check(
    name + ' UI Resume agrees',
    ui.resumeDisabled === !run.recovery.resume.allowed &&
      (!ui.resumeDisabled || reason.includes(run.recovery.resume.message)),
    ui,
  );
  L.check(
    name + ' unavailable Resume has accessible explanation',
    !ui.resumeDisabled || !!ax?.description?.value?.includes(run.recovery.resume.message),
    ax,
  );
  await page.getByRole('button', { name: 'Replay...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
  const options = run.recovery.replay;
  ui.replay = [];
  for (const item of options) {
    await dialog.getByLabel('Replay from node').selectOption(item.nodeId);
    const text = await page.locator('#replay-reason-' + run.id).innerText();
    const disabled = await dialog.getByRole('button', { name: 'Create replay run' }).isDisabled();
    ui.replay.push({ nodeId: item.nodeId, disabled, text });
    L.check(
      name + ' UI Replay ' + item.nodeId,
      disabled === !item.action.allowed &&
        (item.action.allowed || text.includes(item.action.message)),
      { item, text, disabled },
    );
  }
  ui.dialog = await dialog.innerText();
  ui.aria = await dialog.ariaSnapshot();
  await dialog
    .getByLabel('Replay from node')
    .selectOption(options.some((i) => i.nodeId === node) ? node : options[0].nodeId);
  await page.screenshot({ path: path.join(L.RECORD, name + '.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const mcp = await client.callTool({ name: 'get_run', arguments: { runId: run.id } });
  let mcpRun = mcp.structuredContent;
  if (!mcpRun)
    try {
      mcpRun = JSON.parse(mcp.content.find((c) => c.type === 'text').text);
    } catch {}
  const actual = mcpRun?.run ?? mcpRun;
  L.check(
    name + ' HTTP/MCP recovery identical',
    JSON.stringify(actual?.recovery) === JSON.stringify(run.recovery),
    { http: run.recovery, mcp },
  );
  let refusal;
  if (!run.recovery.resume.allowed) {
    refusal = await api.call('POST', `/runs/${run.id}/resume`, {
      observedSeq: run.recovery.observedSeq,
    });
    L.check(
      name + ' HTTP Resume refusal agrees',
      refusal.status === 409 && refusal.body.code === run.recovery.resume.code,
      refusal,
    );
  }
  evidence.states[name] = { run, ui, mcp, refusal };
  L.save('behaviour-results.json', { checks: L.checks, evidence });
  return page;
}
try {
  api = await L.startApi('primary', 6660);
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(L.REPO, 'apps/mcp/dist/main.js'), '--api-url', api.base],
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GG_'))),
    stderr: 'pipe',
  });
  client = new Client({ name: 'pr422-independent-qa', version: '1' });
  await client.connect(transport);
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-first-run'] });
  evidence.environment = {
    node: process.version,
    nodePath: process.execPath,
    edge: browser.version(),
    apiPid: api.child.pid,
    mcpPid: transport.pid,
    root: L.ROOT,
  };
  // Stable running work, pause at input park, and a concurrent Resume.
  const running = await L.run(api, await L.publish(api, L.loop('QA running', [held('running')])));
  await L.until(() => count('running') === 1);
  await view('running', await snapshot(running.id));
  const parked = await L.run(api, await L.publish(api, L.loop('QA park', [L.waitNode()])));
  let waiting = await L.state(api, parked.id, ['waiting']);
  await view('waiting', waiting, 'park');
  await api.post(`/runs/${parked.id}/pause`);
  let paused = await L.state(api, parked.id, ['paused']);
  const parkPage = await view('paused', paused, 'park');
  const beforePark = await L.events(api, parked.id);
  const race = await Promise.all(
    [1, 2].map(() =>
      api.call('POST', `/runs/${parked.id}/resume`, { observedSeq: paused.recovery.observedSeq }),
    ),
  );
  waiting = await L.state(api, parked.id, ['waiting']);
  const afterPark = await L.events(api, parked.id);
  L.check(
    'concurrent Resume exactly one accepted',
    race
      .map((r) => r.status)
      .sort()
      .join() === '200,409' && race.find((r) => r.status === 409)?.body.code === 'RECOVERY_STALE',
    race,
  );
  L.check(
    'paused park preserves wait and visit identity',
    paused.waiting?.waitId === waiting.waiting?.waitId &&
      paused.waiting?.startedSeq === waiting.waiting?.startedSeq &&
      afterPark.filter((e) => e.type === 'node.started').length ===
        beforePark.filter((e) => e.type === 'node.started').length,
    { paused, waiting },
  );
  evidence.scenarios.park = { paused, waiting, race, beforePark, afterPark };
  await api.post(`/runs/${parked.id}/input`, { waitId: waiting.waiting.waitId, input: 'go' });
  await L.state(api, parked.id, ['succeeded']);
  await L.until(() => parkPage.locator('[data-status="succeeded"]').isVisible());
  L.check('open inspector follows paused Resume to success', true);
  fs.writeFileSync(release('running'), 'go');
  const succeeded = await L.state(api, running.id, ['succeeded']);
  await L.until(async () => !!(await snapshot(running.id)).finalizedAt);
  await view('succeeded', await snapshot(running.id));
  const cancel = await L.run(api, await L.publish(api, L.loop('QA cancel', [L.waitNode()])));
  await L.state(api, cancel.id, ['waiting']);
  await api.post(`/runs/${cancel.id}/cancel`);
  await view('cancelled', await L.state(api, cancel.id, ['cancelled']), 'park');
  // A real SCRIPT_EXIT_CODE, external program repaired, same run and visit.
  const bad = await L.run(
    api,
    await L.publish(api, L.loop('QA repair script', [exited('repair')])),
  );
  const failed = await L.state(api, bad.id, ['failed']);
  const failPage = await view('script-exit', failed);
  fs.writeFileSync(release('repair'), 'fixed');
  let before = await L.events(api, bad.id);
  await failPage.getByRole('button', { name: 'Resume', exact: true }).dblclick();
  let repaired = await L.state(api, bad.id, ['succeeded']);
  await L.until(() => failPage.locator('[data-status="succeeded"]').isVisible());
  let after = await L.events(api, bad.id);
  L.check(
    'SCRIPT_EXIT_CODE same run resumes once on double click',
    repaired.id === bad.id &&
      after.filter((e) => e.type === 'run.resumed').length === 1 &&
      count('repair') === 2,
    { repaired, count: count('repair'), after },
  );
  L.check(
    'Resume preserves definition thread and visit',
    failed.versionId === repaired.versionId &&
      new Set(after.filter((e) => e.type === 'script.dispatched').map((e) => e.visitId)).size ===
        1 &&
      JSON.stringify(before[0]) === JSON.stringify(after[0]),
    { before, after },
  );
  evidence.scenarios.scriptRepair = { failed, repaired, before, after };
  // Deadline is a real pinned elapsed deadline while parked.
  const deadline = await L.run(
    api,
    await L.publish(api, L.loop('QA deadline', [L.waitNode()], { runDeadlineSeconds: 1 })),
  );
  await view('deadline', await L.state(api, deadline.id, ['failed']), 'park');
  // Inference Replay and source-history preservation.
  const infer = await L.run(
    api,
    await L.publish(api, L.loop('QA inference replay', [L.inference()])),
  );
  await L.state(api, infer.id, ['succeeded']);
  await L.until(async () => !!(await snapshot(infer.id)).finalizedAt);
  let source = await snapshot(infer.id);
  before = await L.events(api, infer.id);
  const forks = await Promise.all(
    [1, 2].map(() =>
      api.call('POST', `/runs/${infer.id}/replay`, {
        nodeId: 'think',
        observedSeq: source.recovery.observedSeq,
      }),
    ),
  );
  const accepted = forks.find((r) => r.status === 202);
  L.check(
    'concurrent Replay exactly one linked fork',
    forks
      .map((r) => r.status)
      .sort()
      .join() === '202,409' &&
      forks.find((r) => r.status === 409)?.body.code === 'RECOVERY_STALE' &&
      accepted?.body.run.id !== infer.id,
    forks,
  );
  const fork = await L.state(api, accepted.body.run.id, ['succeeded']);
  await L.until(async () => !!(await snapshot(fork.id)).finalizedAt);
  after = await L.events(api, infer.id);
  L.check(
    'inference Replay leaves source execution history and deliveries unchanged',
    JSON.stringify(before) === JSON.stringify(after) &&
      JSON.stringify(source.deliveries) === JSON.stringify((await snapshot(infer.id)).deliveries),
    { before, after },
  );
  const repeat = await api.call('POST', `/runs/${infer.id}/replay`, {
    nodeId: 'think',
    observedSeq: source.recovery.observedSeq,
  });
  L.check(
    'repeated Replay links existing fork',
    repeat.status === 409 &&
      repeat.body.code === 'RECOVERY_STALE' &&
      JSON.stringify(repeat.body).includes(fork.id),
    repeat,
  );
  evidence.scenarios.inferenceReplay = {
    source,
    forks,
    fork,
    repeat,
    before,
    after,
    forkEvents: await L.events(api, fork.id),
  };
  await view('replayed-source', await snapshot(infer.id), 'think');
  // Parent owns a SCRIPT_EXIT_CODE child and retries the identical child.
  const childLoop = await L.publish(api, L.loop('QA child', [exited('child')]));
  const parentLoop = await L.publish(
    api,
    L.loop('QA parent', [
      {
        id: 'sub',
        kind: 'subloop',
        label: 'Child work',
        config: { loopRef: { loopId: childLoop, version: 'latest' } },
      },
    ]),
  );
  const parent = await L.run(api, parentLoop);
  let parentFailed = await L.state(api, parent.id, ['failed']);
  let children = (await api.get('/runs?parent=' + parent.id)).items;
  let child = await snapshot(children[0].id);
  await view('child-parent-owned', child);
  const parentPage = await view('parent-resumable', parentFailed, 'sub');
  fs.writeFileSync(release('child'), 'fixed');
  await parentPage.getByRole('button', { name: 'Resume', exact: true }).click();
  let parentDone = await L.state(api, parent.id, ['succeeded']);
  children = (await api.get('/runs?parent=' + parent.id)).items;
  L.check(
    'parent Resume retries exact child once',
    children.length === 1 &&
      children[0].id === child.id &&
      children[0].status === 'succeeded' &&
      count('child') === 2,
    { children, parentDone },
  );
  evidence.scenarios.parent = { parentFailed, child, parentDone, children };
  // Replay a subloop uses a new child run while the source retains its child.
  source = await snapshot(parent.id);
  before = await L.events(api, parent.id);
  const subFork = await api.post(`/runs/${parent.id}/replay`, {
    nodeId: 'sub',
    observedSeq: source.recovery.observedSeq,
  });
  await L.state(api, subFork.run.id, ['succeeded']);
  let forkChildren = (await api.get('/runs?parent=' + subFork.run.id)).items;
  L.check(
    'subloop Replay admits new child and preserves source',
    forkChildren.length === 1 &&
      forkChildren[0].id !== child.id &&
      JSON.stringify(before) === JSON.stringify(await L.events(api, parent.id)),
    { subFork, forkChildren },
  );
  evidence.scenarios.subloopReplay = { source, subFork, forkChildren };
} catch (error) {
  evidence.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('scenario driver completed', false, evidence.error);
} finally {
  if (browser) await browser.close();
  if (client) await client.close();
  await L.cleanup();
  L.save('behaviour-results.json', { checks: L.checks, evidence });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
