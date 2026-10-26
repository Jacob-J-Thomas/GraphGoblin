// PR #417 behaviour QA helpers. Drives the built API (apps/api/dist/main.js) on disposable stores
// under %TEMP%\gg-qa-417-*, real processes, real console Ctrl+C and Edge (Playwright, msedge).
// Patterned on the acceptance group C helpers (docs/qa/2026-10-26-acceptance-c/scripts/lib.mjs.txt
// on main) and group A helpers; written for this QA. Every process it ends is one it started or one
// whose command line names one of its own disposable stores.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(OUT, '..', '..', '..');
export const TOOLS = path.join(os.tmpdir(), 'gg-qa-417-tools');
export const NODE = process.execPath;
const requireWeb = createRequire(path.join(ROOT, 'apps', 'web', 'package.json'));
export const { chromium } = requireWeb('@playwright/test');

const home = os.homedir();
const host = os.hostname();
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
  finish(extra = {}) {
    const summary = {
      scenario: this.name,
      passed: this.checks.filter((c) => c.ok).length,
      failed: this.checks.filter((c) => !c.ok).length,
      checks: this.checks,
      ...extra,
    };
    fs.writeFileSync(
      path.join(OUT, `${this.name}-result.json`),
      redact(JSON.stringify(summary, null, 2)) + '\n',
    );
    this.log(`DONE passed=${summary.passed} failed=${summary.failed}`);
    return summary;
  }
}

export function makeStore(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gg-qa-417-${name}-`));
}

function assertPort(port) {
  if (port < 6530 || port > 6539) throw new Error(`port ${port} is outside 6530-6539`);
}

export function baseEnv(dir, port, extra = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('GG_')),
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
    const command =
      // Start-Process joins the array with spaces; the third element stays one argument (the
      // command line launcher2 passes to CreateProcess). No path here contains a space.
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
    const t = fs.existsSync(logFile + '.launcher.txt')
      ? fs.readFileSync(logFile + '.launcher.txt', 'utf8')
      : '';
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
  };
}

export function makeCall(origin) {
  return async (p, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + p, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  if (created.status !== 201 && created.status !== 200)
    throw new Error('create loop failed ' + JSON.stringify(created));
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

const js = (v) => JSON.stringify(v);

/** Node source for a held script: records its PID, optionally a grandchild, exits 0 on release. */
export function heldScriptSource({ dir, name, tree = false, maxMs = 300_000 }) {
  const base = path.join(dir, name);
  return [
    `const fs=require('node:fs'),cp=require('node:child_process');`,
    `fs.writeFileSync(${js(base + '.pid')},String(process.pid));`,
    tree
      ? `cp.spawn(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),${maxMs})",${js(
          base + '.grandchild',
        )}],{stdio:'ignore'});`
      : '',
    `setInterval(()=>{if(fs.existsSync(${js(base + '.release')})){process.stdout.write(JSON.stringify({released:${js(
      name,
    )}}));process.exit(0)}},100);`,
    `setTimeout(()=>process.exit(0),${maxMs});`,
  ].join('');
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = { id: 'done', kind: 'exit', label: 'Done', config: {} };
const line = (a, b) => [
  { id: 'a', from: { node: 'start', port: 'out' }, to: { node: a } },
  { id: 'b', from: { node: b, port: 'out' }, to: { node: 'done' } },
];

export function scriptLoop(name, source) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      trigger,
      { id: 'hold', kind: 'script', label: 'Held script', config: { command: NODE, args: ['-e', source], stdin: 'none' } },
      exit,
    ],
    edges: line('hold', 'hold'),
  };
}

export function inferenceLoop(name, { harness = 'codex', prompt = 'PR 417 QA fixture; no provider call', model, effort } = {}) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      trigger,
      {
        id: 'infer',
        kind: 'inference',
        label: 'Held harness',
        config: {
          harness,
          // Claude refuses the default workspace-write boundary; use the policy group A used.
          ...(harness === 'claude' ? { harnessOptions: { sandbox: 'read-only', approval: 'never' } } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : harness === 'claude' ? { effort: 'low' } : {}),
          prompt: { template: prompt },
        },
      },
      exit,
    ],
    edges: line('infer', 'infer'),
  };
}

export function parentLoop(name, childLoopId) {
  return {
    schemaVersion: 4,
    name,
    nodes: [trigger, { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: childLoopId } } }, exit],
    edges: line('sub', 'sub'),
  };
}

export function waitLoop(name, seconds) {
  return {
    schemaVersion: 4,
    name,
    nodes: [trigger, { id: 'park', kind: 'wait', label: 'Long wait', config: { mode: 'duration', seconds } }, exit],
    edges: line('park', 'park'),
  };
}

/** This QA's controlled fake Codex CLI (scripts/qa-codex.cs.txt), copied into the store. */
export function qaCodex(dir, { tool = false, name = 'codex' } = {}) {
  const target = path.join(dir, 'qa-codex.exe');
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(TOOLS, 'qa-codex.exe'), target);
  const pidFile = path.join(dir, `${name}.pid`);
  return {
    env: { GG_CODEX_BINARY: target, QA_CODEX_PID: pidFile, ...(tool ? { QA_CODEX_TOOL_CHILD: '1' } : {}) },
    pidFile,
    release: () => fs.writeFileSync(pidFile + '.release', 'go'),
  };
}

/** The repository's own fake (apps/web/e2e/shutdown-fake-codex.ps1, compiled). */
export function repoFakeCodex(dir) {
  const target = path.join(dir, 'shutdown-codex.exe');
  fs.copyFileSync(path.join(TOOLS, 'shutdown-codex.exe'), target);
  return { env: { GG_CODEX_BINARY: target, SHUTDOWN_FAKE_PID: path.join(dir, 'harness.pid') }, pidFile: path.join(dir, 'harness.pid') };
}

/** Acceptance group A's recording CLI (scripts/session-cli.cs.txt) as claude.exe and codex.exe. */
export function sessionCli(dir) {
  const cli = path.join(dir, 'cli');
  fs.mkdirSync(cli, { recursive: true });
  fs.copyFileSync(path.join(TOOLS, 'claude.exe'), path.join(cli, 'claude.exe'));
  fs.copyFileSync(path.join(TOOLS, 'claude.exe'), path.join(cli, 'codex.exe'));
  const control = (name, value) => {
    const file = path.join(cli, name);
    if (value === undefined) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, String(value));
  };
  const requests = () => {
    const file = path.join(cli, 'requests.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  };
  return {
    cli,
    env: { GG_CLAUDE_BINARY: path.join(cli, 'claude.exe'), GG_CODEX_BINARY: path.join(cli, 'codex.exe') },
    control,
    requests,
  };
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

export async function waitRun(call, runId, statuses, timeoutMs = 60_000) {
  return waitFor(
    async () => {
      const r = (await call(`/runs/${runId}`)).json;
      return statuses.includes(r.status) ? r : null;
    },
    { timeoutMs, intervalMs: 150 },
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
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress',
    ],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  ).toString();
  // Some unrelated command lines on this machine carry raw control characters that
  // ConvertTo-Json leaves unescaped; -Compress output has no structural control characters.
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
  return result.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name }));
}

/** tasklist is the OS's own view of one PID. */
export function tasklistAlive(pid) {
  if (!pid) return false;
  const t = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { windowsHide: true }).toString();
  return t.includes(`"${pid}"`);
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

/** End one process by PID (TerminateProcess). Only for PIDs this QA started or its stores own. */
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

/** Count shutdown requests a page sends. */
export function watchShutdownRequests(page, sink, label = '') {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/system/shutdown')
      sink.push({ at: new Date().toISOString(), method: request.method(), tab: label });
  });
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
