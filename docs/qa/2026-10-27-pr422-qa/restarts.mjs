import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
const E = { states: {}, scenarios: {} };
let api, browser, client, transport, proxy;
const effect = path.join(L.RECORD, 'effect.mjs');
const marker = (n) => path.join(L.ROOT, n + '.jsonl');
const release = (n) => path.join(L.ROOT, n + '.release');
const count = (n) =>
  fs.existsSync(marker(n)) ? fs.readFileSync(marker(n), 'utf8').trim().split('\n').length : 0;
const held = (n) => L.scriptNode(effect, ['hold', marker(n), release(n)]);
async function inspect(name, id) {
  const run = await api.get('/runs/' + id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(api.base + '/app/runs/' + id);
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  const button = page.getByRole('button', { name: 'Resume', exact: true });
  const reason = await page.locator('#resume-reason-' + id).innerText();
  const cdp = await page.context().newCDPSession(page);
  const ax = (await cdp.send('Accessibility.getFullAXTree')).nodes.find(
    (n) => n.role?.value === 'button' && n.name?.value === 'Resume',
  );
  await cdp.detach();
  L.check(
    name + ' Resume and accessible explanation agree',
    (await button.isDisabled()) === !run.recovery.resume.allowed &&
      (run.recovery.resume.allowed ||
        (reason.includes(run.recovery.resume.message) &&
          ax?.description?.value.includes(run.recovery.resume.message))),
    { run: run.recovery, reason, ax },
  );
  const mcp = await client.callTool({ name: 'get_run', arguments: { runId: id } });
  const mr = mcp.structuredContent ?? JSON.parse(mcp.content[0].text);
  L.check(
    name + ' MCP/HTTP agree',
    JSON.stringify((mr.run ?? mr).recovery) === JSON.stringify(run.recovery),
    mcp,
  );
  let refusal, mcpRefusal;
  if (!run.recovery.resume.allowed) {
    refusal = await api.call('POST', `/runs/${id}/resume`, {
      observedSeq: run.recovery.observedSeq,
    });
    mcpRefusal = await client.callTool({
      name: 'resume_run',
      arguments: { runId: id, observedSeq: run.recovery.observedSeq },
    });
    L.check(
      name + ' HTTP/MCP Resume refusal agrees',
      refusal.status === 409 &&
        refusal.body.code === run.recovery.resume.code &&
        JSON.stringify(mcpRefusal).includes(run.recovery.resume.code),
      { refusal, mcpRefusal },
    );
  }
  await page.getByRole('button', { name: 'Replay...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
  const replay = [];
  for (const n of run.recovery.replay) {
    await dialog.getByLabel('Replay from node').selectOption(n.nodeId);
    let text = await page.locator('#replay-reason-' + id).innerText();
    let disabled = await dialog.getByRole('button', { name: 'Create replay run' }).isDisabled();
    let live = await page.locator('#replay-reason-' + id).getAttribute('aria-live');
    L.check(
      name + ' Replay ' + n.nodeId + ' and live reason agree',
      disabled === !n.action.allowed &&
        (n.action.allowed || (text.includes(n.action.message) && live === 'polite')),
      { n, text, disabled, live },
    );
    replay.push({ nodeId: n.nodeId, text, disabled, live });
  }
  await page.screenshot({ path: path.join(L.RECORD, name + '.png') });
  const wording = await dialog.innerText();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  E.states[name] = { run, reason, ax, mcp, refusal, mcpRefusal, replay, wording };
  return { page, run };
}
async function boot() {
  api = await L.startApi('restart-store', 6661);
  return api;
}
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
async function removeSession(id) {
  const reqs = fs
    .readFileSync(path.join(L.CLI, 'requests.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  const req = reqs.findLast((r) => r.prompt.includes(id));
  fs.unlinkSync(path.join(L.CLI, 'sessions', req.sessionId));
  return req;
}
async function answer(id) {
  const s = await api.get('/runs/' + id);
  return api.post(`/runs/${id}/input`, { waitId: s.waiting.waitId, input: 'go' });
}
try {
  await boot();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-first-run'] });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(L.REPO, 'apps/mcp/dist/main.js'), '--api-url', api.base],
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GG_'))),
    stderr: 'pipe',
  });
  client = new Client({ name: 'pr422-restart-qa', version: '1' });
  await client.connect(transport);
  E.environment = { edge: browser.version(), node: process.version, mcpPid: transport.pid };
  const exhaustedDef = L.loop('QA exhausted');
  exhaustedDef.nodes.at(-1).config = { outcome: 'exhausted', returns: '"QA exhausted value"' };
  const exhausted = await L.run(api, await L.publish(api, exhaustedDef));
  await L.state(api, exhausted.id, ['exhausted']);
  await inspect('exhausted', exhausted.id);
  // Real process crash after one external effect, then restart, no automatic retry.
  const uncertain = await L.run(
    api,
    await L.publish(api, L.loop('QA uncertain', [held('uncertain')])),
  );
  await L.until(() => count('uncertain') === 1);
  const preCrash = await api.get('/runs/' + uncertain.id);
  await api.kill();
  fs.writeFileSync(release('uncertain'), 'release original');
  await boot();
  let failed = await L.state(api, uncertain.id, ['failed']);
  await L.sleep(500);
  L.check(
    'crash restart preserves uncertain effect without retry',
    failed.failure?.code === 'SCRIPT_OUTCOME_UNCERTAIN' && count('uncertain') === 1,
    { failed, count: count('uncertain') },
  );
  let { page } = await inspect('uncertain-script', uncertain.id);
  await page.getByRole('button', { name: 'Recover script', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Recover script', exact: true });
  let consentText = await dialog.innerText();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  L.check(
    'cancelling script consent has no effect',
    count('uncertain') === 1 && (await api.get('/runs/' + uncertain.id)).status === 'failed',
    consentText,
  );
  await page.getByRole('button', { name: 'Replay...', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
  await dialog.getByLabel('Replay from node').selectOption('start');
  L.check(
    'earlier-node Replay requires uncertain-script checkbox',
    (await dialog.getByRole('button', { name: 'Create replay run' }).isDisabled()) &&
      (await dialog.getByRole('checkbox', { name: /I explicitly allow/ }).isVisible()),
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  fs.unlinkSync(release('uncertain'));
  await page.getByRole('button', { name: 'Recover script', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Recover script', exact: true })
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await L.until(() => count('uncertain') === 2);
  await L.until(() => page.locator('[data-status="running"]').isVisible());
  fs.writeFileSync(release('uncertain'), 'finish');
  let resumed = await L.state(api, uncertain.id, ['succeeded']);
  await L.until(() => page.locator('[data-status="succeeded"]').isVisible());
  let ev = await L.events(api, uncertain.id);
  L.check(
    'uncertain script consent resumes same visit and inspector follows',
    ev.filter((e) => e.type === 'run.resumed').length === 1 &&
      ev.find((e) => e.type === 'run.resumed')?.retryUncertainScript === true &&
      new Set(ev.filter((e) => e.type === 'script.dispatched').map((e) => e.visitId)).size === 1,
    { resumed, events: ev },
  );
  E.scenarios.uncertain = { preCrash, failed, resumed, consentText, events: ev };
  // Managed force records non-resumable stop and requires separate deliberate Replay.
  const forced = await L.run(api, await L.publish(api, L.loop('QA force', [held('forced')])));
  await L.until(() => count('forced') === 1);
  await api.post('/system/shutdown', { action: 'drain' });
  await api.post('/system/shutdown', { action: 'force' });
  await api.exit;
  await boot();
  failed = await L.state(api, forced.id, ['failed']);
  await inspect('interrupted-by-force', forced.id);
  L.check(
    'force remains non-resumable after restart',
    failed.failure?.code === 'RUN_INTERRUPTED_BY_STOP' &&
      failed.recovery.resume.allowed === false &&
      count('forced') === 1,
    failed,
  );
  fs.writeFileSync(release('forced'), 'finish');
  let blocked = await api.call('POST', `/runs/${forced.id}/replay`, {
    nodeId: 'script',
    observedSeq: failed.recovery.observedSeq,
  });
  let fork = await api.call('POST', `/runs/${forced.id}/replay`, {
    nodeId: 'script',
    observedSeq: failed.recovery.observedSeq,
    retryUncertainScript: true,
  });
  L.check(
    'forced uncertain script Replay requires consent and creates separate run',
    blocked.status === 409 &&
      blocked.body.code === 'SCRIPT_CONSENT_REQUIRED' &&
      fork.status === 202 &&
      fork.body.run.id !== forced.id,
    { blocked, fork },
  );
  if (fork.status === 202) await L.state(api, fork.body.run.id, ['succeeded']);
  E.scenarios.force = { failed, blocked, fork };
  // Real fake-provider conversation disappears between visits. Explicit fresh choice only.
  const missing = await L.run(api, await L.publish(api, ownLoop('QA missing session')));
  await L.state(api, missing.id, ['waiting']);
  let request = await removeSession(missing.id);
  await answer(missing.id);
  failed = await L.state(api, missing.id, ['failed']);
  let observed = await inspect('missing-session', missing.id);
  L.check(
    'missing session has explicit fresh-session control',
    await observed.page.getByRole('button', { name: /Start fresh session/ }).isVisible(),
    failed.failure,
  );
  let failureSeq = (await L.events(api, missing.id)).findLast((e) => e.type === 'run.failed').seq;
  let choice = await api.call('POST', `/runs/${missing.id}/recover-session`, {
    nodeId: 'think',
    failureSeq,
  });
  let fresh = await L.state(api, missing.id, ['waiting']);
  L.check(
    'fresh-session choice recovers same run',
    choice.status === 200 && fresh.id === missing.id,
    { request, failed, choice, fresh },
  );
  await answer(missing.id);
  await L.state(api, missing.id, ['succeeded']);
  E.scenarios.missing = { request, failed, choice, fresh, events: await L.events(api, missing.id) };
  // Missing session in an identified child, explicit child choice then parent Resume.
  let childLoop = await L.publish(api, ownLoop('QA child missing'));
  let parent = await L.run(
    api,
    await L.publish(
      api,
      L.loop('QA parent missing', [
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
  await removeSession(child.id);
  await answer(child.id);
  await L.state(api, child.id, ['failed']);
  let parentFailed = await L.state(api, parent.id, ['failed']);
  await inspect('parent-missing-session', parent.id);
  await inspect('child-missing-session', child.id);
  failureSeq = (await L.events(api, child.id)).findLast((e) => e.type === 'run.failed').seq;
  choice = await api.call('POST', `/runs/${child.id}/recover-session`, {
    nodeId: 'think',
    failureSeq,
  });
  await L.state(api, child.id, ['waiting']);
  let parentReady = await api.get('/runs/' + parent.id);
  let parentResume = await api.call('POST', `/runs/${parent.id}/resume`, {
    observedSeq: parentReady.recovery.observedSeq,
  });
  await answer(child.id);
  let parentDone = await L.state(api, parent.id, ['succeeded']);
  L.check(
    'missing child choice then parent Resume retains exact child',
    choice.status === 200 &&
      parentResume.status === 200 &&
      (await api.get('/runs?parent=' + parent.id)).items.length === 1,
    { parentFailed, choice, parentReady, parentResume, parentDone },
  );
  E.scenarios.childMissing = { child, parentFailed, choice, parentReady, parentResume, parentDone };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('restart driver completed', false, E.error);
} finally {
  if (proxy) await new Promise((r) => proxy.close(r));
  if (browser) await browser.close();
  if (client) await client.close();
  await L.cleanup();
  L.save(
    'restart-processes.json',
    L.processes.map((p) => ({
      name: p.name,
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('restart-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
