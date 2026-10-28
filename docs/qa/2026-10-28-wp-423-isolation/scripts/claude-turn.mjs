// One Claude inference run through the built product on a disposable store (claude-haiku-5-5 at
// low, read-only), with the process tree under the gateway watched by PID for the whole run, and
// the CLI's own arguments read from its command line.
//   node claude-turn.mjs <label> <port>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const [label, portText] = process.argv.slice(2);
const port = Number(portText);
const rec = new L.Recorder(`claude-${label}`);
const dir = L.makeStore(`claude-${label}`);
const config = {
  harness: 'claude',
  model: 'claude-haiku-5-5',
  effort: 'low',
  harnessOptions: { sandbox: 'read-only', approval: 'never' },
  prompt: { template: 'Reply with exactly the word DONE and nothing else.' },
};

let gateway;
let watch;
let fast;
try {
  gateway = await L.startGateway({ dir, port, label: 'a', rec });
  watch = L.watchTree(gateway.pid);
  // A second, name-filtered poller catches the command lines of short-lived children.
  fast = L.watchTree(gateway.pid, { names: ["claude.exe", "reg.exe", "where.exe"], sleepMs: 20 });
  const loopId = await L.publishLoop(gateway.call, L.oneInference(`WP-423 Claude ${label}`, config));
  const runId = await L.startRun(gateway.call, loopId);
  rec.log('run started', { runId });
  let run;
  for (let i = 0; i < 1200; i++) {
    run = (await gateway.call(`/runs/${runId}`)).json;
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) break;
    await L.sleep(200);
  }
  await L.sleep(1000);
  const evs = await L.events(gateway.call, runId);
  const reply = evs
    .filter((e) => e.type === 'node.finished' && e.nodeId === 'infer')
    .map((e) => (e.patch ?? []).find((o) => o.path === '/lastOutput')?.value);
  const policy = evs
    .filter((e) => e.type === 'node.progress' && e.progress?.item?.id === 'claude-policy')
    .map((e) => ({ summary: e.progress.item.summary, status: e.progress.item.status }));
  rec.log('run finished', {
    status: run.status,
    failure: run.failure ? { code: run.failure.code, message: String(run.failure.message).slice(0, 300) } : null,
    harnessTurns: evs.filter((e) => e.type === 'harness.turn').length,
    reply,
    policyEvidence: policy,
  });
  if (evs.some((e) => e.type === 'harness.turn'))
    rec.turn({ harness: 'claude', model: 'claude-haiku-5-5', effort: 'low', label, runId });

  const slow = watch.seen();
  const seen = [...slow, ...fast.seen().filter((f) => !slow.some((s) => s.pid === f.pid))];
  for (const p of seen) p.cmd ||= fast.seen().find((q) => q.pid === p.pid)?.cmd ?? '';
  const cli = seen.find((p) => /^claude\.exe$/i.test(p.name) && / --print/.test(p.cmd));
  const flags = cli
    ? [...cli.cmd.matchAll(/ (--[a-z-]+)/g)].map((m) => m[1]).filter((f, i, a) => a.indexOf(f) === i)
    : null;
  rec.log('the turn CLI received these flags (names only)', { flags });
  rec.log('every process seen under the gateway during the run (names, PIDs, parents)', {
    snapshots: watch.snapshots(),
    seen: seen.map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      name: p.name,
      depth: p.depth,
      role:
        cli && p.pid === cli.pid
          ? 'turn-cli'
          : / auth status /.test(p.cmd)
            ? 'auth-check'
            : / --version| --help/.test(p.cmd)
              ? 'preflight'
              : undefined,
    })),
  });
  const underCli = cli ? seen.filter((p) => p.ppid === cli.pid || seen.some((q) => q.pid === p.ppid && q.ppid === cli.pid)) : [];
  // What each child is, without its full command line: flag names, and for where.exe and reg.exe
  // the program or registry key they look up (profile paths redacted).
  const shape = (p) => {
    const cmd = fast.seen().find((q) => q.pid === p.pid)?.cmd || p.cmd;
    const tokens = cmd.match(/"[^"]*"|\S+/g) ?? [];
    const flags = tokens.filter((t) => /^-{1,2}[A-Za-z]/.test(t)).map((t) => t.split('=')[0]);
    const lookup = /^(where|reg)\.exe$/i.test(p.name) ? tokens.slice(1).filter((t) => !/^\//.test(t)).slice(0, 3) : [];
    return { pid: p.pid, ppid: p.ppid, name: p.name, flags, lookup };
  };
  rec.log('processes under the turn CLI', underCli.map(shape));
  rec.check('the run succeeded', run.status === 'succeeded', { status: run.status });
  rec.check(
    'no MCP server, hook or plugin program (node, npx, cmd, PowerShell, Python) ran under the turn CLI',
    cli && underCli.every((p) => !/^(node|npx|cmd|powershell|pwsh|python|uv|uvx|bash)(\.exe)?$/i.test(p.name)),
    { names: underCli.map((p) => p.name) },
  );
} finally {
  watch?.stop();
  fast?.stop();
  if (gateway) {
    rec.log('gateway stop', { exit: await gateway.stop() });
    gateway.copyLog(`claude-${label}-gateway.log.txt`);
  }
  L.removeStore(dir, rec);
  // The CLI's own session folder for this store's workspace (named after its path), if it wrote one.
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const mine = fs.existsSync(projects)
    ? fs.readdirSync(projects).filter((name) => name.includes(path.basename(dir)))
    : [];
  for (const name of mine) fs.rmSync(path.join(projects, name), { recursive: true, force: true });
  rec.log("removed this store's Claude session folders", { count: mine.length, folders: mine });
  rec.finish({ label });
}
