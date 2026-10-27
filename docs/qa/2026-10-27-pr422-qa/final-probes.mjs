import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { Client } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import * as L from './lib.mjs';
let api, proxy, client;
const E = {};
let heldPid;
async function boot() {
  api = await L.startApi('final-probes', 6663);
}
try {
  await boot();
  let parked = await L.run(api, await L.publish(api, L.loop('Lost Resume ack', [L.waitNode()])));
  await L.state(api, parked.id, ['waiting']);
  await api.post(`/runs/${parked.id}/pause`);
  let paused = await L.state(api, parked.id, ['paused']);
  let accepted;
  proxy = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    let r = await api.call(req.method, req.url, JSON.parse(body));
    accepted = r;
    await L.state(api, parked.id, ['waiting']);
    await api.stop();
    await boot();
    res.destroy();
  });
  await new Promise((r) => proxy.listen(6664, '127.0.0.1', r));
  let lost = false;
  try {
    await fetch(`http://127.0.0.1:6664/runs/${parked.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observedSeq: paused.recovery.observedSeq }),
    });
  } catch {
    lost = true;
  }
  await new Promise((r) => proxy.close(r));
  proxy = undefined;
  let repeated = await api.call('POST', `/runs/${parked.id}/resume`, {
    observedSeq: paused.recovery.observedSeq,
  });
  let ev = await L.events(api, parked.id);
  L.check(
    'lost Resume ack and restart retain exactly one continuation',
    lost &&
      accepted.status === 200 &&
      repeated.status === 409 &&
      repeated.body.code === 'RECOVERY_STALE' &&
      ev.filter((e) => e.type === 'run.resumed').length === 1 &&
      (await api.get('/runs/' + parked.id)).waiting.waitId === paused.waiting.waitId,
    { lost, accepted, repeated, events: ev },
  );
  E.resumeAck = { paused, lost, accepted, repeated, events: ev };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(L.REPO, 'apps/mcp/dist/main.js'), '--api-url', api.base],
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GG_'))),
    stderr: 'pipe',
  });
  client = new Client({ name: 'pr422-final-qa', version: '1' });
  await client.connect(transport);
  E.mcpPid = transport.pid;
  await api.post(`/runs/${parked.id}/pause`);
  paused = await L.state(api, parked.id, ['paused']);
  let mcpResume = await client.callTool({
    name: 'resume_run',
    arguments: { runId: parked.id, observedSeq: paused.recovery.observedSeq },
  });
  let resumed = await L.state(api, parked.id, ['waiting']);
  L.check(
    'MCP Resume accepts eligible observation and retains ID',
    !mcpResume.isError && JSON.stringify(mcpResume).includes(parked.id) && resumed.id === parked.id,
    mcpResume,
  );
  let source = await L.run(api, await L.publish(api, L.loop('MCP Replay')));
  await L.state(api, source.id, ['succeeded']);
  await L.until(async () => !!(await api.get('/runs/' + source.id)).finalizedAt);
  source = await api.get('/runs/' + source.id);
  let args = { runId: source.id, nodeId: 'done', observedSeq: source.recovery.observedSeq };
  let mcpReplay = await client.callTool({ name: 'replay_run', arguments: args });
  let repeat = await client.callTool({ name: 'replay_run', arguments: args });
  L.check(
    'MCP Replay accepts then reports RECOVERY_STALE for repeated intent',
    !mcpReplay.isError && repeat.isError && JSON.stringify(repeat).includes('RECOVERY_STALE'),
    { mcpReplay, repeat },
  );
  E.mcp = { mcpResume, mcpReplay, repeat };
  // A held fake Claude CLI exercises ordinary force independently of script-host cleanup.
  L.control('hold.txt', 'QA worker');
  let forced = await L.run(
    api,
    await L.publish(api, L.loop('Force held fake CLI', [L.inference()])),
  );
  await L.until(() => {
    if (!fs.existsSync(path.join(L.CLI, 'requests.jsonl'))) return false;
    let requests = fs
      .readFileSync(path.join(L.CLI, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    let r = requests.findLast((r) => r.prompt.includes(forced.id));
    if (r) heldPid = r.pid;
    return !!r;
  });
  await L.sleep(100);
  await api.post('/system/shutdown', { action: 'drain' });
  await api.post('/system/shutdown', { action: 'force' });
  await Promise.race([api.exit, L.sleep(8000)]);
  let forceState;
  if (api.child.exitCode === null && api.child.signalCode === null) {
    forceState = await api.get('/system/shutdown');
    await api.post('/system/shutdown', { action: 'force' });
    await api.exit;
  }
  L.control('hold.txt');
  await boot();
  let failure = await api.get('/runs/' + forced.id);
  L.check(
    'held fake CLI force records RUN_INTERRUPTED_BY_STOP and forbids Resume',
    failure.failure?.code === 'RUN_INTERRUPTED_BY_STOP' && !failure.recovery.resume.allowed,
    { forceState, failure },
  );
  let refused = await api.call('POST', `/runs/${forced.id}/resume`, {
    observedSeq: failure.recovery.observedSeq,
  });
  L.check(
    'force refusal agrees with recovery',
    refused.status === 409 && refused.body.code === failure.recovery.resume.code,
    refused,
  );
  E.force = { heldPid, forceState, failure, refused };
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('final probes completed', false, E.error);
} finally {
  L.control('hold.txt');
  if (proxy) await new Promise((r) => proxy.close(r));
  if (client) await client.close();
  await L.cleanup();
  if (heldPid) {
    try {
      process.kill(heldPid);
      E.heldPidEnded = true;
    } catch {
      E.heldPidAlreadyExited = true;
    }
  }
  L.save(
    'final-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('final-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
