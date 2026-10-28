// WP-423 record helpers. Drive the built API (apps/api/dist/main.js) on disposable stores under
// %TEMP%\gg-423-*, ports 6310 to 6319, and watch the process tree under the gateway by PID.
// Patterned on docs/qa/2026-10-27-final-f2-live/scripts/lib.mjs. Every process ended here is one
// this script started (the gateway, the CIM poller), by PID.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(OUT, '..', '..', '..');
export const NODE = process.execPath;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = os.homedir();
const host = os.hostname();
const user = path.basename(home);
const homeVariants = [
  home,
  home.replaceAll('\\', '/'),
  home.replaceAll('\\', '\\\\'),
  home.replaceAll('\\', '\\\\\\\\'),
  '/c' + home.slice(2).replaceAll('\\', '/'),
];
export function redact(text) {
  let t = String(text);
  for (const v of homeVariants) t = t.split(v).join('%USERPROFILE%');
  t = t.replace(new RegExp(host, 'gi'), '%COMPUTERNAME%');
  t = t.replace(/S-1-5-21-[0-9-]+/g, '<SID>');
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED-TOKEN>');
  t = t.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '<REDACTED-KEY>');
  // Codex plugin ids (`<plugin>@<marketplace>`) are not addresses; keep them readable.
  t = t.replace(/\b([a-z0-9-]+)@(graphgoblin-local|openai-[a-z-]+|personal)\b/g, '$1\u0000$2');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<REDACTED-EMAIL>');
  t = t.replaceAll('\u0000', '@');
  t = t.replace(
    /\b(account[_-]?(?:id|uuid)|org(?:anization)?[_-]?(?:id|uuid)|user[_-]?(?:id|uuid))("?\s*[:=]\s*"?)[A-Za-z0-9_-]{6,}/gi,
    '$1$2<REDACTED-ID>',
  );
  t = t.replace(new RegExp(`\\\\Users\\\\${user}\\b`, 'gi'), '\\Users\\%USERNAME%');
  // Claude's project folder names spell the path with dashes.
  t = t.replace(new RegExp(`C--Users-${user}-`, 'gi'), 'C--Users-%USERNAME%-');
  return t;
}

export class Recorder {
  constructor(name) {
    this.name = name;
    this.file = path.join(OUT, `${name}.log.txt`);
    fs.writeFileSync(this.file, '');
    this.checks = [];
    this.turns = [];
    this.t0 = Date.now();
  }
  log(message, data) {
    const line = `${new Date().toISOString()} +${((Date.now() - this.t0) / 1000).toFixed(1)}s ${message}${
      data === undefined ? '' : ' ' + JSON.stringify(data)
    }\n`;
    fs.appendFileSync(this.file, redact(line));
    process.stdout.write(redact(line));
  }
  check(id, ok, detail) {
    this.checks.push({ id, ok: Boolean(ok), detail });
    this.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id}`, detail);
    return ok;
  }
  turn(entry) {
    this.turns.push(entry);
    this.log('REAL TURN', entry);
  }
  finish(extra = {}) {
    const summary = {
      scenario: this.name,
      passed: this.checks.filter((c) => c.ok).length,
      failed: this.checks.filter((c) => !c.ok).length,
      realTurns: this.turns,
      checks: this.checks,
      ...extra,
    };
    fs.writeFileSync(
      path.join(OUT, `${this.name}-result.json`),
      redact(JSON.stringify(summary, null, 2)) + '\n',
    );
    this.log(`DONE passed=${summary.passed} failed=${summary.failed} realTurns=${this.turns.length}`);
    return summary;
  }
}

export function makeStore(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gg-423-${name}-`));
}

function assertPort(port) {
  if (port < 6310 || port > 6319) throw new Error(`port ${port} is outside 6310-6319`);
}

/** The gateway's environment: no GG_* or JEV_API_KEY from this shell (COMMON.md isolation). */
export function baseEnv(dir, port, extra = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith('GG_') && !/^(NODE_V8_COVERAGE|JEV_API_KEY|NODE_OPTIONS)$/i.test(k),
    ),
  );
  return {
    ...inherited,
    GG_DATA_DIR: dir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_WEB_DIST: path.join(ROOT, 'apps', 'web', 'dist'),
    GG_REQUIRE_API_KEY: 'false',
    ...extra,
  };
}

export async function startGateway({ dir, port, env = {}, label, rec }) {
  assertPort(port);
  const logFile = path.join(dir, `gateway-${label}.log`);
  const child = spawn(NODE, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
    cwd: ROOT,
    env: baseEnv(dir, port, env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const sink = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(sink, { end: false });
  child.stderr.pipe(sink, { end: false });
  let exitCode = null;
  child.once('exit', (code, signal) => (exitCode = code ?? signal));
  const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  const deadline = Date.now() + 90_000;
  while (!readLog().includes('GraphGoblin API listening')) {
    if (exitCode !== null) throw new Error('gateway exited during startup:\n' + readLog());
    if (Date.now() > deadline) throw new Error('gateway did not start:\n' + readLog());
    await sleep(100);
  }
  rec?.log(`gateway ${label} listening`, { pid: child.pid, port });
  const origin = `http://127.0.0.1:${port}`;
  return {
    pid: child.pid,
    readLog,
    call: makeCall(origin),
    copyLog(outName) {
      fs.writeFileSync(path.join(OUT, outName), redact(readLog()));
    },
    async stop() {
      if (exitCode !== null) return exitCode;
      await this.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } }).catch(() => undefined);
      for (let i = 0; i < 300 && exitCode === null; i++) await sleep(100);
      if (exitCode === null) {
        await this.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
        for (let i = 0; i < 200 && exitCode === null; i++) await sleep(100);
      }
      if (exitCode === null) child.kill();
      return exitCode;
    },
  };
}

export function makeCall(origin) {
  return async (p, { method = 'GET', body } = {}) => {
    const response = await fetch(origin + p, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json };
  };
}

export async function publishLoop(call, definition) {
  const created = await call('/loops', { method: 'POST', body: { definition } });
  if (created.status !== 201 && created.status !== 200)
    throw new Error('create loop failed ' + JSON.stringify(created));
  const id = created.json.loop.id;
  const published = await call(`/loops/${id}/publish`, { method: 'POST' });
  if (published.status >= 300) throw new Error('publish failed ' + JSON.stringify(published));
  return id;
}

export async function startRun(call, loopId) {
  const r = await call(`/loops/${loopId}/runs`, { method: 'POST', body: {} });
  if (r.status !== 202 && r.status !== 201) throw new Error('start failed ' + JSON.stringify(r));
  return r.json.run.id;
}

export async function events(call, runId) {
  const all = [];
  let after = 0;
  for (;;) {
    const page = (await call(`/runs/${runId}/events?after=${after}&limit=1000`)).json;
    all.push(...page.items);
    if (!page.hasMore || page.items.length === 0) break;
    after = page.items.at(-1).seq;
  }
  return all;
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = { id: 'done', kind: 'exit', label: 'Done', config: {} };
export function oneInference(name, config) {
  return {
    schemaVersion: 4,
    name,
    settings: {},
    nodes: [trigger, { id: 'infer', kind: 'inference', label: 'infer', config }, exit],
    edges: [
      { id: 'e0', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e1', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

/**
 * Poll every process (CIM Win32_Process) from one long-lived PowerShell until stopped. Each
 * snapshot is folded into `seen` for the descendants of `rootPid` (names, PIDs and parents), so
 * short-lived children are caught when they live longer than one poll. Command lines are kept
 * only in memory, for finding the marker command and the CLI's own arguments.
 */
export function watchTree(rootPid, { names, sleepMs = 150 } = {}) {
  // `names` narrows each query (a CIM filter on process names), which makes each poll faster for
  // short-lived children; the tree then only holds those names.
  const filter = names ? ` -Filter "${names.map((n) => `Name='${n}'`).join(' OR ')}"` : '';
  const script = `while ($true) { @(Get-CimInstance Win32_Process${filter} | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress; Start-Sleep -Milliseconds ${sleepMs} }`;
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const seen = new Map();
  let latest = [];
  let snapshots = 0;
  const lines = readline.createInterface({ input: ps.stdout });
  lines.on('line', (line) => {
    let all;
    try {
      all = JSON.parse(line.replace(/[\u0000-\u001f]/g, ' '));
    } catch {
      return;
    }
    snapshots += 1;
    const tree = [];
    const walk = (pid, depth) => {
      for (const p of all)
        if (p.ParentProcessId === pid && p.ProcessId !== pid) {
          tree.push({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, depth, cmd: p.CommandLine ?? '' });
          walk(p.ProcessId, depth + 1);
        }
    };
    walk(rootPid, 1);
    latest = tree;
    for (const p of tree) {
      const known = seen.get(p.pid);
      if (!known) seen.set(p.pid, { ...p, firstSnapshot: snapshots });
      else if (!known.cmd && p.cmd) known.cmd = p.cmd;
    }
  });
  return {
    pid: ps.pid,
    latest: () => latest,
    seen: () => [...seen.values()],
    snapshots: () => snapshots,
    stop() {
      lines.close();
      ps.kill();
    },
  };
}

/** Names, PIDs and parents only (no command lines) for the record. */
export const plain = (tree) => tree.map(({ pid, ppid, name, depth }) => ({ pid, ppid, name, depth }));

/** The Codex CLI's `--config` arguments from its own command line (no prompt is in argv). */
export function configArgs(cmd) {
  const out = [];
  const re = /--config\s+("(?:[^"\\]|\\.)*"|\S+)/g;
  let m;
  while ((m = re.exec(cmd)))
    out.push(m[1].startsWith('"') ? m[1].slice(1, -1).replaceAll('\\"', '"') : m[1]);
  return out;
}

/** What a process under the gateway is, from its command line (kept in memory only). */
export function role(p, marker) {
  if (marker && p.cmd.includes(marker)) return 'marker-command';
  if (/ mcp list /.test(p.cmd)) return 'mcp-listing';
  if (/codex/i.test(p.name) && / exec /.test(p.cmd)) return 'turn-cli';
  if (/codex(\.js|\.exe)/i.test(p.cmd) && /(--version|--help|login status)/.test(p.cmd)) return 'preflight';
  return undefined;
}

/**
 * Remove the Codex CLI's own session records written by these turns: rollouts under
 * %USERPROFILE%\.codex\sessions whose first line names a working directory inside `storeDir`.
 * Never touches any other session.
 */
export function removeCodexSessions(storeDir, rec) {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const removed = [];
  const needle = storeDir.toLowerCase();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.jsonl') && fs.statSync(full).mtimeMs > Date.now() - 6 * 3600_000) {
        const first = firstLine(full);
        let cwd = '';
        try {
          cwd = String(JSON.parse(first)?.payload?.cwd ?? '');
        } catch {
          continue;
        }
        if (cwd.toLowerCase().startsWith(needle)) {
          fs.rmSync(full);
          removed.push(path.relative(root, full));
        }
      }
    }
  };
  for (const day of ['27', '28']) {
    const dir = path.join(root, '2026', '10', day);
    if (fs.existsSync(dir)) visit(dir);
  }
  rec?.log('removed this store\'s Codex session records', { count: removed.length, files: removed });
  return removed;
}

/** The first line of a rollout (its session_meta record can be hundreds of KB long). */
export function firstLine(file) {
  const fd = fs.openSync(file, 'r');
  const chunks = [];
  const buf = Buffer.alloc(65536);
  let position = 0;
  try {
    for (let total = 0; total < 8 * 1024 * 1024; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, position);
      if (n === 0) break;
      const newline = buf.subarray(0, n).indexOf(10);
      chunks.push(Buffer.from(buf.subarray(0, newline === -1 ? n : newline)));
      if (newline !== -1) break;
      position += n;
      total += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function removeStore(dir, rec) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    rec?.log('store removed', { dir });
  } catch (error) {
    rec?.log('store removal failed', String(error));
  }
}
