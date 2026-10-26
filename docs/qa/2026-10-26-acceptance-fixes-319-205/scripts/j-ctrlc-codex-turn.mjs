// Native reproduction of acceptance scenario J (#319 D-1): the built gateway owns a console like a
// terminal window, one controlled fake Codex turn is in flight, and one real Ctrl+C is delivered to
// that console. Expected: a normal drain in which the turn keeps running; releasing the turn lets
// it finish, the drain completes and the gateway exits 0; the run is `succeeded` after restart.
//
// Usage (worktree root, after pnpm build):
//   node docs/qa/2026-10-26-acceptance-fixes-319-205/scripts/j-ctrlc-codex-turn.mjs \
//     <console-tool.exe> <fake-codex.exe> <port> <log file>
// The helpers are compiled from console-tool.cs.txt and fake-codex.cs.txt beside this script.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [tool, fakeCodex, portText, log] = process.argv.slice(2);
const port = Number(portText);
const root = resolve('.');
const origin = `http://127.0.0.1:${port}`;
const t0 = Date.now();
const redact = (text) =>
  String(text)
    .split(homedir())
    .join('%USERPROFILE%')
    .split(homedir().replaceAll('\\', '\\\\'))
    .join('%USERPROFILE%')
    .replace(new RegExp(hostname(), 'gi'), '%COMPUTERNAME%');
writeFileSync(log, '');
const note = (message, data) =>
  appendFileSync(
    log,
    redact(
      `${new Date().toISOString()} +${((Date.now() - t0) / 1000).toFixed(1)}s ${message}${data === undefined ? '' : ' ' + JSON.stringify(data)}\n`,
    ),
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) =>
  execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true })
    .toString()
    .includes(`"${pid}"`);
const call = async (path, method = 'GET', body) => {
  const response = await fetch(origin + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return response.json();
};

const store = mkdtempSync(join(tmpdir(), 'gg-af-j-'));
const binary = join(store, 'fake-codex.exe');
copyFileSync(fakeCodex, binary);
const pidFile = join(store, 'harness.pid');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_')));
const env = {
  ...inherited,
  GG_DATA_DIR: store,
  GG_HOST: '127.0.0.1',
  GG_PORT: String(port),
  GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: '',
  GG_SHUTDOWN_GRACE_MS: '300000',
  GG_CODEX_BINARY: binary,
  SHUTDOWN_FAKE_PID: pidFile,
};
const main = join(root, 'apps', 'api', 'dist', 'main.js');
function start(viaConsole) {
  const child = viaConsole
    ? spawn(tool, ['host', root, `"${process.execPath}" "${main}"`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawn(process.execPath, [main], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (output += c));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  return { child, exited, output: () => output, code: () => child.exitCode };
}
async function listening(g) {
  for (let i = 0; i < 600 && !g.output().includes('GraphGoblin API listening'); i++) {
    if (g.code() !== null) throw new Error('gateway exited during startup:\n' + g.output());
    await sleep(100);
  }
}

let g;
let restarted;
try {
  g = start(true);
  await listening(g);
  note('gateway listening in its own console', { hostPid: g.child.pid, port });
  const created = await call('/loops', 'POST', {
    definition: {
      schemaVersion: 4,
      name: 'Ctrl+C during a Codex turn',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'infer', kind: 'inference', label: 'Held turn', config: { harness: 'codex', prompt: { template: 'Controlled fixture; no provider call' } } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
        { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
      ],
    },
  });
  const loopId = created.loop.id;
  await call(`/loops/${loopId}/publish`, 'POST');
  const runId = (await call(`/loops/${loopId}/runs`, 'POST', {})).run.id;
  while (!existsSync(pidFile) || readFileSync(pidFile, 'utf8').trim() === '') await sleep(50);
  const codexPid = Number(readFileSync(pidFile, 'utf8'));
  await sleep(1000);
  note('before Ctrl+C', { runId, codexPid, codexAlive: alive(codexPid), status: (await call(`/runs/${runId}`)).status });
  const sent = spawnSync(tool, ['ctrlc', String(g.child.pid)], { windowsHide: true });
  note('one Ctrl+C delivered to the gateway console', { exit: sent.status });
  for (let i = 1; i <= 6; i++) {
    await sleep(500);
    if (g.code() !== null) {
      note(`t=${i * 0.5}s gateway already exited`, { exit: g.code(), codexAlive: alive(codexPid) });
      break;
    }
    const s = await call('/system/shutdown');
    const r = await call(`/runs/${runId}`);
    note(`t=${i * 0.5}s`, { phase: s.phase, activeRunIds: s.activeRunIds, codexAlive: alive(codexPid), status: r.status, failure: r.failure?.code });
  }
  if (g.code() === null) {
    writeFileSync(pidFile + '.release', 'finish');
    note('released the fake turn so it completes normally');
    const deadline = Date.now() + 30_000;
    while (g.code() === null && Date.now() < deadline) await sleep(100);
    note('gateway exit after the drain', { exit: g.code() });
  }
  appendFileSync(log, '\n--- gateway j1 log ---\n' + redact(g.output()) + '\n');
  restarted = start(false);
  await listening(restarted);
  const after = await call(`/runs/${runId}`);
  note('run after restart', { status: after.status, failure: after.failure ?? null });
  await call('/system/shutdown', 'POST', { action: 'drain' });
  note('restart drained', { exit: await restarted.exited });
} catch (error) {
  note('driver error', String(error?.stack ?? error));
} finally {
  for (const x of [g, restarted])
    if (x && x.code() === null) {
      try {
        await call('/system/shutdown', 'POST', { action: 'force' });
      } catch {
        /* already gone */
      }
      await Promise.race([x.exited, sleep(30_000)]);
    }
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  rmSync(store, { recursive: true, force: true, maxRetries: 10 });
  note('store removed');
}
