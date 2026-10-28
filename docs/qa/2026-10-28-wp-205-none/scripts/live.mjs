// WP-205 live check: ONE real Codex turn, gpt-6-luna at effort none, through the built product on a
// disposable store (%TEMP%\gg-205-live-*, port 6309). The gateway runs the CLI bundled with the
// SDK (no GG_CODEX_BINARY) with GG_LOG_LEVEL=debug. Evidence:
//   - the run record and its events (requested effort none);
//   - the codex.exe command line, read from Win32_Process while the turn runs (the CLI argument);
//   - the gateway's debug line `codex: reasoning effort sent to the CLI`;
//   - the CLI's own session record (only its model and effort fields are read), which is then
//     removed: only rollouts created during this check whose session cwd is inside this store.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const rec = new L.Recorder('live');
const dir = L.makeStore('live');
const gateways = [];
let watcher;
const t0 = Date.now();

/** codex.exe processes started by the gateway (or naming this store), sampled every 100 ms. */
function watchCodex(gateway) {
  const seen = new Map();
  const script =
    "while ($true) { $p = @(Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine); " +
    "if ($p.Count -gt 0) { ConvertTo-Json -InputObject $p -Compress } ; Write-Output '---'; Start-Sleep -Milliseconds 100 }";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  L.started.add(child.pid);
  const store = dir.toLowerCase();
  let buffer = '';
  let ticks = 0;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '---') {
        ticks++;
        continue;
      }
      if (!line.trim().startsWith('[')) continue;
      let list;
      try {
        list = JSON.parse(line);
      } catch {
        continue;
      }
      for (const p of list) {
        const cmd = p.CommandLine ?? '';
        if (seen.has(p.ProcessId)) continue;
        if (p.ParentProcessId !== gateway.pid && !cmd.toLowerCase().includes(store)) continue;
        if (!/\bexec\b/.test(cmd)) continue;
        seen.set(p.ProcessId, {
          pid: p.ProcessId,
          parentIsGateway: p.ParentProcessId === gateway.pid,
          model: /--model\s+("?)([^\s"]+)\1/.exec(cmd)?.[2] ?? null,
          effortArgument: /model_reasoning_effort=\\?"?[a-z]+\\?"?/.exec(cmd)?.[0] ?? null,
        });
      }
    }
  });
  return {
    pid: child.pid,
    ticks: () => ticks,
    async stop() {
      await L.sleep(300);
      L.endPid(child.pid);
      L.started.delete(child.pid);
      return [...seen.values()];
    },
  };
}

/** Rollout files under ~/.codex/sessions changed since t0 whose session cwd is inside `dir`. */
function ownRollouts() {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const found = [];
  const walk = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.startsWith('rollout-') && fs.statSync(file).mtimeMs >= t0 - 1000) {
        const first = fs.readFileSync(file, 'utf8').split('\n')[0] ?? '';
        let cwd;
        try {
          cwd = JSON.parse(first)?.payload?.cwd;
        } catch {
          cwd = undefined;
        }
        if (typeof cwd === 'string' && cwd.toLowerCase().startsWith(dir.toLowerCase()))
          found.push(file);
      }
    }
  };
  // Today's and yesterday's local-date folders only.
  for (const offset of [0, -1]) {
    const day = new Date(Date.now() + offset * 86_400_000);
    walk(
      path.join(
        root,
        String(day.getFullYear()),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0'),
      ),
    );
  }
  return found;
}

try {
  const g = await L.startGateway({
    dir,
    port: 6309,
    label: 'live',
    rec,
    env: { GG_LOG_LEVEL: 'debug' },
  });
  gateways.push(g);
  const preflight = (await g.call('/harness/preflight')).json;
  const codex = (preflight.items ?? preflight).find?.((i) => i.harness === 'codex');
  rec.log('codex preflight', { state: codex?.state, ok: codex?.ok, version: codex?.version });
  const loopId = await L.publishLoop(
    g.call,
    L.single(
      'WP-205 live none',
      L.inferenceNode('work', { model: 'gpt-6-luna', effort: 'none' }),
    ),
  );
  watcher = watchCodex(g);
  await L.waitFor(() => watcher.ticks() > 0, { timeoutMs: 20_000 });
  const started = await g.call(`/loops/${loopId}/runs`, { method: 'POST', body: { input: null } });
  const runId = started.json?.run?.id;
  rec.turn({ n: 1, harness: 'codex', model: 'gpt-6-luna', effort: 'none', runId, prompt: 'one line' });
  const run = await L.waitRun(g.call, runId, ['succeeded', 'failed', 'cancelled'], 240_000);
  const invocations = await watcher.stop();
  watcher = undefined;
  const events = await L.events(g.call, runId);
  const sessions = events
    .filter((e) => e.type === 'harness.session')
    .map(({ type, harness, model, effort, mode }) => ({ type, harness, model, effort, mode }));
  const output = events.find((e) => e.type === 'node.completed' && e.nodeId === 'work');
  rec.check(
    'L-1 the real gpt-6-luna turn at none completed and the run succeeded',
    run.status === 'succeeded',
    { status: run.status, failure: run.failure ?? null, eventTypes: events.map((e) => e.type) },
  );
  rec.check(
    'L-2 the run record shows the requested effort none (harness.session)',
    sessions.length === 1 && sessions[0].effort === 'none' && sessions[0].model === 'gpt-6-luna',
    sessions,
  );
  rec.observe('L-3 the node output (final text, first 80 characters)', {
    text: JSON.stringify(output?.output ?? null).slice(0, 80),
  });
  rec.check(
    'L-4 the Codex CLI received --config model_reasoning_effort="none" (codex.exe command line)',
    invocations.length >= 1 &&
      invocations.every((i) => /model_reasoning_effort=\\?"?none/.test(i.effortArgument ?? '')) &&
      invocations.every((i) => i.model === 'gpt-6-luna'),
    invocations,
  );
  const debug = g
    .readLog()
    .split(/\r?\n/)
    .filter((line) => line.includes('reasoning effort sent to the CLI'))
    .map((line) => {
      try {
        const j = JSON.parse(line);
        return { level: j.level, model: j.model, effort: j.effort, providerEffort: j.providerEffort, msg: j.msg };
      } catch {
        return line.slice(0, 300);
      }
    });
  rec.check(
    'L-5 the gateway debug log names the canonical effort and the provider name',
    debug.length === 1 && debug[0].effort === 'none' && debug[0].providerEffort === 'none',
    debug,
  );
  rec.check('L-6 gateway drains to exit 0', (await g.stop()) === 0, g.exitCode());
  g.copyLog('live-gateway.log.txt');
  const rollouts = ownRollouts();
  const cliRecord = rollouts.map((file) => {
    const fields = new Set();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"turn_context"')) continue;
      for (const m of line.matchAll(/"(model|effort|reasoning_effort)":"([^"]*)"/g))
        fields.add(`${m[1]}=${m[2]}`);
    }
    return { file: path.basename(file), turnContext: [...fields] };
  });
  rec.observe('L-7 the CLI session record of this turn (turn_context model and effort only)', cliRecord);
  for (const file of rollouts) fs.rmSync(file);
  rec.check(
    'L-8 the Codex session records this check created (cwd inside its store) are removed; no other session touched',
    rollouts.length >= 1 && rollouts.every((f) => !fs.existsSync(f)) && ownRollouts().length === 0,
    rollouts.map((f) => path.basename(f)),
  );
} catch (error) {
  rec.check('live completed without exception', false, String(error?.stack ?? error));
} finally {
  if (watcher) await watcher.stop();
  for (const x of gateways) if (x.exitCode() === null) await x.stop();
  rec.finish({ store: dir });
}
