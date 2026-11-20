// GraphGoblin #437 independent touched-systems QA driver (correction a5cb060 and later candidates).
//
// Systems under test, through their normal entry points only:
//   1. scripts/install-windows-launcher.ps1, run by Windows PowerShell 5.1 the way the guide
//      documents it: `& <script> ... -Environment @{ ... }` from a PowerShell session (and once
//      through the guide's literal `powershell -ExecutionPolicy Bypass -File <script> ...` route).
//   2. The native launcher configuration path (apps/windows-launcher/Launcher.cs) as compiled and
//      published by that installer, through non-launching verbs only.
//
// Safety rules enforced in code:
//   - The parent environment is never enumerated. Only SystemRoot is read, by name. Every child
//     process receives an explicitly constructed environment rooted in the disposable case folder.
//   - Synthetic values are random per run and travel to PowerShell on stdin only (never argv).
//     The only files this driver writes with a synthetic value are N01's operator-edited manual
//     JSON inputs inside the disposable run folder, which is removed at the end. Recorded text
//     is redacted and the results file is self-checked before and after it is written.
//   - Every installer run names an explicit disposable RepoPath, DataDir, InstallDir and synthetic
//     PwaShortcut inside the run folder, plus explicit shortcut destinations or -NoShortcuts.
//   - No network endpoint is contacted. The port only selects the expected Chrome app ID. The
//     native launcher is never asked to start a gateway or open a window.
//   - The checkout is only read (git --no-optional-locks; no index refresh, no writes).
//
// Usage:
//   node qa437-correction-driver.mjs --checkout <built checkout> --out <qa folder> --label <name>
//        [--expect-head <sha>] [--rev <git rev>] [--only ID,ID] [--port 47437] [--git <git.exe>]
//   --rev replays the installer and Launcher.cs of a historical revision (read from git objects)
//   against this checkout's built files; results are labelled as differential evidence only.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    checkout: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string', default: 'candidate' },
    'expect-head': { type: 'string' },
    rev: { type: 'string' },
    only: { type: 'string' },
    port: { type: 'string', default: '47437' },
    git: { type: 'string', default: 'C:\\Program Files\\Git\\cmd\\git.exe' },
  },
});
if (!opts.checkout || !opts.out) {
  console.error('Required: --checkout <built checkout> --out <qa folder>');
  process.exit(2);
}
const CHECKOUT = resolve(opts.checkout);
const OUT = resolve(opts.out);
const inside = (root, p) =>
  typeof p === 'string' && resolve(p).toLowerCase().startsWith(resolve(root).toLowerCase() + '\\');
if (inside(CHECKOUT, OUT) || resolve(OUT).toLowerCase() === CHECKOUT.toLowerCase()) {
  console.error('--out must be outside the checkout.');
  process.exit(2);
}
const LABEL = opts.label.replace(/[^\w.-]/g, '_');
const PORT = Number(opts.port);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error('--port must be 1024..65535');
  process.exit(2);
}
const ONLY = opts.only ? new Set(opts.only.split(',').map((s) => s.trim())) : null;
const wanted = (id) => !ONLY || ONLY.has(id);

const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'; // the only parent variable read
const SYSTEM32 = join(SYSTEM_ROOT, 'System32');
const POWERSHELL = join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CSC = join(SYSTEM_ROOT, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const NODE = process.execPath;
const GIT = opts.git;
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
// Short run layout: the installer stages beside each output and csc writes CSC<32 hex>.TMP there;
// a staged GraphGoblin.exe path above 235 characters fails compilation (measured, MAX_PATH).
const RUN_ROOT = join(OUT, 'runs', Date.now().toString(36));
const PATH_BUDGET = 245; // longest transient stage file path allowed per fixture (OS limit 259)
let maxTransientPath = 0;
const RESULTS_DIR = join(OUT, 'results');
const BUILT_FILES = [
  'apps/api/dist/main.js',
  'apps/api/dist/instance-identity.js',
  'apps/api/dist/windows-log/guard.js',
  'apps/web/dist/index.html',
];
const INSTALLER_REL = 'scripts/install-windows-launcher.ps1';
const LAUNCHER_REL = 'apps/windows-launcher/Launcher.cs';
const SECRET_REFUSAL =
  'Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.';
const PWA_AUMID = 'Chrome.QaFixture437Correction';
const PS_BASE = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

let INSTALLER = join(CHECKOUT, ...INSTALLER_REL.split('/'));
let LAUNCHER_CS = join(CHECKOUT, ...LAUNCHER_REL.split('/'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ');
const firstLine = (t) => (String(t ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '').trim();
const samePath = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
function fileSha(p) {
  try {
    return sha(readFileSync(p));
  } catch (e) {
    return e.code === 'ENOENT' ? null : `unreadable:${e.code}`;
  }
}
function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ synthetic values
const CANARIES = [];
function canary() {
  const hex = randomBytes(16).toString('hex');
  const v = `qa437-synthetic-${hex}`;
  CANARIES.push({ v, hex });
  return v;
}
function needleStrings(c) {
  const s = new Set([c.v, c.hex]);
  for (let i = 0; i + 12 <= c.hex.length; i += 10) s.add(c.hex.slice(i, i + 12));
  s.add(c.hex.slice(-12));
  return [...s].flatMap((n) => [n, n.toUpperCase()]);
}
function hasCanary(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
  return CANARIES.some((c) =>
    needleStrings(c).some((n) => buf.includes(Buffer.from(n, 'utf8')) || buf.includes(Buffer.from(n, 'utf16le'))),
  );
}
function redact(text) {
  let t = String(text ?? '');
  for (const c of CANARIES) for (const n of needleStrings(c)) t = t.split(n).join('[REDACTED]');
  return t;
}

// ------------------------------------------------------------------ processes
function childEnv(envRoot, inherited = {}) {
  const profile = join(envRoot, 'profile');
  const local = join(profile, 'AppData', 'Local');
  const roaming = join(profile, 'AppData', 'Roaming');
  const tmp = join(envRoot, 'tmp');
  for (const d of [local, roaming, tmp]) mkdirSync(d, { recursive: true });
  return {
    SystemRoot: SYSTEM_ROOT,
    WINDIR: SYSTEM_ROOT,
    SystemDrive: SYSTEM_ROOT.slice(0, 2),
    OS: 'Windows_NT',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    ComSpec: join(SYSTEM32, 'cmd.exe'),
    PATH: [SYSTEM32, SYSTEM_ROOT, join(SYSTEM32, 'Wbem'), join(SYSTEM32, 'WindowsPowerShell', 'v1.0')].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TEMP: tmp,
    TMP: tmp,
    USERPROFILE: profile,
    HOME: profile,
    LOCALAPPDATA: local,
    APPDATA: roaming,
    ...inherited,
  };
}
const CHILD_ENV_NAMES = Object.keys({
  SystemRoot: 0, WINDIR: 0, SystemDrive: 0, OS: 0, PROCESSOR_ARCHITECTURE: 0, ComSpec: 0, PATH: 0,
  PATHEXT: 0, TEMP: 0, TMP: 0, USERPROFILE: 0, HOME: 0, LOCALAPPDATA: 0, APPDATA: 0,
});

function run(file, args, { env, cwd, input = '', timeoutMs = 60_000 }) {
  return new Promise((done) => {
    const started = Date.now();
    const out = [];
    const err = [];
    let timedOut = false;
    let spawnError = null;
    let settled = false;
    let child;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuf = Buffer.concat(out);
      done({
        code,
        timedOut,
        spawnError,
        durationMs: Date.now() - started,
        stdoutBuf,
        stdout: stdoutBuf.toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child?.kill();
    }, timeoutMs);
    try {
      child = spawn(file, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      spawnError = e.code ?? 'spawn-throw';
      return finish(null);
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      spawnError = e.code ?? 'spawn-error';
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function decodeClixml(text, stream = 'Error') {
  if (!String(text).includes('#< CLIXML')) return stream === 'Error' ? String(text) : '';
  return [...String(text).matchAll(new RegExp(`<S S="${stream}">([\\s\\S]*?)</S>`, 'g'))]
    .map((m) => m[1])
    .join('')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const encoded = (script) => ['-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const psq = (s) => `'${String(s).replaceAll("'", "''")}'`;

function gitEnv() {
  return { SystemRoot: SYSTEM_ROOT, PATH: [dirname(GIT), SYSTEM32].join(';'), HOME: join(RUN_ROOT, 'tools', 'env', 'profile') };
}
const git = (args) =>
  run(GIT, ['--no-optional-locks', '-C', CHECKOUT, ...args], { env: gitEnv(), cwd: CHECKOUT, timeoutMs: 60_000 });

// Non-launching native verbs only.
function runNative(exe, args, envRoot) {
  const safe =
    ['--validate-install', '--stage-shortcut', '--expected-app-id', '--read-shortcut-id', '--inspect-shortcut'].includes(args[0]) ||
    (args.includes('--config') && (args.includes('--create-shortcut') || args.includes('--stamp-shortcut')));
  if (!safe) throw new Error('Refusing a launching native verb.');
  return run(exe, args, { env: childEnv(envRoot), cwd: dirname(exe), timeoutMs: 30_000 });
}

// Operator-private ACL on a disposable fixture folder (as the shipped acceptance test does), so the
// launcher's best-effort launcher.log, which only admits a private local folder, is exercised.
// The SID is used in argv only and never recorded.
async function privateDirectory(path, envRoot) {
  mkdirSync(path, { recursive: true });
  const who = await run(join(SYSTEM32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { env: childEnv(envRoot), cwd: path });
  const sid = /"(S-1-[0-9-]+)"/.exec(who.stdout)?.[1];
  if (!sid) return false;
  const r = await run(
    join(SYSTEM32, 'icacls.exe'),
    [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
    { env: childEnv(envRoot), cwd: path },
  );
  return r.code === 0;
}

// ------------------------------------------------------------------ files
function walk(root, skipTop = []) {
  const files = [];
  const dirs = [];
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (d === root && skipTop.includes(e.name)) continue;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        dirs.push(p);
        stack.push(p);
      } else files.push(p);
    }
  }
  return { files, dirs };
}
const SNAP_SKIP = ['env', 'manual', 'manual-out'];
function snapshot(root) {
  const map = {};
  const { files, dirs } = walk(root, SNAP_SKIP);
  for (const d of dirs) map[relative(root, d).replaceAll('\\', '/') + '/'] = 'dir';
  for (const f of files) {
    const s = statSync(f, { bigint: true });
    map[relative(root, f).replaceAll('\\', '/')] = `${fileSha(f)}:${s.size}:${s.ino}:${s.mtimeNs}`;
  }
  return map;
}
function snapshotDiff(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (a[k] !== b[k]) out.push(`${k}: ${a[k] === undefined ? 'created' : b[k] === undefined ? 'removed' : 'changed'}`);
  return out.sort();
}
function scanTree(root) {
  const hits = [];
  if (!CANARIES.length) return hits;
  for (const f of walk(root).files) {
    try {
      if (hasCanary(readFileSync(f))) hits.push(relative(RUN_ROOT, f).replaceAll('\\', '/'));
    } catch (e) {
      hits.push(`${relative(RUN_ROOT, f).replaceAll('\\', '/')} (unreadable ${e.code})`);
    }
  }
  return hits;
}
function stageLeftovers(root) {
  const { files, dirs } = walk(root);
  return [
    ...dirs.filter((d) => /^gg-launcher-stage-/i.test(basename(d))),
    ...files.filter((f) => /\.(previous|replacement)$/i.test(f)),
  ].map((p) => relative(RUN_ROOT, p).replaceAll('\\', '/'));
}

// Staged-artifact detector: file-system events for gg-launcher-stage-* under the case root.
function watchStages(root) {
  const st = { events: 0, names: new Set(), configEvents: 0, configReads: 0, configNonEmpty: 0, hits: 0, readErrors: 0, error: null };
  let w;
  try {
    w = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      const n = String(name);
      if (!/gg-launcher-stage-/i.test(n)) return;
      st.events++;
      const generic = n.replace(/gg-launcher-stage-[0-9a-f]{32}/gi, 'gg-launcher-stage-*').replaceAll('\\', '/');
      st.names.add(generic.slice(0, generic.indexOf('gg-launcher-stage-*') + 'gg-launcher-stage-*'.length));
      if (/GraphGoblin\.exe\.json$/i.test(n)) st.configEvents++;
      if (/GraphGoblin\.exe\.json$/i.test(n) && CANARIES.length) {
        try {
          const b = readFileSync(join(root, n));
          st.configReads++;
          if (b.length) st.configNonEmpty++;
          if (hasCanary(b)) st.hits++;
        } catch {
          st.readErrors++;
        }
      }
    });
    w.on('error', (e) => (st.error = e.code ?? String(e)));
  } catch (e) {
    st.error = e.code ?? 'watch-failed';
  }
  return { st, close: () => w?.close() };
}

// ------------------------------------------------------------------ results
const results = {
  schema: 'graphgoblin-qa-437-correction/v1',
  issue: 437,
  label: LABEL,
  mode: opts.rev ? 'historical-differential' : 'checkout',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  driver: { path: process.argv[1], sha256: fileSha(process.argv[1]) },
  runtime: { node: process.version, powershell: null },
  checkout: { path: CHECKOUT, expectHead: opts['expect-head'] ?? null },
  policy: {
    parentEnvironmentRead: ['SystemRoot'],
    childEnvironmentNames: CHILD_ENV_NAMES,
    syntheticValueTransport: 'stdin JSON to PowerShell only; never argv, never persisted',
    networkContacted: false,
    nativeVerbs: ['--validate-install', '--stage-shortcut', '--create-shortcut', '--stamp-shortcut', '--inspect-shortcut', '--read-shortcut-id', '--expected-app-id'],
    port: PORT,
  },
  fixedTexts: { SECRET_REFUSAL },
  catalog: {},
  cases: [],
  totals: null,
  selfCheck: null,
  cleanup: null,
  limitations: [
    'No gateway is started and no Chrome window is opened; the persisted configuration and native validation are exercised, not a launch.',
    'Each disposable repo contains only the built files the installer and native validator read, copied byte-identically from the checkout.',
    'Stage detection uses recursive file-system events under each case folder; it is positively controlled by ordinary installs in the same run.',
    'Plaintext scanning covers stdout/stderr and every file under the disposable run folder (UTF-8/UTF-16LE, full value, hex and 12-hex fragments, both cases); Windows event logs and other OS stores are not inspected.',
    'Fixture paths are kept short (longest transient stage path asserted <= 245) because the installer fails compilation when a staged path exceeds MAX_PATH; that pre-existing limitation is outside #437 and is characterized separately.',
  ],
};
// The fixed refusal text is stored once in results.fixedTexts and abbreviated in records.
function abbrev(t) {
  const s = String(t ?? '');
  if (s.startsWith(SECRET_REFUSAL)) return '[SECRET_REFUSAL]' + s.slice(SECRET_REFUSAL.length);
  if (s.length >= 40 && SECRET_REFUSAL.startsWith(s)) return '[SECRET_REFUSAL, first wrapped line]';
  return s;
}
function newCase(id, kind, title) {
  const c = { id, kind, title, executions: [], assertions: [], observations: {} };
  results.cases.push(c);
  console.log(`[${id}] ${title}`);
  return c;
}
function check(c, id, description, ok, detail) {
  if (!(id in results.catalog)) results.catalog[id] = description;
  const outcome = ok === null ? 'inconclusive' : ok ? 'pass' : 'fail';
  if (detail && typeof detail === 'object' && !Array.isArray(detail))
    for (const k of ['message', 'stderr']) if (typeof detail[k] === 'string') detail[k] = abbrev(detail[k]);
  c.assertions.push({ id, outcome, ...(detail === undefined ? {} : { detail }) });
  if (outcome !== 'pass') console.log(`   ${outcome.toUpperCase()} ${id}`);
}
function recordExec(c, step, r) {
  c.executions.push({
    step,
    exit: r.code,
    timedOut: r.timedOut,
    spawnError: r.spawnError,
    ms: r.durationMs,
    message: abbrev(redact(r.message ?? firstLine(r.stderr)).slice(0, 260)),
    ...(r.stdout.trim() ? { stdoutFirstLine: redact(firstLine(r.stdout)).slice(0, 120) } : {}),
    outputContainsSynthetic: hasCanary(`${r.stdout}\n${r.stderr}\n${r.errText ?? ''}`),
    ...(r.envShape ? { environmentShape: r.envShape } : {}),
    ...(r.inheritedNames ? { inheritedNames: r.inheritedNames } : {}),
    ...(r.stage
      ? {
          stage: {
            events: r.stage.events,
            folders: [...r.stage.names].sort().slice(0, 6),
            configEvents: r.stage.configEvents,
            configReads: r.stage.configReads,
            configNonEmptyReads: r.stage.configNonEmpty,
            syntheticHits: r.stage.hits,
            readErrors: r.stage.readErrors,
            watchError: r.stage.error,
          },
        }
      : {}),
  });
}

// ------------------------------------------------------------------ fixtures
let TOOLS;
async function prepareTools() {
  const tools = join(RUN_ROOT, 'tools');
  const envRoot = join(tools, 'env');
  mkdirSync(tools, { recursive: true });
  childEnv(envRoot);
  if (opts.rev) {
    const revDir = join(RUN_ROOT, 'rev');
    mkdirSync(revDir, { recursive: true });
    const full = await git(['rev-parse', '--verify', `${opts.rev}^{commit}`]);
    if (full.code !== 0) throw new Error('Unknown --rev.');
    results.checkout.replayedRevision = full.stdout.trim();
    for (const [rel, assign] of [
      [INSTALLER_REL, (p) => (INSTALLER = p)],
      [LAUNCHER_REL, (p) => (LAUNCHER_CS = p)],
    ]) {
      const r = await git(['show', `${results.checkout.replayedRevision}:${rel}`]);
      if (r.code !== 0) throw new Error(`git show failed for ${rel}`);
      const p = join(revDir, basename(rel));
      writeFileSync(p, r.stdoutBuf);
      assign(p);
    }
  }
  results.checkout.installerSha256 = fileSha(INSTALLER);
  results.checkout.launcherSourceSha256 = fileSha(LAUNCHER_CS);
  const fixtureExe = join(tools, 'fixture-launcher.exe');
  const compile = await run(
    CSC,
    ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${fixtureExe}`, LAUNCHER_CS],
    { env: childEnv(envRoot), cwd: tools, timeoutMs: 90_000 },
  );
  if (compile.code !== 0 || !existsSync(fixtureExe)) throw new Error('Fixture launcher compilation failed.');
  const proxy = join(tools, 'chrome', 'chrome_proxy.exe');
  mkdirSync(dirname(proxy), { recursive: true });
  writeFileSync(proxy, 'Inert synthetic shortcut target for QA #437. Not Chrome; never executed.\n');
  const appId = (await runNative(fixtureExe, ['--expected-app-id', String(PORT)], envRoot)).stdout.trim();
  if (!/^[a-p]{32}$/.test(appId)) throw new Error('Expected app ID unavailable.');
  const template = join(tools, 'pwa-template', 'GraphGoblin PWA source.lnk');
  mkdirSync(dirname(template), { recursive: true });
  const setup = await run(
    POWERSHELL,
    [
      ...PS_BASE,
      ...encoded(`$ErrorActionPreference = 'Stop'
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($r.source)
$link.TargetPath = $r.proxy
$link.Arguments = $r.arguments
$link.Save()
$PSVersionTable.PSVersion.ToString()`),
    ],
    {
      env: childEnv(envRoot),
      cwd: tools,
      input: JSON.stringify({ source: template, proxy, arguments: `--profile-directory="Default" --app-id=${appId}` }),
      timeoutMs: 60_000,
    },
  );
  if (setup.code !== 0) throw new Error('Synthetic PWA shortcut creation failed.');
  results.runtime.powershell = setup.stdout.trim();
  const stampRepo = join(tools, 'repo');
  copyBuilt(stampRepo);
  const stampConfig = join(tools, 'stamp-config.json');
  writeFileSync(
    stampConfig,
    JSON.stringify({ Repo: stampRepo, Node: NODE, DataDir: join(tools, 'stamp-store'), Port: PORT, Environment: {}, StartupTimeoutSeconds: 30, WindowTimeoutSeconds: 5, LauncherAppUserModelId: PWA_AUMID }),
  );
  const stamp = await runNative(fixtureExe, ['--config', stampConfig, '--ensure-gateway', '--stamp-shortcut', template], envRoot);
  const id = (await runNative(fixtureExe, ['--read-shortcut-id', template], envRoot)).stdout.trim();
  if (stamp.code !== 0 || id !== PWA_AUMID) throw new Error('Synthetic PWA AppUserModelID stamp failed.');
  TOOLS = { template, templateSha: fileSha(template), proxy, appId };
}
function copyBuilt(repo) {
  for (const f of BUILT_FILES) {
    const to = join(repo, ...f.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(CHECKOUT, ...f.split('/')), to);
  }
  const to = join(repo, ...LAUNCHER_REL.split('/'));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(LAUNCHER_CS, to);
}
function newFixture(id) {
  const root = join(RUN_ROOT, 'c', id);
  const fx = {
    id,
    root,
    repo: join(root, 'repo'),
    store: join(root, 'store'),
    pwa: join(root, 'pwa', 'GraphGoblin PWA source.lnk'),
    install: join(root, 'install dir'),
    desktop: join(root, 'shortcuts', 'Desktop', 'GraphGoblin.lnk'),
    programs: join(root, 'shortcuts', 'Programs', 'GraphGoblin.lnk'),
    envRoot: join(root, 'env'),
  };
  fx.exe = join(fx.install, 'GraphGoblin.exe');
  fx.config = `${fx.exe}.json`;
  // Longest transient names seen in stages: CSC<32 hex>.TMP (39) and GraphGoblin.lnk~RF<hex>.TMP (~29).
  const stage = 1 + 'gg-launcher-stage-'.length + 32 + 1;
  const transient = Math.max(fx.install.length + stage + 39, dirname(fx.programs).length + stage + 29, dirname(fx.desktop).length + stage + 29);
  maxTransientPath = Math.max(maxTransientPath, transient);
  if (transient > PATH_BUDGET) throw new Error(`Fixture path budget exceeded (${transient} > ${PATH_BUDGET}); use a shorter --out.`);
  copyBuilt(fx.repo);
  mkdirSync(fx.store, { recursive: true });
  mkdirSync(dirname(fx.pwa), { recursive: true });
  copyFileSync(TOOLS.template, fx.pwa);
  mkdirSync(dirname(fx.desktop), { recursive: true });
  mkdirSync(dirname(fx.programs), { recursive: true });
  childEnv(fx.envRoot);
  return fx;
}

const lit = (v) => ({ lit: v });
const secret = (i) => ({ secret: i });
// spec: { env: [[key, lit|secret]] | null, secrets: [], inherited: {}, shortcuts, override: {}, route }
async function runInstaller(fx, spec) {
  const p = { RepoPath: fx.repo, NodePath: NODE, DataDir: fx.store, Port: PORT, PwaShortcut: fx.pwa, InstallDir: fx.install, ...(spec.override ?? {}) };
  if (spec.shortcuts) {
    p.DesktopShortcut = fx.desktop;
    p.StartMenuShortcut = fx.programs;
  }
  for (const k of ['RepoPath', 'DataDir', 'PwaShortcut', 'InstallDir', ...(spec.shortcuts ? ['DesktopShortcut', 'StartMenuShortcut'] : [])])
    if (!inside(RUN_ROOT, p[k])) throw new Error(`Unsafe installer argument ${k}.`);
  if (p.NodePath !== NODE && !inside(RUN_ROOT, p.NodePath)) throw new Error('Unsafe NodePath.');
  let args;
  let input = '';
  if (spec.route === 'file') {
    if (spec.env || spec.secrets?.length) throw new Error('-File route carries no -Environment.');
    args = [...PS_BASE, '-File', INSTALLER, ...Object.entries(p).flatMap(([k, v]) => [`-${k}`, String(v)]), ...(spec.shortcuts ? [] : ['-NoShortcuts'])];
  } else {
    const params = Object.entries(p).map(([k, v]) => `-${k} ${typeof v === 'number' ? v : psq(v)}`);
    if (spec.env)
      params.push(
        `-Environment @{ ${spec.env.map(([k, v]) => `${psq(k)} = ${'secret' in v ? `[string]$s[${v.secret}]` : psq(v.lit)}`).join('; ')} }`,
      );
    if (!spec.shortcuts) params.push('-NoShortcuts');
    args = [
      ...PS_BASE,
      ...encoded(`$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$s = $request.s
& ${psq(INSTALLER)} ${params.join(' ')}`),
    ];
    input = JSON.stringify({ s: spec.secrets ?? [] });
  }
  const w = watchStages(fx.root);
  const r = await run(POWERSHELL, args, { env: childEnv(fx.envRoot, spec.inherited ?? {}), cwd: fx.root, input, timeoutMs: 240_000 });
  await sleep(700);
  w.close();
  r.errText = decodeClixml(r.stderr);
  r.message = firstLine(r.errText);
  r.stage = w.st;
  r.envShape = spec.env
    ? spec.env.map(([k, v]) => `${k}=${'secret' in v ? '<synthetic>' : v.lit === '' ? '<empty>' : `'${v.lit}'`}`)
    : null;
  r.inheritedNames = spec.inherited ? Object.keys(spec.inherited) : null;
  return r;
}

async function validatePublished(fx, config = fx.config) {
  if (!existsSync(fx.exe)) return { ok: false, detail: { reason: 'launcher not published' } };
  const r = await runNative(fx.exe, ['--validate-install', '--config', config], fx.envRoot);
  return { ok: r.code === 0 && r.stdout === '' && r.stderr === '', detail: { exit: r.code, stderr: redact(firstLine(r.stderr)) } };
}
async function shortcutOk(fx, lnk, config) {
  if (!existsSync(lnk)) return { ok: false, detail: { reason: 'missing' } };
  let data = null;
  try {
    data = JSON.parse((await runNative(fx.exe, ['--inspect-shortcut', lnk], fx.envRoot)).stdout);
  } catch {}
  const id = (await runNative(fx.exe, ['--read-shortcut-id', lnk], fx.envRoot)).stdout.trim();
  const target = !!data && samePath(data.TargetPath, fx.exe);
  const argsOk = !!data && String(data.Arguments).replaceAll('"', '').toLowerCase() === `--config ${fx.config}`.toLowerCase();
  const aumid = !!config && id === config.LauncherAppUserModelId;
  return { ok: target && argsOk && aumid, detail: { target, arguments: argsOk, appUserModelId: aumid } };
}

// Ordinary setup; returns true when a valid published install exists.
async function ordinarySetup(c, fx, { shortcuts, env = [['GG_LOG_LEVEL', lit('info')]] }) {
  const r = await runInstaller(fx, { env, shortcuts });
  recordExec(c, 'setup: ordinary install', r);
  const cfg = readJson(fx.config);
  const expected = Object.fromEntries(env.map(([k, v]) => [k, v.lit]));
  const installed = r.code === 0 && /Launcher configured\./.test(r.stdout);
  check(c, 'setup.installed', 'Ordinary install exits 0 and prints "Launcher configured."', installed, { exit: r.code, message: redact(r.message).slice(0, 200) });
  check(c, 'setup.environment-exact', 'Published Environment equals the explicit ordinary overrides exactly', !!cfg && isDeepStrictEqual(cfg.Environment, expected), { keys: cfg ? Object.keys(cfg.Environment ?? {}) : null });
  check(c, 'setup.stage-observed', 'Stage detector observed gg-launcher-stage-* activity during the ordinary install (detector positive control)', r.stage.error ? null : r.stage.events > 0, { events: r.stage.events, watchError: r.stage.error });
  const v = await validatePublished(fx);
  check(c, 'setup.native-validates', 'Published launcher accepts its published configuration (--validate-install exit 0, no output)', v.ok, v.detail);
  if (shortcuts)
    for (const [n, lnk] of [['desktop', fx.desktop], ['start-menu', fx.programs]]) {
      const s = await shortcutOk(fx, lnk, cfg);
      check(c, `setup.${n}-shortcut`, `Explicit ${n} shortcut targets the launcher with --config <exe>.json and the launcher AppUserModelID`, s.ok, s.detail);
    }
  return installed && v.ok;
}

function outputAssertions(c, prefix, r) {
  check(c, `${prefix}.no-output-synthetic`, 'No synthetic value or fragment appears in stdout or stderr (raw and decoded)', !hasCanary(`${r.stdout}\n${r.stderr}\n${r.errText}`));
}

// A secret-bearing attempt that must be refused before staging and dependency validation.
async function refusalAttempt(c, fx, spec, { existing }) {
  const before = snapshot(fx.root);
  const storeBefore = readdirSync(fx.store).sort();
  const r = await runInstaller(fx, spec);
  recordExec(c, 'secret-bearing attempt', r);
  const after = snapshot(fx.root);
  check(c, 'refused.exit-nonzero', 'Installer exits non-zero without timing out', r.code !== 0 && r.code !== null && !r.timedOut, { exit: r.code });
  check(c, 'refused.secret-message', 'Error output contains the fixed secret-override refusal text', norm(r.errText).includes(SECRET_REFUSAL), { message: redact(r.message).slice(0, 200) });
  check(c, 'refused.no-success-output', 'stdout does not report "Launcher configured."', !/Launcher configured/.test(r.stdout));
  outputAssertions(c, 'refused', r);
  check(c, 'refused.no-stage-observed', 'No gg-launcher-stage-* activity was observed during the refused attempt', r.stage.error ? null : r.stage.events === 0, { events: r.stage.events, names: [...r.stage.names].slice(0, 6) });
  const left = stageLeftovers(fx.root);
  check(c, 'refused.no-stage-leftovers', 'No gg-launcher-stage-* folders or .previous/.replacement files remain', left.length === 0, left.length ? left : undefined);
  const diff = snapshotDiff(before, after);
  if (existing) {
    check(c, 'refused.prior-files-preserved', 'All prior case files (launcher, config, shortcuts, PWA source, repo, store) keep bytes, size, file ID and mtime; nothing created or removed', diff.length === 0, diff.length ? diff.slice(0, 10) : undefined);
  } else {
    check(c, 'refused.nothing-created', 'The case tree is unchanged: nothing created, removed or modified', diff.length === 0, diff.length ? diff.slice(0, 10) : undefined);
    check(c, 'refused.nothing-published', 'No launcher, configuration or shortcut exists at the requested outputs', ![fx.exe, fx.config, fx.desktop, fx.programs].some(existsSync));
  }
  check(c, 'refused.data-dir-unchanged', 'DataDir listing is unchanged', isDeepStrictEqual(storeBefore, readdirSync(fx.store).sort()));
  const hits = scanTree(fx.root);
  check(c, 'refused.no-file-synthetic', 'No synthetic value or fragment in any file under the case folder (including fixture TEMP/profile)', hits.length === 0, hits.length ? hits.slice(0, 10) : undefined);
  if (existing) {
    const v = await validatePublished(fx);
    check(c, 'refused.prior-setup-still-valid', 'After the refusal the prior published configuration still validates natively', v.ok, v.detail);
  }
  return r;
}

// ------------------------------------------------------------------ cases
async function mechanismAndInspection() {
  if (wanted('M01')) {
    const c = newCase('M01', 'mechanism', 'Windows PowerShell 5.1 hashtable member shadowing that the correction addresses (inert values, no product code)');
    const r = await run(
      POWERSHELL,
      [
        ...PS_BASE,
        ...encoded(`$h = @{ Keys = 'ordinary companion'; GG_LOG_LEVEL = 'info' }
$p = @{ Keys = 'ordinary companion'; psbase = 'ordinary companion'; GG_LOG_LEVEL = 'info' }
[pscustomobject]@{
  dot = (@($h.Keys) -join ',')
  base = (@($h.psbase.Keys | Sort-Object) -join ',')
  baseWithPsbaseEntry = (@($p.psbase.Keys | Sort-Object) -join ',')
} | ConvertTo-Json -Compress`),
      ],
      { env: childEnv(join(RUN_ROOT, 'tools', 'env')), cwd: join(RUN_ROOT, 'tools'), timeoutMs: 60_000 },
    );
    let o = null;
    try {
      o = JSON.parse(r.stdout.trim());
    } catch {}
    c.observations.probe = o;
    check(c, 'mechanism.keys-shadowed', 'A companion Keys entry shadows $hashtable.Keys (so a Keys companion is a meaningful input)', o?.dot === 'ordinary companion', o);
    check(c, 'mechanism.psbase-keys-real', '$hashtable.psbase.Keys returns the real key collection, also with a psbase entry present', o?.base === 'GG_LOG_LEVEL,Keys' && o?.baseWithPsbaseEntry === 'GG_LOG_LEVEL,Keys,psbase', o);
  }
  if (wanted('A01')) {
    const c = newCase('A01', 'code-inspection', 'Installer source: parameter surface and order of the secret-key check');
    const text = readFileSync(INSTALLER, 'utf8');
    const r = await run(
      POWERSHELL,
      [
        ...PS_BASE,
        ...encoded(`$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$t = $null; $e = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($r.path, [ref]$t, [ref]$e)
[pscustomobject]@{ errors = @($e).Count; parameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) } | ConvertTo-Json -Compress`),
      ],
      { env: childEnv(join(RUN_ROOT, 'tools', 'env')), cwd: join(RUN_ROOT, 'tools'), input: JSON.stringify({ path: INSTALLER }), timeoutMs: 60_000 },
    );
    let ast = null;
    try {
      ast = JSON.parse(r.stdout.trim());
    } catch {}
    c.observations.parameters = ast?.parameters ?? null;
    check(c, 'inspect.parses', 'Installer parses without errors', ast?.errors === 0, { errors: ast?.errors });
    check(c, 'inspect.no-acknowledgement-parameter', 'No acknowledgement/bypass parameter exists (ADR-0085: refusal, no acknowledgement switch)', !!ast && !ast.parameters.some((n) => /ack|allow|force|insecure|secret|plain|unsafe|bypass/i.test(n)), ast?.parameters);
    const at = (s) => text.indexOf(s);
    const checkAt = at('GG_MASTER_KEY');
    const order = {
      secretCheck: checkAt,
      getInstallerNode: at('$NodePath = Get-InstallerNode'),
      resolveRepo: at('$RepoPath = (Resolve-Path'),
      initializePaths: text.search(/^[ \t]+Initialize-InstallerPaths[ \t]*$/m),
      firstStage: at('New-InstallerStage $destinations'),
      serialize: at('ConvertTo-Json -Depth'),
    };
    check(c, 'inspect.check-precedes-dependencies', 'In source order the secret-key check precedes Node/repo validation, path initialization, staging and serialization', checkAt > 0 && Object.entries(order).every(([k, v]) => k === 'secretCheck' || v > checkAt), order);
    check(c, 'inspect.uses-psbase-keys', 'The secret-key loop enumerates $Environment.psbase.Keys rather than $Environment.Keys', /foreach\s*\(\s*\$key\s+in\s+\$Environment\.psbase\.Keys\s*\)/i.test(text));
  }
}

async function positiveCases() {
  if (wanted('P01')) {
    const c = newCase('P01', 'positive', 'Fresh install with ordinary overrides (GG_REQUIRE_API_KEY, GG_LOG_LEVEL, GG_OLLAMA_ENABLED) and explicit shortcut destinations');
    const fx = newFixture('P01');
    const env = [['GG_REQUIRE_API_KEY', lit('true')], ['GG_LOG_LEVEL', lit('info')], ['GG_OLLAMA_ENABLED', lit('false')]];
    const ok = await ordinarySetup(c, fx, { shortcuts: true, env });
    const cfg = readJson(fx.config);
    check(c, 'positive.paths-persisted', 'Published Repo, Node, DataDir and Port equal the explicit disposable inputs', !!cfg && samePath(cfg.Repo, fx.repo) && samePath(cfg.Node, NODE) && samePath(cfg.DataDir, fx.store) && cfg.Port === PORT);
    check(c, 'positive.pwa-source-unchanged', 'Synthetic PWA source shortcut is byte-identical', fileSha(fx.pwa) === TOOLS.templateSha);
    check(c, 'positive.no-stage-leftovers', 'No stage folders or .previous/.replacement files remain', ok && stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
    check(c, 'positive.data-dir-empty', 'DataDir remains empty', readdirSync(fx.store).length === 0);
  }
  if (wanted('P02')) {
    const c = newCase('P02', 'positive', "Guide's literal -File route, no -Environment, -NoShortcuts");
    const fx = newFixture('P02');
    const r = await runInstaller(fx, { env: null, shortcuts: false, route: 'file' });
    recordExec(c, 'install (-File)', r);
    const cfg = readJson(fx.config);
    check(c, 'positive.installed', 'Installer exits 0 and prints "Launcher configured."', r.code === 0 && /Launcher configured\./.test(r.stdout), { exit: r.code, message: redact(r.message).slice(0, 200) });
    check(c, 'positive.environment-empty', 'Published Environment is empty', !!cfg && isDeepStrictEqual(cfg.Environment, {}));
    const v = await validatePublished(fx);
    check(c, 'positive.native-validates', 'Published launcher accepts its published configuration', v.ok, v.detail);
    const listing = existsSync(fx.install) ? readdirSync(fx.install).sort() : [];
    check(c, 'positive.only-launcher-and-config', '-NoShortcuts publishes exactly GraphGoblin.exe and GraphGoblin.exe.json in InstallDir', isDeepStrictEqual(listing, ['GraphGoblin.exe', 'GraphGoblin.exe.json']), listing);
    check(c, 'positive.stage-observed', 'Stage detector observed staging (detector positive control)', r.stage.error ? null : r.stage.events > 0, { events: r.stage.events });
  }
  if (wanted('P03')) {
    const c = newCase('P03', 'positive', 'Reconfigure an existing install with changed ordinary overrides');
    const fx = newFixture('P03');
    if (await ordinarySetup(c, fx, { shortcuts: true })) {
      const env = [['GG_LOG_LEVEL', lit('debug')], ['GG_REQUIRE_API_KEY', lit('false')], ['GG_MAX_CONCURRENT_RUNS', lit('2')]];
      const r = await runInstaller(fx, { env, shortcuts: true });
      recordExec(c, 'reinstall', r);
      const cfg = readJson(fx.config);
      check(c, 'positive.reinstalled', 'Reinstall exits 0 and prints "Launcher configured."', r.code === 0 && /Launcher configured\./.test(r.stdout), { exit: r.code, message: redact(r.message).slice(0, 200) });
      check(c, 'positive.environment-updated', 'Published Environment equals the new ordinary overrides exactly', !!cfg && isDeepStrictEqual(cfg.Environment, { GG_LOG_LEVEL: 'debug', GG_REQUIRE_API_KEY: 'false', GG_MAX_CONCURRENT_RUNS: '2' }));
      const v = await validatePublished(fx);
      check(c, 'positive.native-validates', 'Published launcher accepts its published configuration', v.ok, v.detail);
      const s = await shortcutOk(fx, fx.desktop, cfg);
      check(c, 'positive.desktop-shortcut', 'Desktop shortcut still targets the launcher with its AppUserModelID', s.ok, s.detail);
      check(c, 'positive.no-stage-leftovers', 'No stage folders or .previous/.replacement files remain', stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
    }
  }
}

async function inheritedCases() {
  const groups = [
    ['I01', 'Inherited uppercase GG_MASTER_KEY and GG_JEV_API_KEY; explicit GG_LOG_LEVEL only; explicit shortcuts', () => ({ GG_MASTER_KEY: canary(), GG_JEV_API_KEY: canary() }), [['GG_LOG_LEVEL', lit('info')]], true],
    ['I02', 'Inherited lower/mixed gg_master_key and Gg_Jev_Api_Key; no -Environment; -NoShortcuts', () => ({ gg_master_key: canary(), Gg_Jev_Api_Key: canary() }), null, false],
  ];
  for (const [id, title, make, env, shortcuts] of groups) {
    if (!wanted(id)) continue;
    const c = newCase(id, 'inherited-control', title);
    const fx = newFixture(id);
    const r = await runInstaller(fx, { env, inherited: make(), shortcuts });
    recordExec(c, 'install with inherited synthetic values', r);
    const cfg = readJson(fx.config);
    check(c, 'inherited.installed', 'Installer exits 0 and prints "Launcher configured."', r.code === 0 && /Launcher configured\./.test(r.stdout), { exit: r.code, message: redact(r.message).slice(0, 200) });
    check(c, 'inherited.environment-explicit-only', 'Published Environment contains only the explicit overrides (inherited GG_* not copied)', !!cfg && isDeepStrictEqual(cfg.Environment, env ? Object.fromEntries(env.map(([k, v]) => [k, v.lit])) : {}), { keys: cfg ? Object.keys(cfg.Environment ?? {}) : null });
    outputAssertions(c, 'inherited', r);
    check(c, 'inherited.staged-config-clean', 'Staged GraphGoblin.exe.json reads during the run contained no synthetic value (inconclusive if never read)', r.stage.hits > 0 ? false : r.stage.configNonEmpty > 0 ? true : null, { reads: r.stage.configReads, nonEmpty: r.stage.configNonEmpty, hits: r.stage.hits });
    const hits = scanTree(fx.root);
    check(c, 'inherited.no-file-synthetic', 'No synthetic value or fragment in any file under the case folder', hits.length === 0, hits.length ? hits : undefined);
    const v = await validatePublished(fx);
    check(c, 'inherited.native-validates', 'Published launcher accepts its published configuration', v.ok, v.detail);
  }
}

const VARIANTS = [
  ['R01', 'GG_MASTER_KEY', true],
  ['R02', 'gg_master_key', false],
  ['R03', 'Gg_Master_Key', true],
  ['R04', 'GG_master_KEY', false],
  ['R05', 'GG_JEV_API_KEY', true],
  ['R06', 'gg_jev_api_key', false],
  ['R07', 'Gg_Jev_Api_Key', true],
  ['R08', 'gG_jEv_ApI_kEy', false],
];
async function refusalCases() {
  for (const [id, key, shortcuts] of VARIANTS) {
    if (!wanted(id)) continue;
    const c = newCase(id, 'refusal-existing-install', `Existing install; explicit ${key} beside an ordinary override; ${shortcuts ? 'explicit shortcuts' : '-NoShortcuts'}`);
    const fx = newFixture(id);
    if (!(await ordinarySetup(c, fx, { shortcuts }))) continue;
    await refusalAttempt(c, fx, { env: [['GG_LOG_LEVEL', lit('debug')], [key, secret(0)]], secrets: [canary()], shortcuts }, { existing: true });
  }
}

async function keysCompanionCases() {
  const groups = [
    ['K01', 'Keys companion + GG_MASTER_KEY + ordinary override; existing install, shortcuts', [['GG_LOG_LEVEL', lit('debug')], ['Keys', lit('ordinary companion')], ['GG_MASTER_KEY', secret(0)]], true],
    ['K02', 'Keys companion + GG_JEV_API_KEY; existing install, -NoShortcuts', [['Keys', lit('ordinary companion')], ['GG_JEV_API_KEY', secret(0)]], false],
    ['K03', 'lowercase keys companion + gg_master_key; existing install, shortcuts', [['keys', lit('ordinary companion')], ['gg_master_key', secret(0)]], true],
    ['K04', "KEYS companion whose value names an ordinary key ('GG_LOG_LEVEL') + Gg_Jev_Api_Key; existing install, shortcuts", [['KEYS', lit('GG_LOG_LEVEL')], ['Gg_Jev_Api_Key', secret(0)]], true],
    ['K05', 'Keys and psbase companions + GG_Master_Key; existing install, shortcuts', [['Keys', lit('ordinary companion')], ['psbase', lit('ordinary companion')], ['GG_Master_Key', secret(0)]], true],
  ];
  for (const [id, title, env, shortcuts] of groups) {
    if (!wanted(id)) continue;
    const c = newCase(id, 'keys-companion', title);
    const fx = newFixture(id);
    if (!(await ordinarySetup(c, fx, { shortcuts }))) continue;
    await refusalAttempt(c, fx, { env, secrets: [canary()], shortcuts }, { existing: true });
  }
  if (wanted('K06')) {
    const c = newCase('K06', 'keys-companion', 'Keys companion + GG_MASTER_KEY with nonexistent RepoPath, NodePath and PwaShortcut (fresh): refusal precedes dependency validation');
    const fx = newFixture('K06');
    const override = { RepoPath: join(fx.root, 'missing-repo'), NodePath: join(fx.root, 'missing-node', 'node.exe'), PwaShortcut: join(fx.root, 'missing.lnk') };
    await refusalAttempt(c, fx, { env: [['Keys', lit('ordinary companion')], ['GG_MASTER_KEY', secret(0)]], secrets: [canary()], shortcuts: true, override }, { existing: false });
  }
  if (wanted('K07')) {
    const c = newCase('K07', 'keys-companion', 'Keys companion + gg_jev_api_key with valid dependencies (fresh, explicit shortcuts): nothing published');
    const fx = newFixture('K07');
    await refusalAttempt(c, fx, { env: [['Keys', lit('ordinary companion')], ['GG_LOG_LEVEL', lit('debug')], ['gg_jev_api_key', secret(0)]], secrets: [canary()], shortcuts: true }, { existing: false });
  }
  if (wanted('KC1')) {
    const c = newCase('KC1', 'control', 'Control: Keys companion + ordinary override only (no secret key); existing install');
    const fx = newFixture('KC1');
    if (await ordinarySetup(c, fx, { shortcuts: true })) {
      const before = snapshot(fx.root);
      const r = await runInstaller(fx, { env: [['Keys', lit('ordinary companion')], ['GG_LOG_LEVEL', lit('debug')]], shortcuts: true });
      recordExec(c, 'Keys companion without secret', r);
      c.observations.message = redact(r.message).slice(0, 220);
      check(c, 'control.not-secret-refusal', 'Not refused by the secret-key check (no false positive from the Keys companion)', !norm(r.errText).includes(SECRET_REFUSAL), { message: redact(r.message).slice(0, 200) });
      check(c, 'control.non-gg-key-refused', 'Still refused overall (non-GG_ key cannot be persisted) with non-zero exit', r.code !== 0 && r.code !== null && !r.timedOut, { exit: r.code });
      check(c, 'control.stage-observed', 'Staging occurred for the same hashtable shape (stage detector positive control)', r.stage.error ? null : r.stage.events > 0, { events: r.stage.events });
      check(c, 'control.no-stage-leftovers', 'Stages cleaned up', stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
      const diff = snapshotDiff(before, snapshot(fx.root));
      check(c, 'control.prior-files-preserved', 'Prior files unchanged', diff.length === 0, diff.length ? diff.slice(0, 10) : undefined);
      const v = await validatePublished(fx);
      check(c, 'control.prior-setup-still-valid', 'Prior configuration still validates natively', v.ok, v.detail);
    }
  }
}

async function emptyAndOrderCases() {
  if (wanted('E01')) {
    const c = newCase('E01', 'empty-value', "Existing install; GG_MASTER_KEY = '' (empty); shortcuts");
    const fx = newFixture('E01');
    if (await ordinarySetup(c, fx, { shortcuts: true })) await refusalAttempt(c, fx, { env: [['GG_MASTER_KEY', lit('')]], shortcuts: true }, { existing: true });
  }
  if (wanted('E02')) {
    const c = newCase('E02', 'empty-value', "Existing install; gg_jev_api_key = '' beside an ordinary override; -NoShortcuts");
    const fx = newFixture('E02');
    if (await ordinarySetup(c, fx, { shortcuts: false })) await refusalAttempt(c, fx, { env: [['GG_LOG_LEVEL', lit('debug')], ['gg_jev_api_key', lit('')]], shortcuts: false }, { existing: true });
  }
  if (wanted('D01')) {
    const c = newCase('D01', 'ordering', 'GG_JEV_API_KEY with nonexistent RepoPath, NodePath and PwaShortcut (fresh): secret refusal precedes dependency validation');
    const fx = newFixture('D01');
    const override = { RepoPath: join(fx.root, 'missing-repo'), NodePath: join(fx.root, 'missing-node', 'node.exe'), PwaShortcut: join(fx.root, 'missing.lnk') };
    await refusalAttempt(c, fx, { env: [['GG_LOG_LEVEL', lit('debug')], ['GG_JEV_API_KEY', secret(0)]], secrets: [canary()], shortcuts: true, override }, { existing: false });
  }
  if (wanted('D02')) {
    const c = newCase('D02', 'control', 'Control: the same nonexistent dependencies with an ordinary override only are refused by dependency validation');
    const fx = newFixture('D02');
    const before = snapshot(fx.root);
    const override = { RepoPath: join(fx.root, 'missing-repo'), NodePath: join(fx.root, 'missing-node', 'node.exe'), PwaShortcut: join(fx.root, 'missing.lnk') };
    const r = await runInstaller(fx, { env: [['GG_LOG_LEVEL', lit('debug')]], shortcuts: true, override });
    recordExec(c, 'ordinary override with missing dependencies', r);
    check(c, 'control.dependency-refusal', 'Refused non-zero with the Node selection message, not the secret message', r.code !== 0 && r.code !== null && /Node executable was not found/.test(norm(r.errText)) && !norm(r.errText).includes(SECRET_REFUSAL), { exit: r.code, message: redact(r.message).slice(0, 200) });
    const diff = snapshotDiff(before, snapshot(fx.root));
    check(c, 'control.nothing-created', 'The case tree is unchanged', diff.length === 0, diff.length ? diff : undefined);
  }
  if (wanted('H01')) {
    const c = newCase('H01', 'inherited-and-explicit', 'Existing install; inherited GG_MASTER_KEY/gg_jev_api_key plus explicit Keys companion + GG_JEV_API_KEY');
    const fx = newFixture('H01');
    if (await ordinarySetup(c, fx, { shortcuts: true }))
      await refusalAttempt(
        c,
        fx,
        { env: [['Keys', lit('ordinary companion')], ['GG_JEV_API_KEY', secret(0)]], secrets: [canary()], inherited: { GG_MASTER_KEY: canary(), gg_jev_api_key: canary() }, shortcuts: true },
        { existing: true },
      );
  }
}

async function nativeCases() {
  if (!wanted('N01')) return;
  const c = newCase('N01', 'native-configuration', 'Published native launcher on manually edited JSON: secret keys (case variants, empty) refused by every configuration entry point; ordinary JSON accepted');
  const fx = newFixture('N01');
  if (!(await ordinarySetup(c, fx, { shortcuts: true }))) return;
  const published = readJson(fx.config);
  const manual = join(fx.root, 'manual');
  const outDir = join(fx.root, 'manual-out');
  c.observations.manualFolderPrivate = await privateDirectory(manual, fx.envRoot);
  mkdirSync(outDir, { recursive: true });
  const stampTarget = join(outDir, 'stamp-target.lnk');
  copyFileSync(fx.desktop, stampTarget);
  const installBefore = snapshot(fx.root);
  const verbs = (config, tag) => [
    ['validate-install', ['--validate-install', '--config', config], null],
    ['stage-shortcut', ['--stage-shortcut', join(outDir, `${tag}-stage.lnk`), config, fx.exe], join(outDir, `${tag}-stage.lnk`)],
    ['create-shortcut', ['--config', config, '--create-shortcut', join(outDir, `${tag}-create.lnk`)], join(outDir, `${tag}-create.lnk`)],
    ['stamp-gateway-only', ['--config', config, '--ensure-gateway', '--stamp-shortcut', stampTarget], null],
  ];
  // Positive control: ordinary manual JSON.
  const ordinary = join(manual, 'ordinary.json');
  writeFileSync(ordinary, JSON.stringify({ ...published, Environment: { GG_REQUIRE_API_KEY: 'true', GG_LOG_LEVEL: 'info' } }));
  for (const [verb, args, created] of verbs(ordinary, 'ordinary')) {
    const r = await runNative(fx.exe, args, fx.envRoot);
    recordExec(c, `ordinary ${verb}`, { ...r, message: firstLine(r.stderr) });
    check(c, `native.ordinary.${verb}`, `Ordinary manual JSON accepted by ${verb} (exit 0, no stderr${created ? ', shortcut created' : ''})`, r.code === 0 && r.stderr === '' && (!created || existsSync(created)), { exit: r.code, stderr: redact(firstLine(r.stderr)).slice(0, 160) });
  }
  const stampSha = fileSha(stampTarget);
  const variants = [
    ['GG_MASTER_KEY', true],
    ['GG_JEV_API_KEY', true],
    ['Gg_Master_Key', true],
    ['gg_jev_api_key', true],
    ['gg_master_key', true],
    ['Gg_Jev_Api_Key', true],
    ['GG_JEV_API_KEY', false],
  ];
  for (let i = 0; i < variants.length; i++) {
    const [key, withValue] = variants[i];
    const tag = `v${i + 1}`;
    const value = withValue ? canary() : '';
    const file = join(manual, `${tag}.json`);
    // The synthetic value exists on disk here only inside the disposable manual folder; it is scanned
    // out of every result and removed with the run folder.
    writeFileSync(file, JSON.stringify({ ...published, Environment: { GG_LOG_LEVEL: 'info', [key]: value } }));
    const fileBefore = fileSha(file);
    const label = `${key}${withValue ? '' : '(empty)'}`;
    const per = { key: label, verbs: {} };
    for (const [verb, args, created] of verbs(file, tag)) {
      const r = await runNative(fx.exe, args, fx.envRoot);
      recordExec(c, `${label} ${verb}`, { ...r, message: firstLine(r.stderr) });
      const refused = r.code === 1 && r.stdout === '' && r.stderr.startsWith(SECRET_REFUSAL);
      const noEcho = !hasCanary(`${r.stdout}\n${r.stderr}`);
      const noEffect = (!created || !existsSync(created)) && fileSha(stampTarget) === stampSha;
      per.verbs[verb] = { refused, noEcho, noEffect };
      check(c, `native.refused.${verb}`, `Secret-bearing manual JSON refused by ${verb}: exit 1, empty stdout, stderr begins with the fixed refusal text`, refused, { key: label, exit: r.code, stderr: redact(firstLine(r.stderr)).slice(0, 160) });
      check(c, `native.no-echo.${verb}`, `${verb} output contains no synthetic value or fragment`, noEcho, { key: label });
      check(c, `native.no-effect.${verb}`, `${verb} created or changed no shortcut`, noEffect, { key: label });
    }
    check(c, 'native.manual-json-unchanged', 'The manually edited JSON is not rewritten', fileSha(file) === fileBefore, { key: label });
  }
  const diff = snapshotDiff(installBefore, snapshot(fx.root));
  check(c, 'native.install-unchanged', 'Published launcher, config, shortcuts, repo and store unchanged by native refusals', diff.length === 0, diff.length ? diff.slice(0, 10) : undefined);
  check(c, 'native.store-empty', 'DataDir remains empty (no gateway or key material created)', readdirSync(fx.store).length === 0);
  const logPath = join(manual, 'launcher.log');
  const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : null;
  const refusalRecords = logText ? logText.split('\n').filter((l) => l.includes('"code":"configuration-refused"')) : [];
  c.observations.launcherLogRefusalRecords = refusalRecords.length;
  // create-shortcut and stamp-gateway-only take the logging path: 2 verbs x 7 variants.
  check(c, 'native.log-written', 'launcher.log beside the manual JSON records the refusals (inconclusive when no log exists, because the no-disclosure check would then be vacuous)', logText === null ? null : refusalRecords.length >= 2 * variants.length, { records: refusalRecords.length, private: c.observations.manualFolderPrivate });
  check(c, 'native.log-fixed-message', 'Every logged refusal carries the fixed refusal text', logText === null ? null : refusalRecords.length > 0 && refusalRecords.every((l) => { try { return JSON.parse(l).message === SECRET_REFUSAL; } catch { return false; } }));
  const hits = scanTree(join(fx.root, 'manual')).filter((h) => !/\/manual\/v\d+\.json$/.test(h));
  check(c, 'native.no-log-synthetic', 'No synthetic value in launcher.log or any other file beside the manual JSON (excluding the operator-written JSON itself)', hits.length === 0, hits.length ? hits : undefined);
  const otherHits = [...scanTree(join(fx.root, 'manual-out')), ...scanTree(fx.install), ...scanTree(fx.envRoot)];
  check(c, 'native.no-other-file-synthetic', 'No synthetic value in shortcut outputs, the install folder or fixture TEMP/profile', otherHits.length === 0, otherHits.length ? otherHits : undefined);
}

// ------------------------------------------------------------------ main
async function checkoutState() {
  const head = await git(['rev-parse', 'HEAD']);
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all']);
  const blobs = {};
  for (const rel of [INSTALLER_REL, LAUNCHER_REL]) {
    const headBlob = await git(['rev-parse', `HEAD:${rel}`]);
    const work = await git(['hash-object', '--', rel]);
    blobs[rel] = { head: headBlob.stdout.trim(), worktree: work.stdout.trim() };
  }
  return { head: head.stdout.trim(), status: status.stdout, statusOk: status.code === 0, blobs };
}

async function main() {
  mkdirSync(RUN_ROOT, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  mkdirSync(join(RUN_ROOT, 'tools', 'env', 'profile'), { recursive: true });
  const before = await checkoutState();
  results.checkout.head = before.head;
  console.log(`checkout ${before.head} mode ${results.mode}`);
  await prepareTools();
  const steps = [mechanismAndInspection, positiveCases, inheritedCases, refusalCases, keysCompanionCases, emptyAndOrderCases, nativeCases];
  for (const step of steps) {
    try {
      await step();
    } catch (e) {
      const c = results.cases[results.cases.length - 1] ?? newCase('X', 'driver', 'driver');
      check(c, 'driver.no-exception', 'The driver completed the case group without an exception', null, { error: redact(e?.message ?? String(e)).slice(0, 200) });
    }
  }
  const g = newCase('G01', 'global', 'Run-wide plaintext scan, checkout integrity and fixture cleanup');
  const after = await checkoutState();
  check(g, 'global.head-expected', 'Checkout HEAD equals --expect-head', opts['expect-head'] ? before.head.startsWith(opts['expect-head']) : null, { head: before.head });
  check(g, 'global.checkout-unchanged', 'Checkout HEAD and porcelain status are identical before and after the run', before.statusOk && after.statusOk && before.head === after.head && before.status === after.status, { statusEntriesBefore: before.status.split('\n').filter(Boolean).length });
  if (!opts.rev)
    check(g, 'global.shipped-files-are-head', 'The executed installer and Launcher.cs bytes equal the HEAD blobs', Object.values(before.blobs).every((b) => b.head && b.head === b.worktree), before.blobs);
  else g.observations.replayedFrom = results.checkout.replayedRevision;
  check(g, 'global.fixture-path-budget', `Every fixture keeps its longest transient stage path within ${PATH_BUDGET} characters (installer MAX_PATH limit avoided)`, maxTransientPath > 0 && maxTransientPath <= PATH_BUDGET, { maxTransientPath, budget: PATH_BUDGET });
  const runHits = scanTree(join(RUN_ROOT, 'c')).filter((h) => !/\/manual\/v\d+\.json$/.test(h));
  check(g, 'global.no-file-synthetic', 'No synthetic value in any run file except the operator-written manual JSON inputs', runHits.length === 0, runHits.length ? runHits.slice(0, 20) : undefined);
  const leftovers = stageLeftovers(join(RUN_ROOT, 'c'));
  check(g, 'global.no-stage-leftovers', 'No stage folders or .previous/.replacement files remain anywhere in the run', leftovers.length === 0, leftovers.length ? leftovers : undefined);
  let removed = false;
  for (let i = 0; i < 5 && !removed; i++) {
    try {
      rmSync(RUN_ROOT, { recursive: true, force: true });
      removed = !existsSync(RUN_ROOT);
    } catch {
      await sleep(1000);
    }
  }
  check(g, 'global.fixtures-removed', 'Disposable run folder removed after the run', removed);
  results.cleanup = { runRoot: relative(OUT, RUN_ROOT).replaceAll('\\', '/'), removed };

  const totals = { assertions: 0, pass: 0, fail: 0, inconclusive: 0, cases: results.cases.length, syntheticValues: CANARIES.length };
  for (const c of results.cases)
    for (const a of c.assertions) {
      totals.assertions++;
      totals[a.outcome]++;
    }
  results.totals = totals;
  results.finishedAt = new Date().toISOString();
  const base = join(RESULTS_DIR, `qa437-${LABEL}-${STAMP}`);
  let text = serialize(results);
  results.selfCheck = hasCanary(text) ? 'synthetic value found and redacted' : 'clean';
  text = redact(serialize(results));
  JSON.parse(text);
  writeFileSync(`${base}.json`, text + '\n');
  const md = summary(results);
  writeFileSync(`${base}.summary.md`, redact(md));
  const post = [readFileSync(`${base}.json`), readFileSync(`${base}.summary.md`)].some(hasCanary);
  console.log(`totals ${JSON.stringify(totals)} selfCheck ${results.selfCheck} postWriteClean ${!post}`);
  console.log(`results ${base}.json`);
  process.exitCode = totals.fail || totals.inconclusive || post ? 1 : 0;
}

// One line per case and per catalog entry: compact but still reviewable as text.
function serialize(r) {
  const keys = Object.keys(r);
  const body = keys.map((k) => {
    if (k === 'cases') return ` "cases": [\n${r.cases.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n ]`;
    if (k === 'catalog')
      return ` "catalog": {\n${Object.entries(r.catalog).map(([a, b]) => `  ${JSON.stringify(a)}: ${JSON.stringify(b)}`).join(',\n')}\n }`;
    return ` ${JSON.stringify(k)}: ${JSON.stringify(r[k])}`;
  });
  return `{\n${body.join(',\n')}\n}`;
}

function summary(r) {
  const lines = [
    `# QA #437 driver run: ${r.label} (${r.mode})`,
    '',
    `Checkout HEAD ${r.checkout.head}${r.checkout.replayedRevision ? `; installer and Launcher.cs replayed from ${r.checkout.replayedRevision}` : ''}.`,
    `Node ${r.runtime.node}; Windows PowerShell ${r.runtime.powershell}. Installer sha256 ${r.checkout.installerSha256}.`,
    `Assertions ${r.totals.assertions}: pass ${r.totals.pass}, fail ${r.totals.fail}, inconclusive ${r.totals.inconclusive}. Cases ${r.totals.cases}. Synthetic values ${r.totals.syntheticValues}. Results self-check: ${r.selfCheck}. Fixtures removed: ${r.cleanup.removed}.`,
    '',
    '| Case | Kind | Pass | Fail | Inconcl. | Non-pass assertions |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const c of r.cases) {
    const n = (o) => c.assertions.filter((a) => a.outcome === o).length;
    const bad = [...new Set(c.assertions.filter((a) => a.outcome !== 'pass').map((a) => `${a.id} (${a.outcome})`))];
    lines.push(`| ${c.id} | ${c.kind} | ${n('pass')} | ${n('fail')} | ${n('inconclusive')} | ${bad.join(', ') || '-'} |`);
  }
  lines.push('', 'Limitations:', ...r.limitations.map((l) => `- ${l}`), '');
  return lines.join('\n');
}

main().catch((e) => {
  console.error(`driver failure: ${redact(e?.message ?? String(e))}`);
  try {
    rmSync(RUN_ROOT, { recursive: true, force: true });
  } catch {}
  process.exitCode = 2;
});
