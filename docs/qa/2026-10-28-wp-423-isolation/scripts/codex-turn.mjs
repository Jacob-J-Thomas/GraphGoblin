// One Codex inference run through the built product on a disposable store, with the process tree
// under the gateway watched by PID for the whole run.
//   node codex-turn.mjs <label> <port> [--reenable] [--code-mode-host-off] [--fake-provider]
// --reenable       the node's configOverrides turn the machine's node_repl MCP server back on
// --code-mode-host-off  the node's configOverrides set features.code_mode_host=false (diagnostic)
// --fake-provider  dry run: the node's configOverrides point the CLI at a local server that holds
//                  every request open (no provider call); the run is failed by closing it
// A real run asks gpt-6-luna at low effort to run one short PowerShell command and reply DONE.
import { createServer } from 'node:net';
import * as L from './lib.mjs';

const [label, portText] = process.argv.slice(2);
const port = Number(portText);
const reenable = process.argv.includes('--reenable');
const fakeProvider = process.argv.includes('--fake-provider');
const rec = new L.Recorder(`codex-${label}`);
const dir = L.makeStore(`codex-${label}`);
const marker = `gg423${label.replace(/[^a-z0-9]/gi, '')}${Date.now().toString(36)}`;
const template =
  `Run exactly this shell command and wait for it to finish: powershell -NoProfile -Command "Start-Sleep -Seconds 12; Write-Output ${marker}". ` +
  'Then reply with exactly the word DONE and nothing else.';

let fake;
const configOverrides = {};
if (reenable) configOverrides.mcp_servers = { node_repl: { enabled: true } };
// --code-mode-host-off: diagnostic only, the node switches the CLI's own code-mode host off.
if (process.argv.includes('--code-mode-host-off')) configOverrides.features = { code_mode_host: false };
if (fakeProvider) {
  const held = new Set();
  const server = createServer((socket) => {
    held.add(socket);
    socket.on('error', () => undefined);
    socket.pause();
  });
  const fakePort = port + 1;
  await new Promise((resolve) => server.listen(fakePort, '127.0.0.1', resolve));
  fake = { server, held };
  Object.assign(configOverrides, {
    model_provider: 'gg423hold',
    model_providers: {
      gg423hold: {
        name: 'gg423 local hold (no provider)',
        base_url: `http://127.0.0.1:${fakePort}/v1`,
        wire_api: 'responses',
        request_max_retries: 0,
        stream_max_retries: 0,
      },
    },
  });
}

const config = {
  harness: 'codex',
  model: 'gpt-6-luna',
  effort: 'low',
  harnessOptions: {
    sandbox: 'workspace-write',
    approval: 'never',
    ...(Object.keys(configOverrides).length ? { configOverrides } : {}),
  },
  prompt: { template },
};

let gateway;
let watch;
try {
  gateway = await L.startGateway({ dir, port, label: 'a', rec });
  watch = L.watchTree(gateway.pid);
  const loopId = await L.publishLoop(gateway.call, L.oneInference(`WP-423 ${label}`, config));
  rec.log('published', { loopId, configOverrides: Object.keys(configOverrides).length ? configOverrides : null });
  const runId = await L.startRun(gateway.call, loopId);
  rec.log('run started', { runId, marker });

  // In flight: the marker command (real) or the CLI after its session start (dry run).
  let inFlight;
  const deadline = Date.now() + (fakeProvider ? 30_000 : 240_000);
  let cliSeenAt;
  while (Date.now() < deadline) {
    const tree = watch.latest();
    const cli = tree.find((p) => /^codex\.exe$/i.test(p.name) && / exec /.test(p.cmd));
    if (cli && !cliSeenAt) cliSeenAt = Date.now();
    if (!fakeProvider && tree.some((p) => p.cmd.includes(marker) && /powershell/i.test(p.name))) {
      await L.sleep(1500);
      inFlight = watch.latest();
      break;
    }
    if (fakeProvider && cliSeenAt && Date.now() - cliSeenAt > 8000) {
      inFlight = watch.latest();
      break;
    }
    const run = (await gateway.call(`/runs/${runId}`)).json;
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break;
    await L.sleep(200);
  }
  const cli = inFlight?.find((p) => /^codex\.exe$/i.test(p.name) && / exec /.test(p.cmd));
  rec.log('in flight: process tree under the gateway (names and PIDs)', {
    snapshotFound: Boolean(inFlight),
    tree: (inFlight ?? []).map((p) => ({ ...L.plain([p])[0], role: L.role(p, marker) })),
  });
  rec.log('the turn CLI received these --config arguments', { args: cli ? L.configArgs(cli.cmd) : null });
  if (fake) for (const s of fake.held) s.destroy();

  let run;
  for (let i = 0; i < 1200; i++) {
    run = (await gateway.call(`/runs/${runId}`)).json;
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break;
    await L.sleep(250);
  }
  await L.sleep(1500); // let a turn-end program (notify) appear in at least one snapshot
  const evs = await L.events(gateway.call, runId);
  const turns = evs.filter((e) => e.type === 'harness.turn').length;
  const reply = evs
    .filter((e) => e.type === 'node.finished' && e.nodeId === 'infer')
    .map((e) => (e.patch ?? []).find((o) => o.path === '/lastOutput')?.value);
  const commands = evs
    .filter((e) => e.type === 'node.progress' && e.progress?.item?.type === 'command')
    .map((e) => ({ status: e.progress.item.status, exitCode: e.progress.item.exitCode }));
  rec.log('run finished', {
    status: run.status,
    failure: run.failure ? { code: run.failure.code, message: String(run.failure.message).slice(0, 300) } : null,
    harnessTurns: turns,
    reply,
    commands,
  });
  if (!fakeProvider && turns > 0)
    rec.turn({ harness: 'codex', model: 'gpt-6-luna', effort: 'low', label, runId, turns });

  const seen = watch.seen().map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    name: p.name,
    depth: p.depth,
    role: L.role(p, marker),
  }));
  const listing = watch.seen().find((p) => L.role(p, marker) === 'mcp-listing' && /codex\.exe$/i.test(p.name));
  rec.log('the MCP listing CLI received these --config arguments', {
    args: listing ? L.configArgs(listing.cmd) : null,
  });
  rec.log('every process seen under the gateway during the run (names, PIDs, parents)', {
    snapshots: watch.snapshots(),
    seen,
  });
  const names = new Set((inFlight ?? []).map((p) => p.name.toLowerCase()));
  const seenNames = new Set(seen.map((p) => p.name.toLowerCase()));
  rec.log('names in flight', [...names].sort());
  rec.log('names seen during the run', [...seenNames].sort());
  rec.check('the run reached a terminal state', ['succeeded', 'failed', 'cancelled'].includes(run.status), {
    status: run.status,
  });
  if (!fakeProvider)
    rec.check('the turn ran the marker command under the Codex CLI', seen.some((p) => p.role === 'marker-command'), {});
} finally {
  watch?.stop();
  if (gateway) {
    rec.log('gateway stop', { exit: await gateway.stop() });
    gateway.copyLog(`codex-${label}-gateway.log.txt`);
  }
  if (fake) fake.server.close();
  L.removeCodexSessions(dir, rec);
  L.removeStore(dir, rec);
  rec.finish({ label, reenable, fakeProvider });
}
