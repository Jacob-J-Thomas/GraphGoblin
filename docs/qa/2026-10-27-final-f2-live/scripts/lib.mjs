// Final integrated check F2 helpers. Drives the built API (apps/api/dist/main.js) on disposable
// stores under %TEMP%\gg-final-f2-*, real processes, a real console Ctrl+C and Edge (Playwright,
// msedge). Patterned on the PR #417 QA helpers (docs/qa/2026-10-26-pr417-qa/scripts/lib.mjs),
// with this record's ports (6640-6649) and stores. Every process it ends is one it started, one
// whose command line names one of its own disposable stores, or one a check names by PID.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(OUT, '..', '..', '..');
export const TOOLS = path.join(os.tmpdir(), 'gg-final-f2-tools');
export const NODE = process.execPath;
const requireWeb = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'));
export const { chromium } = requireWeb('@playwright/test');
const requireInfra = createRequire(path.join(ROOT, 'packages', 'infrastructure', 'package.json'));
export const libsql = requireInfra('@libsql/client');

const home = os.homedir();
const host = os.hostname();
const homeVariants = [
  home,
  home.replaceAll('\\', '/'),
  home.replaceAll('\\', '\\\\'),
  home.replaceAll('\\', '\\\\\\\\'),
  '/c' + home.slice(2).replaceAll('\\', '/'),
];
const user = path.basename(home);
export function redact(text) {
  let t = String(text);
  for (const v of homeVariants) t = t.split(v).join('%USERPROFILE%');
  t = t.replace(new RegExp(host, 'gi'), '%COMPUTERNAME%');
  t = t.replace(/S-1-5-21-[0-9-]+/g, '<SID>');
  // Anything shaped like a credential, token or account identifier.
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED-TOKEN>');
  t = t.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '<REDACTED-KEY>');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<REDACTED-EMAIL>');
  t = t.replace(/\b(account[_-]?id|org[_-]?id|user[_-]?id)("?\s*[:=]\s*"?)[A-Za-z0-9_-]{6,}/gi, '$1$2<REDACTED-ID>');
  t = t.replace(new RegExp(`\\\\Users\\\\${user}\\b`, 'gi'), '\\Users\\%USERNAME%');
  return t;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Recorder {
  constructor(name) {
    this.name = name;
    this.file = path.join(OUT, `${name}.log.txt`);
    fs.writeFileSync(this.file, '');
    this.checks = [];
    this.t0 = Date.now();
    this.turns = [];
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
  observe(id, detail) {
    this.checks.push({ id, ok: null, detail });
    this.log(`OBSERVE ${id}`, detail);
  }
  /** One real provider invocation (a turn, a refused resume or a structured decision call). */
  turn(entry) {
    this.turns.push(entry);
    this.log('REAL TURN', entry);
  }
  finish(extra = {}) {
    const summary = {
      scenario: this.name,
      passed: this.checks.filter((c) => c.ok === true).length,
      failed: this.checks.filter((c) => c.ok === false).length,
      observations: this.checks.filter((c) => c.ok === null).length,
      realTurns: this.turns,
      checks: this.checks,
      ...extra,
    };
    fs.writeFileSync(path.join(OUT, `${this.name}-result.json`), redact(JSON.stringify(summary, null, 2)) + '\n');
    this.log(`DONE passed=${summary.passed} failed=${summary.failed} observations=${summary.observations} realTurns=${this.turns.length}`);
    return summary;
  }
}

export function makeStore(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gg-final-f2-${name}-`));
}

function assertPort(port) {
  if (port < 6640 || port > 6649) throw new Error(`port ${port} is outside 6640-6649`);
}

/** Live: the product's own defaults (SDK-bundled Codex CLI, %USERPROFILE%\.local\bin\claude.exe). */
export function baseEnv(dir, port, extra = {}) {
  const inherited = Object.fromEntries(
    // The shell carries the owner's JEV_API_KEY, which the API would seed into the disposable
    // store as a secret (observed in LP-1's gateway log); keep it out of every gateway.
    Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_') && !/NODE_V8_COVERAGE|JEV_API_KEY/i.test(k)),
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

/** Dry-run only: acceptance A's recording CLI as codex.exe and claude.exe (no provider call). */
export function fakeCli(dir) {
  const cli = path.join(dir, 'fake-cli');
  fs.mkdirSync(cli, { recursive: true });
  for (const n of ['claude.exe', 'codex.exe']) fs.copyFileSync(path.join(TOOLS, 'fake', n), path.join(cli, n));
  const requests = () => {
    const file = path.join(cli, 'requests.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  return {
    cli,
    env: { GG_CLAUDE_BINARY: path.join(cli, 'claude.exe'), GG_CODEX_BINARY: path.join(cli, 'codex.exe') },
    requests,
    control(name, value) {
      const file = path.join(cli, name);
      if (value === undefined) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, String(value));
    },
  };
}

/** PIDs this QA started directly (gateways, console launchers); ended by PID only. */
export const started = new Set();

/**
 * Start the built API. `viaConsole: true` starts it attached to a console of its own (PowerShell
 * Start-Process + launcher2, like a terminal window) so a real console Ctrl+C can be delivered;
 * otherwise it is a hidden, piped child like the repository's own e2e gateway.
 */
export async function startGateway({ dir, port, env = {}, label, viaConsole = false, rec }) {
  assertPort(port);
  const logFile = path.join(dir, `gateway-${label}.log`);
  const fullEnv = baseEnv(dir, port, env);
  const origin = `http://127.0.0.1:${port}`;
  let pid;
  let launcherPid;
  let exitCode = null;
  if (!viaConsole) {
    const child = spawn(NODE, [path.join(ROOT, 'apps', 'api', 'dist', 'main.js')], {
      cwd: ROOT,
      env: fullEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const sink = fs.createWriteStream(logFile, { flags: 'a' });
    child.stdout.pipe(sink, { end: false });
    child.stderr.pipe(sink, { end: false });
    child.once('exit', (code, signal) => {
      exitCode = code ?? signal;
    });
    pid = child.pid;
  } else {
    const launcher = path.join(TOOLS, 'launcher2.exe');
    const main = path.join(ROOT, 'apps', 'api', 'dist', 'main.js');
    // Start-Process joins the array with spaces; the third element stays one argument (the
    // command line launcher2 passes to CreateProcess). No path here contains a space.
    for (const p of [logFile, ROOT, NODE, main]) if (p.includes(' ')) throw new Error('path contains a space: ' + p);
    const command =
      `$a = @('${logFile}', '${ROOT}', '"${NODE} ${main}"'); ` +
      `$l = Start-Process -FilePath '${launcher}' -ArgumentList $a -WindowStyle Hidden -PassThru; ` +
      `Write-Output $l.Id`;
    const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: fullEnv,
      windowsHide: true,
    });
    if (ran.status !== 0) throw new Error('Start-Process failed: ' + ran.stderr);
    launcherPid = Number(String(ran.stdout).trim());
    started.add(launcherPid);
    for (let i = 0; i < 200 && !fs.existsSync(logFile + '.pid'); i++) await sleep(50);
    pid = Number(fs.readFileSync(logFile + '.pid', 'utf8'));
  }
  started.add(pid);
  const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  const currentExit = () => {
    if (!viaConsole) return exitCode;
    const t = fs.existsSync(logFile + '.launcher.txt') ? fs.readFileSync(logFile + '.launcher.txt', 'utf8') : '';
    const m = /exited with code (\d+)/.exec(t);
    return m ? Number(m[1]) : null;
  };
  const deadline = Date.now() + 90_000;
  while (!readLog().includes('GraphGoblin API listening')) {
    if (currentExit() !== null) throw new Error('gateway exited during startup:\n' + readLog());
    if (Date.now() > deadline) throw new Error('gateway did not start:\n' + readLog());
    await sleep(100);
  }
  rec?.log(`gateway ${label} listening`, { pid, launcherPid, port, viaConsole });
  return {
    dir,
    port,
    origin,
    pid,
    launcherPid,
    label,
    logFile,
    viaConsole,
    env,
    readLog,
    exitCode: currentExit,
    async waitExit(timeoutMs = 60_000) {
      const end = Date.now() + timeoutMs;
      while (currentExit() === null) {
        if (Date.now() > end) return null;
        await sleep(100);
      }
      return currentExit();
    },
    call: makeCall(origin),
    copyLog(outName) {
      let text = readLog();
      if (viaConsole && fs.existsSync(logFile + '.launcher.txt'))
        text += '\n--- console launcher ---\n' + fs.readFileSync(logFile + '.launcher.txt', 'utf8');
      fs.writeFileSync(path.join(OUT, outName), redact(text));
    },
    /** Drain, then force if the drain does not finish; returns the exit code. */
    async stop(timeoutMs = 30_000) {
      if (currentExit() !== null) return currentExit();
      await this.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } }).catch(() => undefined);
      let code = await this.waitExit(timeoutMs);
      if (code === null) {
        await this.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
        code = await this.waitExit(20_000);
      }
      return code;
    },
  };
}

export function makeCall(origin) {
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + p, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
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

/** Never throws: a gateway that already exited reads as phase "gone". */
export async function shutdownState(g) {
  try {
    return (await g.call('/system/shutdown')).json;
  } catch (error) {
    return { phase: 'gone', error: String(error?.cause?.code ?? error) };
  }
}

export async function publishLoop(call, definition) {
  const created = await call('/loops', { method: 'POST', body: { definition } });
  if (created.status !== 201 && created.status !== 200) throw new Error('create loop failed ' + JSON.stringify(created));
  const id = created.json.loop.id;
  const published = await call(`/loops/${id}/publish`, { method: 'POST' });
  if (published.status >= 300) throw new Error('publish failed ' + JSON.stringify(published));
  return id;
}

export async function startRun(call, loopId, body = {}) {
  const r = await call(`/loops/${loopId}/runs`, { method: 'POST', body });
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

/** The real provider invocations a run's durable history records (inference turns, LLM decisions). */
export function providerCalls(evs) {
  const out = [];
  for (const e of evs) {
    if (e.type === 'harness.turn')
      out.push({ kind: 'turn', seq: e.seq, nodeId: e.nodeId, harness: e.harness, promptKind: e.promptKind, resume: e.resumeSessionId ?? null });
    if (e.type === 'decision.made' && e.provenance?.kind === 'llm')
      out.push({ kind: 'llm-decision', seq: e.seq, nodeId: e.nodeId, provenance: e.provenance });
  }
  return out;
}

/** Per visit of `nodeId`: the value its node.finished patch wrote to lastOutput (the reply). */
export function nodeReplies(evs, nodeId) {
  return evs
    .filter((e) => e.type === 'node.finished' && e.nodeId === nodeId)
    .map((e) => {
      const op = (e.patch ?? []).find((o) => /^\/lastOutput$/.test(o.path)) ?? (e.patch ?? []).find((o) => o.path?.includes(`/outputs/${nodeId}`));
      const v = op?.value;
      return typeof v === 'string' ? v : JSON.stringify(v ?? null);
    });
}

/** Command items the harness reported (status, exit code, preview). */
export function commandItems(evs) {
  return evs
    .filter((e) => e.type === 'node.progress' && e.progress?.item?.type === 'command')
    .map((e) => ({ status: e.progress.item.status, exitCode: e.progress.item.exitCode, preview: e.progress.item.commandPreview }));
}

/** Progress item types and statuses (no summaries). */
export function progressKinds(evs) {
  return evs.filter((e) => e.type === 'node.progress').map((e) => `${e.nodeId}:${e.progress?.item?.type ?? 'script'}:${e.progress?.item?.status ?? ''}`);
}

export async function waitFile(file, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() === '') {
    if (Date.now() > end) throw new Error('timed out waiting for ' + file);
    await sleep(50);
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(intervalMs);
  }
}

export async function waitRun(call, runId, statuses, timeoutMs = 180_000) {
  return waitFor(
    async () => {
      const r = (await call(`/runs/${runId}`)).json;
      return statuses.includes(r.status) ? r : null;
    },
    { timeoutMs, intervalMs: 250 },
  ).then(async (r) => r ?? (await call(`/runs/${runId}`)).json);
}

/** Every process on the machine through the operating system's own CIM provider. */
export function processes() {
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress',
    ],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  ).toString();
  return JSON.parse(out.replace(/[\u0000-\u001f]/g, ' '));
}

export function descendants(rootPid, all = processes()) {
  const result = [];
  const walk = (pid) => {
    for (const p of all)
      if (p.ParentProcessId === pid && p.ProcessId !== pid) {
        result.push(p);
        walk(p.ProcessId);
      }
  };
  walk(rootPid);
  return result.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, cmd: (p.CommandLine ?? '').slice(0, 300) }));
}

/** tasklist is the OS's own view of one PID. */
export function tasklistAlive(pid) {
  if (!pid) return false;
  const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true }).toString();
  return t.includes(`"${pid}"`);
}

export function tasklistLine(pid) {
  const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true }).toString().trim();
  return t.includes(`"${pid}"`) ? t : `no process with PID ${pid}`;
}

/** Processes whose command line or executable path names this store directory. */
export function storeProcesses(dir, all = processes()) {
  const needles = [dir.toLowerCase(), dir.replaceAll('\\', '/').toLowerCase(), dir.toLowerCase().replaceAll('\\', '\\\\')];
  return all
    .filter((p) => {
      const c = `${p.CommandLine ?? ''} ${p.ExecutablePath ?? ''}`.toLowerCase();
      return needles.some((n) => c.includes(n));
    })
    .map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name }));
}

/** End one process by PID (TerminateProcess). Only for PIDs this QA started or a check named. */
export function endPid(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

export function cleanupStore(dir, rec) {
  for (let i = 0; i < 3; i++) {
    const left = storeProcesses(dir);
    if (!left.length) break;
    rec?.log('ending leftover store processes by PID', left);
    for (const p of left) endPid(p.pid);
    spawnSync('cmd.exe', ['/c', 'ping -n 2 127.0.0.1 >NUL'], { windowsHide: true });
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    rec?.log('store removal failed', String(error));
  }
}

export function ctrlC(pid) {
  const r = spawnSync(path.join(TOOLS, 'ctrlc.exe'), [String(pid)], { windowsHide: true });
  return { status: r.status, stderr: String(r.stderr) };
}

/** PIDs attached to the console of `pid` (GetConsoleProcessList), with names. */
export function consoleList(pid, scratchDir) {
  const out = path.join(scratchDir, `conslist-${Date.now()}.txt`);
  const r = spawnSync(path.join(TOOLS, 'conslist.exe'), [String(pid), out], { windowsHide: true });
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  return { status: r.status, entries: text ? text.split(',') : [] };
}

export async function launchEdge() {
  return chromium.launch({ channel: 'msedge', headless: true });
}

export async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

export async function noticeText(page) {
  const section = page.getByRole('region', { name: 'Gateway shutdown' });
  return (await section.count()) ? (await section.innerText()).replace(/\s+\n/g, '\n') : '';
}

export async function noticeButtons(page) {
  const section = page.getByRole('region', { name: 'Gateway shutdown' });
  return (await section.count()) ? section.getByRole('button').allInnerTexts() : [];
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = { id: 'done', kind: 'exit', label: 'Done', config: {} };
export const edge = (id, from, to, port = 'out') => ({ id, from: { node: from, port }, to: { node: to } });

export function loop(name, nodes, edges, settings = {}) {
  return { schemaVersion: 4, name, settings, nodes: [trigger, ...nodes, exit], edges };
}

/** One inference node. Claude needs the read-only/never pair (docs/06 native Windows policy). */
export function inferenceNode(id, { harness = 'codex', model, effort, template, session, sandbox, extra = {} } = {}) {
  const harnessOptions =
    harness === 'claude' ? { sandbox: 'read-only', approval: 'never' } : { sandbox: sandbox ?? 'read-only', approval: 'never' };
  return {
    id,
    kind: 'inference',
    label: id,
    config: {
      harness,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(session ? { session } : {}),
      harnessOptions,
      prompt: { template },
      ...extra,
    },
  };
}

export function line(name, nodes) {
  const ids = ['start', ...nodes.map((n) => n.id), 'done'];
  return loop(
    name,
    nodes,
    ids.slice(1).map((id, i) => edge(`e${i}`, ids[i], id)),
  );
}

/** Read session rows of a stopped store directly (read-only), for diagnostics. */
export async function withDb(dir, fn) {
  const client = libsql.createClient({ url: 'file:' + path.join(dir, 'graphgoblin.db').replaceAll('\\', '/') });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
