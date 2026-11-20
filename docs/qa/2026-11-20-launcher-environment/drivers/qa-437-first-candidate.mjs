// Independent touched-systems QA driver for GraphGoblin #437: the Windows launcher installer and
// native launcher refuse secret-bearing GG_* overrides (GG_MASTER_KEY, GG_JEV_API_KEY, any case).
//
// Normal entry points only: the shipped Windows PowerShell 5.1 installer (scripts/
// install-windows-launcher.ps1) invoked with an operator-style -Environment @{...} literal, and the
// installer-compiled native launcher invoked with its ordinary command-line modes. Every run uses
// an explicit disposable InstallDir, DataDir, repo, synthetic Chrome PWA shortcut and an explicitly
// constructed child environment. The real environment is never enumerated; only SystemRoot and
// (for git) USERPROFILE are read by name. Synthetic canary values are generated per run, held in
// memory only, never printed and never written to the results file (only short hashes).
//
// Usage:
//   node qa437-launcher-secret-overrides.mjs --target candidate|baseline --checkout <dir>
//     --rev <commit> --fixtures <dir> --out <results.json> --git <git.exe> [--port-start 46437]
//
// --target candidate runs the checkout's working-tree installer and Launcher.cs (verified equal
// to --rev blobs). --target baseline extracts both files from --rev with `git cat-file` (read-only)
// into the fixture folder. The built apps/api/dist and apps/web/dist come from the checkout via
// directory junctions inside the disposable repo.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { watch } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------------------------
// Arguments and constants

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || i + 1 >= argv.length) throw new Error(`Bad argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ['target', 'checkout', 'rev', 'fixtures', 'out', 'git'])
    if (!out[k]) throw new Error(`Missing --${k}`);
  if (!['candidate', 'baseline'].includes(out.target)) throw new Error('--target must be candidate or baseline');
  if (!/^[0-9a-f]{40}$/.test(out.rev)) throw new Error('--rev must be a full commit SHA');
  return out;
}

const A = parseArgs(process.argv.slice(2));
const SYSROOT = process.env.SystemRoot || 'C:\\Windows'; // single named lookup, no enumeration
const SYS32 = join(SYSROOT, 'System32');
const POWERSHELL = join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CSC = join(SYSROOT, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const CHECKOUT = resolve(A.checkout);
const INSTALLER_REL = 'scripts/install-windows-launcher.ps1';
const LAUNCHER_REL = 'apps/windows-launcher/Launcher.cs';

const REFUSAL =
  'Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.';
// Ordinary overrides. GG_REQUIRE_API_KEY contains "API_KEY" and must stay usable. GG_OLLAMA_ENABLED
// is off so the disposable gateway never probes a local Ollama endpoint.
const SAFE = {
  GG_LOG_LEVEL: 'info',
  GG_REQUIRE_API_KEY: 'false',
  GG_OLLAMA_ENABLED: 'false',
  GG_SWAGGER_UI: 'false',
};
const SAFE_REINSTALL = { ...SAFE, GG_MAX_CONCURRENT_RUNS: '3' };
const KEY_VARIANTS = [
  { key: 'GG_MASTER_KEY', secret: 'master', casing: 'upper' },
  { key: 'GG_JEV_API_KEY', secret: 'jev', casing: 'upper' },
  { key: 'GG_Master_Key', secret: 'master', casing: 'mixed' },
  { key: 'gG_mAsTeR_kEy', secret: 'master', casing: 'mixed' },
  { key: 'Gg_Jev_Api_Key', secret: 'jev', casing: 'mixed' },
  { key: 'GG_JEV_API_key', secret: 'jev', casing: 'mixed' },
  { key: 'gg_master_key', secret: 'master', casing: 'lower' },
  { key: 'gg_jev_api_key', secret: 'jev', casing: 'lower' },
];

// ---------------------------------------------------------------------------------------------
// Synthetic canaries (memory only)

function masterCanary() {
  // A syntactically valid 32-byte base64 key, so a leaked value would also be *usable* by the API.
  for (;;) {
    const value = randomBytes(32).toString('base64');
    if (/^[A-Za-z0-9]{43}=$/.test(value)) return value;
  }
}
const jevCanary = () => 'qa437synthjev' + randomBytes(16).toString('hex');
const CANARY = {
  explicitMaster: masterCanary(),
  explicitJev: jevCanary(),
  manualMaster: masterCanary(),
  manualJev: jevCanary(),
  inheritedMaster: masterCanary(),
  inheritedJev: jevCanary(),
};
const NEEDLES = [...new Set(Object.values(CANARY).flatMap((v) => [v, v.slice(0, 32)]))];
const sha = (data) => createHash('sha256').update(data).digest('hex');
const hasNeedle = (text) => NEEDLES.some((n) => String(text ?? '').includes(n));
function sanitize(text) {
  let out = String(text ?? '');
  for (const n of NEEDLES) out = out.split(n).join('[SYNTHETIC-CANARY]');
  return out;
}
const snippet = (text, max = 260) => sanitize(text).replace(/\s+/g, ' ').trim().slice(0, max);
const squash = (text) => String(text ?? '').replace(/\s+/g, '');

/**
 * Windows PowerShell 5.1 started with -EncodedCommand switches stderr to CLIXML once a progress
 * record appears (for example "Preparing modules for first use" in a fresh disposable profile).
 * Decode only the Error-stream strings; progress records are host noise, counted separately.
 */
function decodeStderr(raw) {
  const text = String(raw ?? '');
  if (!text.startsWith('#< CLIXML')) return { clixml: false, progress: 0, errorText: text };
  const unescape = (s) =>
    s
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const errors = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => unescape(m[1]));
  const progress = (text.match(/<Obj S="progress"/g) ?? []).length;
  const other = (text.match(/<S S="(?!Error")[^"]*">/g) ?? []).length;
  return { clixml: true, progress, other, errorText: errors.join('') };
}

// ---------------------------------------------------------------------------------------------
// Results bookkeeping

const results = {
  schema: 'graphgoblin-qa437-results/v1',
  issue: 437,
  target: A.target,
  revision: A.rev,
  checkout: CHECKOUT,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  tools: {},
  fixtureRoot: null,
  port: null,
  canaries: Object.entries(CANARY).map(([role, v]) => ({ role, sha256_12: sha(v).slice(0, 12), length: v.length })),
  cases: [],
  counts: null,
  notes: [],
};

function addCase(id, kind, description, inputs = {}) {
  const c = { id, kind, description, inputs, assertions: [], outputs: {} };
  results.cases.push(c);
  return {
    c,
    check(name, pass, detail = '', evidence = 'execution') {
      c.assertions.push({ name, pass: Boolean(pass), evidence, detail: sanitize(String(detail)).slice(0, 600) });
      return Boolean(pass);
    },
    skip(name, reason, evidence = 'execution') {
      c.assertions.push({ name, pass: null, evidence, detail: sanitize(reason) });
    },
    output(label, r) {
      const decoded = decodeStderr(r.stderr);
      c.outputs[label] = {
        exit: r.code,
        timedOut: Boolean(r.timedOut),
        ms: r.durationMs,
        stdout: snippet(r.stdout),
        stderr: decoded.clixml
          ? { clixml: true, progressRecords: decoded.progress, otherStreamRecords: decoded.other, rawLength: r.stderr.length, errorText: snippet(decoded.errorText, 420) }
          : snippet(r.stderr),
      };
    },
  };
}

function report(c) {
  const failed = c.assertions.filter((x) => x.pass === false).length;
  const skipped = c.assertions.filter((x) => x.pass === null).length;
  const verdict = failed ? 'FAIL' : 'PASS';
  console.log(
    `[${A.target}] ${c.id}: ${verdict} (${c.assertions.length - failed - skipped} pass, ${failed} fail, ${skipped} skip)` +
      (failed ? ' -> ' + c.assertions.filter((x) => x.pass === false).map((x) => x.name).join(', ') : ''),
  );
}

async function guarded(caseApi, body) {
  try {
    await body(caseApi);
  } catch (error) {
    caseApi.check('case-completed-without-driver-error', false, `${error?.name ?? 'Error'}: ${error?.message ?? error}`);
  }
  report(caseApi.c);
}

// ---------------------------------------------------------------------------------------------
// Process, filesystem and network helpers

function run(file, argv, { env, cwd, timeoutMs = 60_000 } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(file, argv, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ code: null, stdout, stderr: `spawn failed: ${error.code ?? error.message}`, durationMs: 0 });
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const finish = (code, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ code, stdout, stderr: stderr + extra, timedOut, durationMs: Date.now() - started });
    };
    child.on('error', (e) => finish(null, `\nspawn error: ${e.code ?? e.message}`));
    child.on('close', (code) => finish(code));
  });
}

async function walk(root, visit) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    const st = await lstat(path);
    if (st.isSymbolicLink()) await visit(path, 'link', st);
    else if (st.isDirectory()) {
      await visit(path, 'dir', st);
      await walk(path, visit);
    } else await visit(path, 'file', st);
  }
}

/** Bytes, size and mtime of every file, plus directories and links, without following links. */
async function snapshot(root) {
  const out = {};
  await walk(root, async (path, type, st) => {
    const rel = relative(root, path);
    if (type === 'link') out[rel] = `link:${await readlink(path)}`;
    else if (type === 'dir') out[rel] = 'dir';
    else {
      const bytes = await readFile(path);
      out[rel] = `file:${bytes.length}:${sha(bytes)}:${st.mtimeMs}`;
    }
  });
  return out;
}

function diffSnapshots(before, after) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const removed = Object.keys(before).filter((k) => !(k in after));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  return { added, removed, changed, equal: !added.length && !removed.length && !changed.length };
}

/** Relative paths of files containing any canary as UTF-8 or UTF-16LE. Links are not followed. */
async function scanForCanaries(root, exclude = []) {
  const patterns = NEEDLES.flatMap((n) => [Buffer.from(n, 'utf8'), Buffer.from(n, 'utf16le')]);
  const hits = [];
  const unreadable = [];
  let files = 0;
  await walk(root, async (path, type) => {
    if (type !== 'file' || exclude.includes(path)) return;
    files++;
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      unreadable.push(relative(root, path));
      return;
    }
    if (patterns.some((p) => bytes.includes(p))) hits.push(relative(root, path));
  });
  return { hits, unreadable, files };
}

async function stageEntries(root) {
  const found = [];
  await walk(root, async (path) => {
    if (/gg-launcher-stage-/i.test(path)) found.push(relative(root, path));
  });
  return found;
}

/**
 * Records every filesystem event under root while `action` runs (staged-artifact detector). With
 * `capture`, a staged launcher JSON seen in an event is read at once and tested for canaries; only
 * the verdict and size are kept, never the content. Reads share delete/write, so they cannot block
 * the installer's own move or cleanup.
 */
async function watched(root, action, { capture = false } = {}) {
  const events = [];
  const captures = [];
  const pending = [];
  const watcher = watch(root, { recursive: true }, (type, name) => {
    events.push(`${type}:${name ?? '?'}`);
    if (capture && name && /gg-launcher-stage-[^\\/]+[\\/]GraphGoblin\.exe\.json$/i.test(name)) {
      pending.push(
        readFile(join(root, name)).then(
          (bytes) =>
            captures.push({
              name,
              bytes: bytes.length,
              canary: NEEDLES.some((n) => bytes.includes(Buffer.from(n, 'utf8')) || bytes.includes(Buffer.from(n, 'utf16le'))),
            }),
          () => captures.push({ name, bytes: null, canary: null }),
        ),
      );
    }
  });
  try {
    const value = await action();
    await new Promise((r) => setTimeout(r, 600));
    await Promise.all(pending);
    return { value, events, captures };
  } finally {
    watcher.close();
  }
}

async function bindable(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}

async function listening(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(2000, () => {
      socket.destroy();
      done(null);
    });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', (e) => done(e.code === 'ECONNREFUSED' ? false : null));
  });
}

async function choosePort(start) {
  for (let port = start; port < start + 40; port++) {
    // Bind first: only then is a connect probe expected to be refused, so no live service is used.
    if ((await bindable(port)) && (await listening(port)) === false) return port;
  }
  throw new Error('No free disposable port in range');
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body };
}

function chromeAppId(port) {
  // Independent computation of Chromium's app ID for http://127.0.0.1:<port>/app/.
  const inner = createHash('sha256').update(`http://127.0.0.1:${port}/app/`, 'utf8').digest();
  const bytes = createHash('sha256').update(inner).digest();
  let id = '';
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (bytes[i] >> 4), 97 + (bytes[i] & 15));
  return id;
}

// ---------------------------------------------------------------------------------------------
// Main

async function main() {
  const stamp = results.startedAt.replace(/[-:]/g, '').replace(/\..*$/, '');
  const F = resolve(A.fixtures, `${A.target}-${A.rev.slice(0, 7)}-${stamp}`);
  results.fixtureRoot = F;
  const ENV_DIR = join(F, 'env');
  const PROFILE = join(ENV_DIR, 'profile');
  const TEMP = join(ENV_DIR, 'temp');
  const TOOLS = join(F, 'tools');
  const REPO = join(F, 'repo');
  const W = join(F, 'w'); // watched outputs and inputs the installer could write
  const INSTALL = join(W, 'Launcher Install');
  const STORE = join(W, 'store');
  const DESKTOP = join(W, 'links', 'Desktop', 'GraphGoblin.lnk');
  const PROGRAMS = join(W, 'links', 'Programs', 'GraphGoblin.lnk');
  const PWA_DIR = join(W, 'pwa', 'Chrome Apps');
  const SOURCE = join(PWA_DIR, 'GraphGoblin.lnk');
  const PROXY = join(W, 'pwa', 'chrome_proxy.exe');
  const MANUAL = join(F, 'manual');
  const EXE = join(INSTALL, 'GraphGoblin.exe');
  const CONFIG = EXE + '.json';

  for (const d of [PROFILE, join(PROFILE, 'AppData', 'Roaming'), join(PROFILE, 'AppData', 'Local'), TEMP, TOOLS,
    join(REPO, 'apps', 'windows-launcher'), join(REPO, 'apps', 'api'), join(REPO, 'apps', 'web'), STORE,
    dirname(DESKTOP), dirname(PROGRAMS), PWA_DIR, join(F, 'src', 'scripts')])
    await mkdir(d, { recursive: true });

  // Explicitly constructed child environment: fixture profile/temp, minimal PATH, nothing inherited.
  const nodeDir = dirname(process.execPath);
  const baseEnv = {
    SystemRoot: SYSROOT,
    windir: SYSROOT,
    SystemDrive: SYSROOT.slice(0, 2),
    OS: 'Windows_NT',
    PATH: [nodeDir, SYS32, join(SYS32, 'Wbem'), join(SYS32, 'WindowsPowerShell', 'v1.0')].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    ComSpec: join(SYS32, 'cmd.exe'),
    PROCESSOR_ARCHITECTURE: 'AMD64',
    TEMP,
    TMP: TEMP,
    USERPROFILE: PROFILE,
    APPDATA: join(PROFILE, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(PROFILE, 'AppData', 'Local'),
    PSModulePath: join(SYS32, 'WindowsPowerShell', 'v1.0', 'Modules'),
  };
  const inheritedGg = {
    GG_MASTER_KEY: CANARY.inheritedMaster,
    GG_JEV_API_KEY: CANARY.inheritedJev,
    // Invalid values: the gateway's config would refuse to start if any were passed through.
    GG_TIMER_POLL_MS: 'invalid-inherited-value',
    GG_SHUTDOWN_GRACE_MS: 'invalid-inherited-value',
  };
  const gitEnv = {
    SystemRoot: SYSROOT,
    PATH: [dirname(A.git), SYS32].join(';'),
    HOME: process.env.USERPROFILE ?? PROFILE, // named lookup so git reads the user's own config
  };
  const git = (argv) => run(A.git, ['-C', CHECKOUT, '--no-optional-locks', ...argv], { env: gitEnv, timeoutMs: 30_000 });

  let SID = null;
  async function privateDirectory(path) {
    await mkdir(path, { recursive: true });
    if (!SID) {
      const who = await run(join(SYS32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { env: baseEnv });
      SID = /"(S-1-[0-9-]+)"/.exec(who.stdout)?.[1];
      if (!SID) throw new Error('Current user SID unavailable');
    }
    const r = await run(join(SYS32, 'icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${SID}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { env: baseEnv });
    if (r.code !== 0) throw new Error('icacls failed for a fixture directory');
  }

  let gatewayPort = null;
  let gatewayPid = null;
  async function lockPid() {
    try {
      return JSON.parse(await readFile(join(STORE, 'graphgoblin.lock'), 'utf8')).pid ?? null;
    } catch {
      return null;
    }
  }
  async function stopOwnGateway() {
    if (!gatewayPort) return { result: 'not-started' };
    const state = await listening(gatewayPort);
    if (state !== true) return { result: 'not-listening' };
    const owner = await lockPid();
    let headerPid = null;
    try {
      headerPid = Number((await getJson(gatewayPort, '/healthz')).headers.get('x-graphgoblin-pid'));
    } catch {
      /* fall through */
    }
    if (!owner || headerPid !== owner) return { result: 'not-ours-left-alone' };
    await fetch(`http://127.0.0.1:${gatewayPort}/system/shutdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'drain' }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    for (let i = 0; i < 150; i++) {
      if ((await listening(gatewayPort)) === false) return { result: 'drained' };
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      process.kill(owner); // our own disposable gateway, identity verified via its store lock
      return { result: 'killed-after-drain-timeout' };
    } catch {
      return { result: 'drain-failed' };
    }
  }

  // ----- Setup and provenance ------------------------------------------------------------------
  const setup = addCase('S0-setup', 'setup', 'Provenance, disposable fixture and synthetic PWA shortcut');
  let installerPath;
  let installerText;
  let launcherText;
  let gitBefore;
  let ready = false;
  await guarded(setup, async (t) => {
    const head = await git(['rev-parse', 'HEAD']);
    results.checkoutHead = head.stdout.trim();
    gitBefore = (await git(['status', '--porcelain=v1'])).stdout;
    t.check('checkout-head-recorded', /^[0-9a-f]{40}$/.test(results.checkoutHead), results.checkoutHead);
    if (A.target === 'candidate')
      t.check('checkout-head-is-candidate', results.checkoutHead === A.rev, `${results.checkoutHead} vs ${A.rev}`);
    t.check('checkout-clean-before', gitBefore.trim() === '', snippet(gitBefore));
    const blobInstaller = Buffer.from((await git(['cat-file', 'blob', `${A.rev}:${INSTALLER_REL}`])).stdout, 'utf8');
    const blobLauncher = Buffer.from((await git(['cat-file', 'blob', `${A.rev}:${LAUNCHER_REL}`])).stdout, 'utf8');
    t.check('revision-blobs-read', blobInstaller.length > 1000 && blobLauncher.length > 1000,
      `installer ${blobInstaller.length} B, launcher ${blobLauncher.length} B`);
    if (A.target === 'candidate') {
      installerPath = join(CHECKOUT, INSTALLER_REL);
      const wtInstaller = await readFile(installerPath);
      const wtLauncher = await readFile(join(CHECKOUT, LAUNCHER_REL));
      t.check('shipped-installer-equals-revision-blob', sha(wtInstaller) === sha(blobInstaller), sha(wtInstaller).slice(0, 16));
      t.check('shipped-launcher-equals-revision-blob', sha(wtLauncher) === sha(blobLauncher), sha(wtLauncher).slice(0, 16));
      await writeFile(join(REPO, 'apps', 'windows-launcher', 'Launcher.cs'), wtLauncher);
    } else {
      installerPath = join(F, 'src', 'scripts', 'install-windows-launcher.ps1');
      await writeFile(installerPath, blobInstaller);
      await writeFile(join(REPO, 'apps', 'windows-launcher', 'Launcher.cs'), blobLauncher);
      t.check('baseline-files-extracted', true, `installer ${sha(blobInstaller).slice(0, 16)}, launcher ${sha(blobLauncher).slice(0, 16)}`);
    }
    installerText = (await readFile(installerPath)).toString('utf8');
    launcherText = (await readFile(join(REPO, 'apps', 'windows-launcher', 'Launcher.cs'))).toString('utf8');
    results.tools = {
      driverSha256: sha(await readFile(new URL(import.meta.url))),
      node: process.version,
      nodePath: process.execPath,
      powershell: POWERSHELL,
      csc: CSC,
      installer: installerPath,
      installerSha256: sha(installerText),
      launcherSha256: sha(launcherText),
    };
    // Disposable repo: revision-specific Launcher.cs, junctions to the coordinator-built dist.
    await symlink(join(CHECKOUT, 'apps', 'api', 'dist'), join(REPO, 'apps', 'api', 'dist'), 'junction');
    await symlink(join(CHECKOUT, 'apps', 'web', 'dist'), join(REPO, 'apps', 'web', 'dist'), 'junction');
    const marker = (await readFile(join(REPO, 'apps', 'api', 'dist', 'main.js'), 'utf8')).slice(0, 4096);
    t.check('built-entry-has-log-protocol', marker.includes('export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;'));

    await privateDirectory(INSTALL);
    await privateDirectory(MANUAL);
    const port = await choosePort(Number(A['port-start'] ?? (A.target === 'candidate' ? 46437 : 46487)));
    results.port = port;
    t.check('disposable-port-free-before-use', true, `port ${port}: bind succeeded and connect refused`);

    // Fixture tool: the target revision's launcher, compiled by csc, used only to stamp the
    // synthetic PWA shortcut's AppUserModelID and cross-check the app ID.
    const tool = join(TOOLS, 'fixture-launcher.exe');
    const compiled = await run(CSC, ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll', `/out:${tool}`, join(REPO, 'apps', 'windows-launcher', 'Launcher.cs')],
    { env: baseEnv, cwd: TOOLS, timeoutMs: 120_000 });
    t.check('fixture-tool-compiled', compiled.code === 0, snippet(compiled.stdout + compiled.stderr));
    const appId = chromeAppId(port);
    const productAppId = (await run(tool, ['--expected-app-id', String(port)], { env: baseEnv })).stdout.trim();
    t.check('independent-app-id-matches-product', appId === productAppId, `${appId} / ${productAppId}`);
    await writeFile(PROXY, 'Inert QA437 Shell Link target fixture; never executed');
    const linkScript = [
      "$ErrorActionPreference = 'Stop'",
      '$r = $env:QA437_REQUEST | ConvertFrom-Json',
      '$shell = New-Object -ComObject WScript.Shell',
      '$s = $shell.CreateShortcut($r.source)',
      '$s.TargetPath = $r.proxy',
      '$s.Arguments = $r.arguments',
      '$s.Save()',
    ].join('\n');
    const made = await run(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(linkScript, 'utf16le').toString('base64')], {
      env: { ...baseEnv, QA437_REQUEST: JSON.stringify({ source: SOURCE, proxy: PROXY, arguments: `--profile-directory="Default" --app-id=${appId}` }) },
      cwd: F,
    });
    t.check('synthetic-pwa-shortcut-created', made.code === 0, snippet(made.stderr));
    const toolConfig = join(TOOLS, 'fixture.json');
    await writeFile(toolConfig, JSON.stringify({
      Repo: REPO, Node: process.execPath, DataDir: join(TOOLS, 'unused-store'), Port: port, Environment: {},
      StartupTimeoutSeconds: 30, WindowTimeoutSeconds: 2, LauncherAppUserModelId: 'Chrome.QA437Fixture',
    }));
    const stamped = await run(tool, ['--ensure-gateway', '--config', toolConfig, '--stamp-shortcut', SOURCE], { env: baseEnv });
    const id = await run(tool, ['--read-shortcut-id', SOURCE], { env: baseEnv });
    t.check('synthetic-pwa-shortcut-stamped', stamped.code === 0 && id.stdout.trim() === 'Chrome.QA437Fixture',
      `stamp exit ${stamped.code}; id ${snippet(id.stdout)}`);
    t.check('store-empty-before', (await readdir(STORE)).length === 0);
    ready = setup.c.assertions.every((x) => x.pass !== false);
  });
  if (!ready) return finish(F);

  // ----- Code inspection (evidence kind: inspection) ------------------------------------------
  const insp = addCase('I1-inspection', 'inspection', 'Static inspection of the target revision installer and launcher');
  await guarded(insp, async (t) => {
    const tryIdx = installerText.indexOf('\ntry {');
    const refuseIdx = installerText.search(/'GG_MASTER_KEY', \[StringComparison\]::OrdinalIgnoreCase/);
    const jevIdx = installerText.search(/'GG_JEV_API_KEY', \[StringComparison\]::OrdinalIgnoreCase/);
    const firstAction = Math.min(
      ...['$NodePath = Get-InstallerNode $NodePath', 'New-InstallerStage $destinations[0].Anchor', 'WriteAllText($stagedConfig']
        .map((s) => installerText.indexOf(s)).filter((i) => i >= 0),
    );
    t.check('installer-refuses-both-keys-case-insensitively-before-node-stage-or-write',
      refuseIdx > tryIdx && jevIdx > tryIdx && refuseIdx < firstAction && jevIdx < firstAction,
      `try@${tryIdx} master@${refuseIdx} jev@${jevIdx} firstAction@${firstAction}`, 'inspection');
    const paramBlock = installerText.slice(installerText.indexOf('param('), installerText.indexOf("$ErrorActionPreference = 'Stop'"));
    const declared = [...paramBlock.matchAll(/^\s*(?:\[[^\]]*\])*\$([A-Za-z]+)/gm)].map((m) => m[1]);
    t.check('installer-has-no-acknowledgement-or-bypass-parameter',
      declared.length > 5 && !declared.some((n) => /ack|allow|force|insecure|bypass|secret|unsafe/i.test(n)),
      `declared: ${declared.join(', ')}`, 'inspection');
    const validate = launcherText.slice(launcherText.indexOf('public void Validate(bool gatewayOnly)'),
      launcherText.indexOf('public static bool HasLogProtocol'));
    const vm = validate.indexOf('"GG_MASTER_KEY", StringComparison.OrdinalIgnoreCase');
    const vj = validate.indexOf('"GG_JEV_API_KEY", StringComparison.OrdinalIgnoreCase');
    const loop = validate.indexOf('must contain GG_* string overrides only');
    t.check('launcher-validate-refuses-both-keys-case-insensitively', vm > 0 && vj > 0 && vm < loop && vj < loop,
      `master@${vm} jev@${vj} ggLoop@${loop}`, 'inspection');
    const mainBody = launcherText.slice(launcherText.indexOf('public static int Main('), launcherText.indexOf('public static string Present('));
    const v = mainBody.indexOf('config.Validate(gatewayOnly);');
    t.check('launcher-validates-before-shortcut-or-gateway-actions',
      v > 0 && v < mainBody.indexOf('StampShortcut') && v < mainBody.indexOf('CreateShortcut') && v < mainBody.indexOf('new Gateway('),
      `validate@${v}`, 'inspection');
    const prep = launcherText.slice(launcherText.indexOf('static int PrepareInstallation('), launcherText.indexOf('static bool IsFullyQualifiedWindowsPath('));
    t.check('staged-validator-validates-before-creating-shortcut',
      prep.indexOf('config.Validate(false);') > 0 && prep.indexOf('config.Validate(false);') < prep.indexOf('CreateShortcut'), '', 'inspection');
  });

  // ----- Installer invocation ------------------------------------------------------------------
  const commonOptions = { RepoPath: REPO, NodePath: process.execPath, DataDir: STORE, Port: results.port, PwaShortcut: SOURCE, InstallDir: INSTALL };
  function envLiteral(entries) {
    return '@{ ' + entries.map(({ key, value }) => {
      if (!/^[A-Za-z_]+$/.test(key)) throw new Error('Unsafe key for literal');
      let v;
      if (value.kind === 'fixed') {
        if (!/^[A-Za-z0-9._-]*$/.test(value.text)) throw new Error('Unsafe fixed value');
        v = `'${value.text}'`;
      } else if (value.kind === 'empty') v = "''";
      else v = '$qaValue';
      return `'${key}' = ${v}`;
    }).join('; ') + ' }';
  }
  const fixed = (obj) => Object.entries(obj).map(([key, text]) => ({ key, value: { kind: 'fixed', text } }));
  function runInstaller({ entries, noShortcuts = false, secretValue, inherited = {} }) {
    const options = { ...commonOptions };
    if (!noShortcuts) Object.assign(options, { DesktopShortcut: DESKTOP, StartMenuShortcut: PROGRAMS });
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$qaRequest = $env:QA437_REQUEST | ConvertFrom-Json',
      '$qaValue = $env:QA437_VALUE',
      'Remove-Item Env:QA437_REQUEST, Env:QA437_VALUE -ErrorAction SilentlyContinue',
      '$qaOptions = @{}',
      'foreach ($p in $qaRequest.options.PSObject.Properties) { $qaOptions[$p.Name] = $p.Value }',
      "if ($qaRequest.noShortcuts) { $qaOptions['NoShortcuts'] = $true }",
      `& $qaRequest.installer @qaOptions -Environment ${envLiteral(entries)}`,
    ].join('\n');
    const env = { ...baseEnv, ...inherited, QA437_REQUEST: JSON.stringify({ installer: installerPath, options, noShortcuts }) };
    if (secretValue !== undefined) env.QA437_VALUE = secretValue;
    return run(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { env, cwd: F, timeoutMs: 180_000 });
  }
  const runExe = (argv, env = baseEnv, timeoutMs = 60_000) => run(EXE, argv, { env, cwd: F, timeoutMs });

  // ----- P1: ordinary install with explicit safe overrides and inherited GG canaries ----------
  let installedConfig = null;
  const p1 = addCase('P1-ordinary-install', 'positive', 'Explicit ordinary overrides persist; inherited GG_* (incl. synthetic credentials) are not persisted',
    { explicit: Object.keys(SAFE), inherited: Object.keys(inheritedGg), shortcuts: true });
  await guarded(p1, async (t) => {
    const sourceBefore = sha(await readFile(SOURCE));
    const { value: r, events } = await watched(W, () => runInstaller({ entries: fixed(SAFE), inherited: inheritedGg }));
    t.output('installer', r);
    t.check('installer-exit-0', r.code === 0 && !r.timedOut, `exit ${r.code}`);
    t.check('installer-reports-configured', r.stdout.includes('Launcher configured.'), snippet(r.stdout));
    const decoded = decodeStderr(r.stderr);
    t.check('installer-stderr-has-no-error-records', decoded.errorText.trim() === '',
      `clixml ${decoded.clixml}, progress ${decoded.progress}, error text: ${snippet(decoded.errorText)}`);
    t.check('no-canary-in-installer-output', !hasNeedle(r.stdout + r.stderr + decoded.errorText));
    const raw = await readFile(CONFIG, 'utf8');
    installedConfig = JSON.parse(raw);
    t.check('installed-environment-equals-explicit-overrides', JSON.stringify(Object.entries(installedConfig.Environment).sort()) === JSON.stringify(Object.entries(SAFE).sort()),
      `keys: ${Object.keys(installedConfig.Environment).join(', ')}`);
    t.check('installed-json-has-no-inherited-gg-keys', !/GG_MASTER_KEY|GG_JEV_API_KEY|GG_TIMER_POLL_MS|GG_SHUTDOWN_GRACE_MS/i.test(raw));
    t.check('installed-json-has-no-canary', !hasNeedle(raw));
    t.check('installed-config-paths-explicit', installedConfig.Repo === REPO && installedConfig.DataDir === STORE && installedConfig.Port === results.port,
      `Repo/DataDir/Port explicit`);
    const v = await runExe(['--validate-install', '--config', CONFIG]);
    t.output('validate-installed', v);
    t.check('ordinary-setup-valid-native-validate-exit-0', v.code === 0 && v.stdout === '' && v.stderr === '', `exit ${v.code} ${snippet(v.stderr)}`);
    t.check('desktop-and-start-menu-shortcuts-published', (await lstat(DESKTOP)).isFile() && (await lstat(PROGRAMS)).isFile());
    t.check('pwa-source-shortcut-unchanged', sha(await readFile(SOURCE)) === sourceBefore);
    t.check('stage-detector-positive-control-saw-stage', events.some((e) => /gg-launcher-stage-/i.test(e)), `${events.length} fs events`);
    const leftover = await stageEntries(F);
    t.check('no-stage-left-after-success', leftover.length === 0, leftover.join(', '));
    const scan = await scanForCanaries(F);
    t.check('no-canary-at-rest-in-fixture', scan.hits.length === 0, `hits: ${scan.hits.join(', ')}; files ${scan.files}; unreadable ${scan.unreadable.length}`);
    const shortcut = await runExe(['--inspect-shortcut', DESKTOP]);
    t.check('published-shortcut-targets-installed-launcher', shortcut.code === 0 && shortcut.stdout.includes('GraphGoblin.exe'), snippet(shortcut.stdout, 200));
  });
  if (!installedConfig) return finish(F);

  // ----- R*: installer refusal matrix ----------------------------------------------------------
  for (const variant of KEY_VARIANTS) {
    for (const valueKind of ['synthetic', 'empty']) {
      for (const noShortcuts of [false, true]) {
        const id = `R-${variant.key}-${valueKind}-${noShortcuts ? 'noshortcuts' : 'shortcuts'}`;
        const t = addCase(id, 'refusal-installer', `Installer refuses explicit ${variant.casing}-case ${variant.secret} key`,
          { key: variant.key, casing: variant.casing, secret: variant.secret, value: valueKind, noShortcuts, alongside: Object.keys(SAFE) });
        await guarded(t, async () => {
          const before = await snapshot(W);
          const jsonHadKeyBefore = /GG_MASTER_KEY|GG_JEV_API_KEY/i.test(await readFile(CONFIG, 'utf8'));
          const secretValue = valueKind === 'empty' ? undefined
            : variant.secret === 'master' ? CANARY.explicitMaster : CANARY.explicitJev;
          const entries = [...fixed(SAFE), { key: variant.key, value: { kind: valueKind === 'empty' ? 'empty' : 'secret' } }];
          const { value: r, events, captures } = await watched(W, () => runInstaller({ entries, noShortcuts, secretValue }), { capture: true });
          t.output('installer', r);
          t.check('installer-exit-nonzero', r.code !== 0 && !r.timedOut, `exit ${r.code}`);
          const decoded = decodeStderr(r.stderr);
          t.check('stderr-has-fixed-refusal-text', squash(decoded.errorText).includes(squash(REFUSAL)),
            `clixml ${decoded.clixml}: ${snippet(decoded.errorText, 200)}`);
          t.check('stdout-not-configured', !r.stdout.includes('Launcher configured.'), snippet(r.stdout));
          t.check('no-canary-in-output', !hasNeedle(r.stdout + r.stderr + decoded.errorText));
          const after = await snapshot(W);
          const d = diffSnapshots(before, after);
          t.check('preexisting-files-unchanged', d.equal, `added ${d.added.length}, removed ${d.removed.length}, changed ${d.changed.join(', ')}`);
          t.check('no-fs-events-during-refusal', events.length === 0, `${events.length} events: ${events.slice(0, 6).join(' | ')}`);
          const leftover = await stageEntries(F);
          t.check('no-stage-artifacts', leftover.length === 0, leftover.join(', '));
          const stagedWithCanary = captures.filter((x) => x.canary === true).length;
          t.check('no-transient-staged-config-with-canary', stagedWithCanary === 0,
            `staged JSON reads: ${captures.length}; non-empty: ${captures.filter((x) => x.bytes > 0).length}; carrying canary: ${stagedWithCanary}`);
          const json = await readFile(CONFIG, 'utf8');
          const jsonHasKeyAfter = /GG_MASTER_KEY|GG_JEV_API_KEY/i.test(json);
          t.check('installed-json-has-no-secret-key', !jsonHasKeyAfter,
            `secret key in installed JSON before case: ${jsonHadKeyBefore}; after: ${jsonHasKeyAfter}`);
          const scan = await scanForCanaries(F);
          t.check('no-canary-at-rest-in-fixture', scan.hits.length === 0, `hits: ${scan.hits.join(', ')}`);
        });
      }
    }
  }

  // ----- N*: native launcher refuses manually edited configuration -----------------------------
  const manualCases = [
    ...KEY_VARIANTS.map((v) => ({ ...v, valueKind: 'synthetic' })),
    { ...KEY_VARIANTS[0], valueKind: 'empty' },
    { ...KEY_VARIANTS[1], valueKind: 'empty' },
  ];
  for (const variant of manualCases) {
    const id = `N-${variant.key}-${variant.valueKind}`;
    const t = addCase(id, 'refusal-native', `Native launcher refuses manually edited JSON with ${variant.casing}-case ${variant.secret} key`,
      { key: variant.key, casing: variant.casing, secret: variant.secret, value: variant.valueKind });
    await guarded(t, async () => {
      const manual = join(MANUAL, 'manual-credential-config.json');
      const value = variant.valueKind === 'empty' ? '' : variant.secret === 'master' ? CANARY.manualMaster : CANARY.manualJev;
      await writeFile(manual, JSON.stringify({ ...installedConfig, Environment: { ...installedConfig.Environment, [variant.key]: value } }));
      const manualBytes = sha(await readFile(manual));
      const stampTarget = join(MANUAL, 'stamp-target.lnk');
      await copyFile(DESKTOP, stampTarget);
      const stampBefore = sha(await readFile(stampTarget));
      const before = await snapshot(W);
      const logBefore = await readFile(join(MANUAL, 'launcher.log'), 'utf8').catch(() => '');
      const staged = join(MANUAL, 'refused-stage.lnk');
      const created = join(MANUAL, 'refused-create.lnk');
      const modes = [
        ['validate-install', ['--validate-install', '--config', manual]],
        ['stage-shortcut', ['--stage-shortcut', staged, manual, EXE]],
        ['create-shortcut', ['--config', manual, '--create-shortcut', created]],
        ['stamp-shortcut', ['--config', manual, '--stamp-shortcut', stampTarget]],
        ['ensure-gateway', ['--ensure-gateway', '--config', manual]],
      ];
      for (const [mode, argv] of modes) {
        if (A.target === 'baseline' && mode === 'ensure-gateway') {
          t.skip(`${mode}-refused`, 'Not executed on baseline: it would start a gateway carrying a synthetic credential.');
          continue;
        }
        const r = await runExe(argv);
        t.output(mode, r);
        t.check(`${mode}-exit-1`, r.code === 1 && !r.timedOut, `exit ${r.code}`);
        t.check(`${mode}-stdout-empty`, r.stdout === '', snippet(r.stdout));
        t.check(`${mode}-stderr-starts-with-refusal`, r.stderr.startsWith(REFUSAL), snippet(r.stderr, 200));
        t.check(`${mode}-no-canary-in-output`, !hasNeedle(r.stdout + r.stderr));
      }
      t.check('manual-json-unchanged', sha(await readFile(manual)) === manualBytes);
      t.check('no-staged-shortcut-created', await lstat(staged).then(() => false, () => true));
      t.check('no-created-shortcut', await lstat(created).then(() => false, () => true));
      t.check('stamp-target-unchanged', sha(await readFile(stampTarget)) === stampBefore);
      const d = diffSnapshots(before, await snapshot(W));
      t.check('install-store-links-unchanged', d.equal, `added ${d.added.join(', ')}; changed ${d.changed.join(', ')}`);
      t.check('store-still-empty', (await readdir(STORE)).length === 0);
      t.check('no-gateway-listening', (await listening(results.port)) === false);
      const log = await readFile(join(MANUAL, 'launcher.log'), 'utf8').catch(() => '');
      const fresh = log.slice(logBefore.length);
      if (A.target === 'candidate') {
        t.check('launcher-log-records-configuration-refused', /"code":"configuration-refused"/.test(fresh), `${fresh.length} new bytes`);
      }
      t.check('launcher-log-has-no-canary', !hasNeedle(log));
      await unlink(manual); // QA-authored input carrying the canary; removed before at-rest scan
      for (const p of [stampTarget, staged, created]) await unlink(p).catch(() => null);
      const scan = await scanForCanaries(F);
      t.check('no-canary-at-rest-in-fixture', scan.hits.length === 0, `hits: ${scan.hits.join(', ')}`);
    });
  }

  // ----- P2: reinstall with ordinary overrides after refusals ----------------------------------
  const p2 = addCase('P2-ordinary-reinstall', 'positive', 'Ordinary overrides remain usable after refusals (reinstall over existing files)',
    { explicit: Object.keys(SAFE_REINSTALL), inherited: Object.keys(inheritedGg) });
  let reinstalled = false;
  await guarded(p2, async (t) => {
    const r = await runInstaller({ entries: fixed(SAFE_REINSTALL), inherited: inheritedGg });
    t.output('installer', r);
    const decoded = decodeStderr(r.stderr);
    t.check('installer-exit-0', r.code === 0 && r.stdout.includes('Launcher configured.') && decoded.errorText.trim() === '',
      `exit ${r.code}; error text: ${snippet(decoded.errorText)}`);
    t.check('no-canary-in-installer-output', !hasNeedle(r.stdout + r.stderr + decoded.errorText));
    const raw = await readFile(CONFIG, 'utf8');
    const cfg = JSON.parse(raw);
    t.check('installed-environment-equals-new-explicit-overrides',
      JSON.stringify(Object.entries(cfg.Environment).sort()) === JSON.stringify(Object.entries(SAFE_REINSTALL).sort()), Object.keys(cfg.Environment).join(', '));
    t.check('installed-json-has-no-secret-or-inherited-keys', !/GG_MASTER_KEY|GG_JEV_API_KEY|GG_TIMER_POLL_MS|GG_SHUTDOWN_GRACE_MS/i.test(raw) && !hasNeedle(raw));
    const v = await runExe(['--validate-install', '--config', CONFIG]);
    t.output('validate-installed', v);
    t.check('native-validate-exit-0', v.code === 0 && v.stdout === '' && v.stderr === '', `exit ${v.code}`);
    t.check('no-stage-left', (await stageEntries(F)).length === 0);
    reinstalled = p2.c.assertions.every((x) => x.pass !== false);
  });

  // ----- P3: gateway through the installed launcher with inherited GG canaries -----------------
  const p3 = addCase('P3-gateway-inherited-excluded', 'positive',
    'Installed launcher starts the disposable gateway; explicit overrides apply, inherited GG_* (incl. synthetic credentials) are cleared',
    { inherited: Object.keys(inheritedGg) });
  await guarded(p3, async (t) => {
    if (!reinstalled) {
      t.skip('gateway-run', 'Skipped: the ordinary reinstall did not pass, so the installed config is not the ordinary one.');
      return;
    }
    t.check('port-free-before-gateway', (await listening(results.port)) === false && (await bindable(results.port)), `port ${results.port}`);
    gatewayPort = results.port;
    try {
      const r = await runExe(['--ensure-gateway', '--config', CONFIG], { ...baseEnv, ...inheritedGg }, 90_000);
      t.output('ensure-gateway', r);
      t.check('ensure-gateway-exit-0-silent', r.code === 0 && r.stdout === '' && r.stderr === '', `exit ${r.code} ${snippet(r.stderr)}`);
      t.check('no-canary-in-launcher-output', !hasNeedle(r.stdout + r.stderr));
      const h = await getJson(results.port, '/healthz');
      gatewayPid = Number(h.headers.get('x-graphgoblin-pid'));
      const owner = await lockPid();
      t.check('healthz-200', h.status === 200, `status ${h.status}`);
      t.check('gateway-identity-is-our-disposable-store', owner !== null && owner === gatewayPid, `lock pid matches header pid: ${owner === gatewayPid}`);
      if (owner === null || owner !== gatewayPid) return;
      t.check('master-key-file-created-so-inherited-master-key-unused', await lstat(join(STORE, 'master.key')).then((s) => s.isFile(), () => false));
      const secrets = await getJson(results.port, '/secrets');
      t.check('secrets-list-empty-so-inherited-jev-key-not-seeded', secrets.status === 200 && Array.isArray(secrets.body?.items) && secrets.body.items.length === 0,
        `status ${secrets.status}, items ${secrets.body?.items?.length}`);
      const docs = await fetch(`http://127.0.0.1:${results.port}/docs`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      t.check('explicit-GG_SWAGGER_UI-false-applied-docs-404', docs.status === 404, `status ${docs.status}`);
    } finally {
      const stopped = await stopOwnGateway();
      t.check('gateway-drained', stopped.result === 'drained', stopped.result);
      t.check('port-closed-after', (await listening(results.port)) === false);
    }
    const gatewayLog = await readFile(join(INSTALL, 'gateway.log'), 'utf8').catch(() => '');
    t.check('gateway-log-written-at-explicit-info-level', gatewayLog.length > 0, `${gatewayLog.length} bytes`);
    t.check('gateway-log-has-no-jev-seeding', !/seeded jev-api-key/.test(gatewayLog));
    t.check('gateway-log-has-no-canary', !hasNeedle(gatewayLog));
    const storeScan = await scanForCanaries(STORE);
    t.check('store-has-no-canary', storeScan.hits.length === 0 && storeScan.unreadable.length === 0,
      `files ${storeScan.files}; hits ${storeScan.hits.join(', ')}; unreadable ${storeScan.unreadable.join(', ')}`);
  });

  // ----- Z: final integrity ----------------------------------------------------------------------
  const z = addCase('Z-final', 'integrity', 'No canary or stage at rest; checkout and Git unchanged');
  await guarded(z, async (t) => {
    const stopped = await stopOwnGateway();
    t.check('no-gateway-left-running', ['not-started', 'not-listening', 'drained'].includes(stopped.result), stopped.result);
    const scan = await scanForCanaries(F);
    t.check('no-canary-at-rest-anywhere-in-fixture', scan.hits.length === 0, `files ${scan.files}; hits ${scan.hits.join(', ')}; unreadable ${scan.unreadable.join(', ')}`);
    t.check('no-stage-artifacts-anywhere', (await stageEntries(F)).length === 0);
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const status = (await git(['status', '--porcelain=v1'])).stdout;
    t.check('checkout-head-unchanged', head === results.checkoutHead, head);
    t.check('checkout-status-unchanged-and-clean', status === gitBefore && status.trim() === '', snippet(status));
    t.check('shipped-installer-bytes-unchanged', sha(await readFile(installerPath, 'utf8')) === results.tools.installerSha256);
  });

  return finish(F);
}

async function finish(F) {
  // Remove the fixture's junctions into the checkout so a later recursive delete of the scratch
  // folder can never traverse into the built checkout. Links are unlinked, never followed.
  const cleanup = addCase('C-cleanup', 'integrity', 'Fixture junctions into the checkout removed; checkout build intact');
  await guarded(cleanup, async (t) => {
    const links = [];
    if (F && F !== '(none)') await walk(F, async (path, type) => { if (type === 'link') links.push(path); });
    for (const link of links) await unlink(link);
    const remaining = [];
    if (F && F !== '(none)') await walk(F, async (path, type) => { if (type === 'link') remaining.push(path); });
    t.check('fixture-junctions-removed', remaining.length === 0, `removed ${links.length}, remaining ${remaining.length}`);
    const intact = await Promise.all(['apps/api/dist/main.js', 'apps/web/dist/index.html']
      .map((p) => lstat(join(CHECKOUT, p)).then((s) => s.isFile(), () => false)));
    t.check('checkout-build-intact-after-unlink', intact.every(Boolean));
  });
  results.finishedAt = new Date().toISOString();
  const all = results.cases.flatMap((c) => c.assertions);
  results.counts = {
    cases: results.cases.length,
    casesPassed: results.cases.filter((c) => c.assertions.length && c.assertions.every((x) => x.pass !== false)).length,
    casesFailed: results.cases.filter((c) => c.assertions.some((x) => x.pass === false)).length,
    assertions: all.length,
    passed: all.filter((x) => x.pass === true).length,
    failed: all.filter((x) => x.pass === false).length,
    skipped: all.filter((x) => x.pass === null).length,
    byEvidence: {
      execution: all.filter((x) => x.evidence === 'execution').length,
      inspection: all.filter((x) => x.evidence === 'inspection').length,
    },
  };
  let text = JSON.stringify(results, null, 1);
  // Self-check: the results file must never carry a synthetic value.
  if (hasNeedle(text)) {
    text = sanitize(text);
    results.notes.push('Self-check found and redacted a canary in results.');
  }
  await mkdir(dirname(resolve(A.out)), { recursive: true });
  await writeFile(resolve(A.out), text + '\n');
  console.log(`[${A.target}] cases ${results.counts.cases} (pass ${results.counts.casesPassed}, fail ${results.counts.casesFailed}); ` +
    `assertions ${results.counts.assertions} (pass ${results.counts.passed}, fail ${results.counts.failed}, skip ${results.counts.skipped})`);
  console.log(`[${A.target}] results: ${resolve(A.out)}`);
  console.log(`[${A.target}] fixtures: ${F}`);
}

main().catch(async (error) => {
  console.error(`driver error: ${sanitize(error?.message ?? error)}`);
  results.notes.push(`driver error: ${sanitize(error?.message ?? error)}`);
  await finish(results.fixtureRoot ?? '(none)');
  process.exitCode = 2;
});
