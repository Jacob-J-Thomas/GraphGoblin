import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
let api, server, browser, client;
let hit = false,
  hold = true;
const E = {};
try {
  server = createServer((req, res) => {
    hit = true;
    if (!hold) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ready":true}');
    }
  });
  await new Promise((r) => server.listen(6632, '127.0.0.1', r));
  api = await L.startApi('force-http', 6630);
  let id = (
    await L.run(
      api,
      await L.publish(
        api,
        L.loop('Force an HTTP probe', [
          {
            id: 'beat',
            kind: 'heartbeat',
            label: 'Local pending probe',
            config: {
              intervalSeconds: 1,
              probe: { kind: 'http', url: 'http://127.0.0.1:6632/probe', timeoutSeconds: 60 },
              until: 'true',
              maxBeats: 1,
            },
          },
        ]),
      ),
    )
  ).id;
  await L.until(() => hit);
  await api.post('/system/shutdown', { action: 'drain' });
  await api.post('/system/shutdown', { action: 'force' });
  await Promise.race([api.exit, L.sleep(10000)]);
  if (api.child.exitCode === null && api.child.signalCode === null)
    throw Error('HTTP force did not exit');
  api = await L.startApi('force-http', 6630);
  let run = await api.get('/runs/' + id);
  L.check(
    'force of real HTTP work records RUN_INTERRUPTED_BY_STOP',
    run.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && !run.recovery.resume.allowed,
    run,
  );
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(api.base + '/app/runs/' + id);
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await resume.waitFor();
  let reason = await page.locator('#resume-reason-' + id).innerText();
  let cdp = await page.context().newCDPSession(page);
  let ax = (await cdp.send('Accessibility.getFullAXTree')).nodes.find(
    (n) => n.role?.value === 'button' && n.name?.value === 'Resume',
  );
  let refused = await api.call('POST', `/runs/${id}/resume`, {
    observedSeq: run.recovery.observedSeq,
  });
  L.check(
    'ordinary forced run UI and command match with accessible reason',
    (await resume.isDisabled()) &&
      reason.includes(run.recovery.resume.message) &&
      ax.description.value.includes(run.recovery.resume.message) &&
      refused.body.code === run.recovery.resume.code,
    { reason, ax, refused },
  );
  await page.screenshot({ path: path.join(L.RECORD, 'force-interrupted-http.png') });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(L.REPO, 'apps/mcp/dist/main.js'), '--api-url', api.base],
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GG_'))),
    stderr: 'pipe',
  });
  client = new Client({ name: 'force-http-qa', version: '1' });
  await client.connect(transport);
  const mcp = await client.callTool({ name: 'get_run', arguments: { runId: id } });
  const mr = mcp.structuredContent ?? JSON.parse(mcp.content[0].text);
  L.check(
    'ordinary force MCP eligibility equals HTTP',
    JSON.stringify((mr.run ?? mr).recovery) === JSON.stringify(run.recovery),
    mcp,
  );
  E.mcpPid = transport.pid;
  hold = false;
  const replay = await api.post(`/runs/${id}/replay`, {
    nodeId: 'beat',
    observedSeq: run.recovery.observedSeq,
  });
  await L.state(api, replay.run.id, ['succeeded']);
  L.check(
    'explicit Replay after ordinary force creates new run',
    replay.run.id !== id &&
      (await api.get('/runs/' + id)).failure.code === 'RUN_INTERRUPTED_BY_STOP',
    replay,
  );
  E.details = { run, reason, ax, refused, mcp, replay };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('HTTP force scenario completed', false, E.error);
} finally {
  if (browser) await browser.close();
  if (client) await client.close();
  await L.cleanup();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  L.save(
    'force-http-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('force-http-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
