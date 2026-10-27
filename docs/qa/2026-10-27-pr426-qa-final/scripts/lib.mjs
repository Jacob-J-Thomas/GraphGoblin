// PR #426 QA helpers, patterned on the F2 record's helpers (docs/qa/2026-10-27-final-f2-live/
// scripts/lib.mjs). Drives a built API (apps/api/dist/main.js) on disposable stores under
// %TEMP%\gg-qa-426f-*, on ports 6730-6739 only, and Edge through the repository's Playwright.
// Two builds: PR = this worktree at the PR head; MAIN = a disposable `git archive` copy of main at
// b33a6d9f under %TEMP%\gg-qa-426f-main-src. Every process it ends is one it started (by PID), or
// one whose command line names one of its own disposable stores.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PR_ROOT = path.resolve(OUT, '..', '..', '..');
export const MAIN_ROOT = path.join(os.tmpdir(), 'gg-qa-426f-main-src');
export const TOOLS = path.join(os.tmpdir(), 'gg-qa-426f-tools');
export const NODE = process.execPath;
const requireWeb = createRequire(path.join(PR_ROOT, 'apps', 'web', 'package.json'));
export const { chromium } = requireWeb('@playwright/test');
const requireInfra = createRequire(path.join(PR_ROOT, 'packages', 'infrastructure', 'package.json'));
export const libsql = requireInfra('@libsql/client');

const home = os.homedir();
const host = os.hostname();
const user = path.basename(home);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function redact(text) {
  let t = String(text);
  // The profile path in every spelling (native, forward slashes, JSON-escaped, Git Bash).
  const variants = [
    home,
    home.replaceAll('\\', '/'),
    home.replaceAll('\\', '\\\\'),
    home.replaceAll('\\', '\\\\\\\\'),
    '/c' + home.slice(2).replaceAll('\\', '/'),
  ];
  for (const v of variants) t = t.replace(new RegExp(escapeRe(v), 'gi'), '%USERPROFILE%');
  t = t.replace(new RegExp(escapeRe(host), 'gi'), '%COMPUTERNAME%');
  t = t.replace(/S-1-(?:\d+-)+\d+/g, '<SID>');
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED-TOKEN>');
  t = t.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '<REDACTED-KEY>');
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<REDACTED-EMAIL>');
  t = t.replace(/\b(account[_-]?id|org[_-]?id|user[_-]?id|chatgpt[_-]?account[_-]?id)(\\?"?\s*[:=]\s*\\?"?)[A-Za-z0-9_-]{6,}/gi, '$1$2<REDACTED-ID>');
  // Any remaining appearance of the user name (for example C--Users-<name>-... folder names).
  t = t.replace(new RegExp(escapeRe(user), 'gi'), '%USERNAME%');
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
  /** One real provider invocation. */
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
  return fs.mkdtempSync(path.join(os.tmpdir(), `gg-qa-426f-${name}-`));
}

function assertPort(port) {
  if (port < 6730 || port > 6739) throw new Error(`port ${port} is outside 6730-6739`);
  // The Fetch standard blocks 6737 (IRC over TLS): Node's fetch and Edge answer "bad port".

}

/**
 * The gateway environment: the shell's variables without JEV_API_KEY, every GG_* variable (#424),
 * NODE_OPTIONS and coverage hooks; then this QA's own disposable settings.
 */
export function baseEnv(root, dir, port, extra = {}) {
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
    GG_WEB_DIST: path.join(root, 'apps', 'web', 'dist'),
    GG_REQUIRE_API_KEY: 'false',
    ...extra,
  };
}

/** The controlled fake CLI (fake-cli.cs.txt), copied into a store; no provider call. */
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
    mode(harness, value) {
      fs.writeFileSync(path.join(cli, `${harness}-mode.txt`), value);
    },
  };
}

export const started = new Set();

/** Start a built API (`root` = PR_ROOT or MAIN_ROOT) as a hidden, piped child. */
export async function startGateway({ root = PR_ROOT, dir, port, env = {}, label, rec }) {
  assertPort(port);
  if (!env.GG_CODEX_BINARY || !env.GG_CLAUDE_BINARY) throw new Error('QA gateway requires both fake CLIs');
  const logFile = path.join(dir, `gateway-${label}.log`);
  const fullEnv = baseEnv(root, dir, port, env);
  const origin = `http://127.0.0.1:${port}`;
  let exitCode = null;
  const child = spawn(NODE, [...(root === MAIN_ROOT ? ['--experimental-loader', pathToFileURL(path.join(OUT, 'scripts', 'baseline-loader.mjs')).href] : []), path.join(root, 'apps', 'api', 'dist', 'main.js')], {
    cwd: root,
    env: fullEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const sink = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(sink, { end: false });
  child.stderr.pipe(sink, { end: false });
  child.once('exit', (code, signal) => {
    exitCode = code ?? signal;
    fs.appendFileSync(path.join(OUT, 'exits.log.txt'), JSON.stringify({pid: child.pid, label, exitCode}) + '\n');
  });
  const pid = child.pid;
  started.add(pid);
  fs.appendFileSync(path.join(OUT, 'pids.log.txt'), JSON.stringify({pid, label, port, dir: redact(dir)}) + '\n');
  const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '');
  const deadline = Date.now() + 90_000;
  while (!readLog().includes('GraphGoblin API listening')) {
    if (exitCode !== null) throw new Error('gateway exited during startup:\n' + readLog());
    if (Date.now() > deadline) throw new Error('gateway did not start:\n' + readLog());
    await sleep(100);
  }
  rec?.log(`gateway ${label} listening`, { pid, port, build: root === PR_ROOT ? 'PR head' : 'main b33a6d9f' });
  return {
    dir,
    port,
    origin,
    pid,
    label,
    logFile,
    readLog,
    exitCode: () => exitCode,
    async waitExit(timeoutMs = 60_000) {
      const end = Date.now() + timeoutMs;
      while (exitCode === null) {
        if (Date.now() > end) return null;
        await sleep(100);
      }
      return exitCode;
    },
    call: makeCall(origin),
    copyLog(outName) {
      fs.writeFileSync(path.join(OUT, outName), redact(readLog()));
    },
    /** Drain, then force if the drain does not finish, then end the PID; returns the exit code. */
    async stop(timeoutMs = 30_000) {
      if (exitCode !== null) return exitCode;
      await this.call('/system/shutdown', { method: 'POST', body: { action: 'drain' } }).catch(() => undefined);
      let code = await this.waitExit(timeoutMs);
      if (code === null) {
        await this.call('/system/shutdown', { method: 'POST', body: { action: 'force' } }).catch(() => undefined);
        code = await this.waitExit(20_000);
      }
      if (code === null) {
        endPid(pid);
        code = await this.waitExit(10_000);
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
    return { status: response.status, json, text };
  };
}

export async function createLoop(call, definition) {
  return call('/loops', { method: 'POST', body: { definition } });
}

export async function publishLoop(call, definition) {
  const created = await createLoop(call, definition);
  if (created.status !== 201 && created.status !== 200) throw new Error('create loop failed ' + JSON.stringify(created.json));
  const id = created.json.loop.id;
  const published = await call(`/loops/${id}/publish`, { method: 'POST' });
  if (published.status >= 300) throw new Error('publish failed ' + JSON.stringify(published.json));
  return id;
}

export async function startRun(call, loopId, body = { input: null }) {
  const r = await call(`/loops/${loopId}/runs`, { method: 'POST', body });
  if (r.status !== 202 && r.status !== 201) throw new Error('start failed ' + JSON.stringify(r.json));
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

/** The provider invocations a run's durable history records (inference turns, LLM decisions). */
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

export async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(intervalMs);
  }
}

export async function waitRun(call, runId, statuses = ['succeeded', 'failed', 'cancelled'], timeoutMs = 180_000) {
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
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress',
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
  return result.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, cmd: (p.CommandLine ?? '').slice(0, 400) }));
}

/**
 * Watch the codex.exe processes a gateway starts (parent = the gateway PID, or a command line that
 * names the gateway's store); keep only model/effort/resume/schema tokens. One long-lived
 * PowerShell polls `Win32_Process` filtered to codex.exe every 100 ms, so a short-lived CLI (a
 * refused turn) is still seen. The watcher is ended by the PID this helper started.
 */
export function startArgvWatch(g) {
  const seen = new Map();
  const script =
    "while ($true) { $p = @(Get-CimInstance Win32_Process -Filter \"Name='codex.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine); " +
    "if ($p.Count -gt 0) { ConvertTo-Json -InputObject $p -Compress } ; Write-Output '---'; Start-Sleep -Milliseconds 100 }";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  started.add(child.pid);
  const store = g.dir.toLowerCase();
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
        if (p.ParentProcessId !== g.pid && !cmd.toLowerCase().includes(store)) continue;
        if (!/\bexec\b/.test(cmd) || /--help|--version|\blogin\b/.test(cmd)) continue;
        seen.set(p.ProcessId, {
          pid: p.ProcessId,
          parentIsGateway: p.ParentProcessId === g.pid,
          model: /--model\s+("?)([^\s"]+)\1/.exec(cmd)?.[2] ?? null,
          effort: /model_reasoning_effort=\\?"?([a-z]+)/.exec(cmd)?.[1] ?? null,
          outputSchema: /--output-schema/.test(cmd),
          resume: /\bexec\s+resume\b|\bresume\s/.test(cmd),
        });
      }
    }
  });
  return {
    seen,
    ticks: () => ticks,
    async ready(timeoutMs = 20_000) {
      await waitFor(() => ticks > 0, { timeoutMs });
    },
    async stop() {
      await sleep(300);
      endPid(child.pid);
      started.delete(child.pid);
      return [...seen.values()];
    },
  };
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

/** End one process by PID. Only for PIDs this QA started or a store-named leftover. */
export function endPid(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    return false;
  }
}

export function cleanupStore(dir, rec) { rec?.log('disposable store retained; no deletion attempted', dir); }

export async function launchEdge() {
  return chromium.launch({ channel: 'msedge', headless: true });
}

export async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Open a node's editor dialog by clicking its card header (as the repository's e2e helper does). */
export async function openNode(page, nodeId) {
  await page.getByTestId(`node-${nodeId}`).locator(':scope > div:has([data-kind])').click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

export async function closeNode(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined);
}

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = { id: 'done', kind: 'exit', label: 'Done', config: {} };
export const edge = (id, from, to, port = 'out') => ({ id, from: { node: from, port }, to: { node: to } });

export function loop(name, nodes, edges, settings = {}) {
  return { schemaVersion: 4, name, settings, nodes: [trigger, ...nodes, exit], edges };
}

export function inferenceNode(id, { harness = 'codex', model, effort, template = 'Reply with exactly the word READY and nothing else.' } = {}) {
  return {
    id,
    kind: 'inference',
    label: id,
    ui: { x: 260, y: 80 },
    config: {
      harness,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      harnessOptions: { sandbox: 'read-only', approval: 'never' },
      prompt: { template },
    },
  };
}

export function llmDecisionNode(id, { harness = 'codex', model, effort } = {}) {
  return {
    id,
    kind: 'decision',
    label: id,
    ui: { x: 260, y: 80 },
    config: {
      kind: 'llm',
      harness,
      model: model ? { mode: 'explicit', value: model } : { mode: 'inherit' },
      effort: effort ? { mode: 'explicit', value: effort } : { mode: 'inherit' },
      instructions: 'Always choose the route with id "finish".',
      routes: [
        { id: 'finish', label: 'Finish' },
        { id: 'other', label: 'Other' },
      ],
    },
  };
}

/** start -> node -> done; an LLM decision routes both of its ports to done. */
export function single(name, node, settings = {}) {
  const edges = [edge('e1', 'start', node.id)];
  if (node.kind === 'decision') edges.push(edge('e2', node.id, 'done', 'finish'), edge('e3', node.id, 'done', 'other'));
  else edges.push(edge('e2', node.id, 'done'));
  return loop(name, [node], edges, settings);
}

export async function withDb(dir, fn) {
  const client = libsql.createClient({ url: 'file:' + path.join(dir, 'graphgoblin.db').replaceAll('\\', '/') });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
