// GraphGoblin #437 independent touched-systems QA driver (reusable: baseline or candidate).
//
// Exercises the shipped Windows PowerShell 5.1 launcher installer
// (scripts/install-windows-launcher.ps1) and the native launcher configuration path
// (apps/windows-launcher/Launcher.cs, compiled by that installer) with disposable fixtures only.
//
// Safety rules enforced here:
// - The parent environment is never enumerated. Only SystemRoot, PATH, USERPROFILE and HOME are
//   read by name (PATH/USERPROFILE/HOME only for the read-only git probe). Every child process
//   receives an explicitly constructed environment.
// - Synthetic values are random per run, travel to PowerShell on stdin only (never argv, never a
//   request file) and are never printed or stored; stored output text is redacted and the results
//   JSON is self-checked before it is written.
// - Every installer run supplies an explicit disposable InstallDir, DataDir, RepoPath, synthetic
//   PwaShortcut, and either explicit Desktop/StartMenu shortcut destinations or -NoShortcuts.
// - No network endpoint is contacted. The port only selects the expected Chrome app ID.
// - The native launcher is only run with non-launching verbs (--validate-install,
//   --create-shortcut, --stamp-shortcut, --inspect-shortcut, --read-shortcut-id,
//   --expected-app-id); it is never asked to open Chrome or start a gateway.
//
// Usage:
//   node qa-437-driver.mjs --checkout <built checkout> --out <qa folder> --label <name>
//        [--expect-head <sha>] [--ack-param <SwitchName>] [--no-ack-detect]
//        [--native-expect observe|refuse|accept] [--only id1,id2] [--keep-fixtures]

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    checkout: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string', default: 'run' },
    'expect-head': { type: 'string' },
    'ack-param': { type: 'string' },
    'no-ack-detect': { type: 'boolean', default: false },
    'native-expect': { type: 'string', default: 'observe' },
    only: { type: 'string' },
    'keep-fixtures': { type: 'boolean', default: false },
    port: { type: 'string', default: '47437' },
  },
});
if (!opts.checkout || !opts.out) {
  console.error('Required: --checkout <built checkout> --out <qa folder>');
  process.exit(2);
}
if (!['observe', 'refuse', 'accept'].includes(opts['native-expect'])) {
  console.error('--native-expect must be observe, refuse or accept');
  process.exit(2);
}

const CHECKOUT = resolve(opts.checkout);
const OUT = resolve(opts.out);
const PORT = Number(opts.port);
const ONLY = opts.only ? new Set(opts.only.split(',').map((s) => s.trim())) : null;
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'; // single named read
const SYSTEM32 = join(SYSTEM_ROOT, 'System32');
const POWERSHELL = join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CSC = join(SYSTEM_ROOT, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const NODE = process.execPath;
const INSTALLER = join(CHECKOUT, 'scripts', 'install-windows-launcher.ps1');
const LAUNCHER_CS = join(CHECKOUT, 'apps', 'windows-launcher', 'Launcher.cs');
const REPO_FILES = [
  'apps/api/dist/main.js',
  'apps/api/dist/instance-identity.js',
  'apps/api/dist/windows-log/guard.js',
  'apps/web/dist/index.html',
  'apps/windows-launcher/Launcher.cs',
];
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
const RUN_ROOT = join(OUT, 'runs', `${opts.label}-${STAMP}`);
const RESULTS_DIR = join(OUT, 'results');
const PWA_AUMID = 'Chrome.QaPwaFixture437';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rel = (p) => relative(RUN_ROOT, p).replaceAll('\\', '/');
const samePath = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();

// ---------------------------------------------------------------- synthetic values
const ALL_SENTINELS = [];
function masterSentinel() {
  for (;;) {
    const v = randomBytes(32).toString('base64'); // GG_MASTER_KEY shape: base64 of 32 bytes
    if (!/[+/]/.test(v)) return register(v);
  }
}
function tokenSentinel() {
  return register(randomBytes(24).toString('hex'));
}
function register(v) {
  ALL_SENTINELS.push(v);
  return v;
}
function needleStrings(value) {
  const set = new Set([value]);
  for (let i = 0; i + 12 <= value.length; i += 12) set.add(value.slice(i, i + 12));
  set.add(value.slice(-12));
  return [...set];
}
function needles(value) {
  return needleStrings(value).flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
}
function containsAny(buffer, sentinels) {
  return sentinels.some((s) => needles(s).some((n) => buffer.indexOf(n) >= 0));
}
function redact(text, sentinels = ALL_SENTINELS) {
  let out = String(text ?? '');
  for (const s of sentinels) for (const n of needleStrings(s)) out = out.split(n).join('[SENTINEL-REDACTED]');
  return out;
}

// ---------------------------------------------------------------- processes
function childEnv(envRoot, extra = {}) {
  const tmp = join(envRoot, 'tmp');
  const profile = join(envRoot, 'profile');
  const local = join(profile, 'AppData', 'Local');
  const roaming = join(profile, 'AppData', 'Roaming');
  for (const d of [tmp, local, roaming]) mkdirSync(d, { recursive: true });
  return {
    SystemRoot: SYSTEM_ROOT,
    WINDIR: SYSTEM_ROOT,
    SystemDrive: SYSTEM_ROOT.slice(0, 2),
    OS: 'Windows_NT',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    ComSpec: join(SYSTEM32, 'cmd.exe'),
    PATH: [dirname(NODE), SYSTEM32, SYSTEM_ROOT, join(SYSTEM32, 'Wbem'), join(SYSTEM32, 'WindowsPowerShell', 'v1.0')].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TEMP: tmp,
    TMP: tmp,
    USERPROFILE: profile,
    LOCALAPPDATA: local,
    APPDATA: roaming,
    ...extra,
  };
}

function run(file, args, { env, cwd, input = '', timeoutMs = 60_000 }) {
  return new Promise((done) => {
    const started = Date.now();
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    const out = [];
    const err = [];
    const child = spawn(file, args, { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({
        code,
        timedOut,
        spawnError,
        durationMs: Date.now() - started,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    };
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      spawnError = e.code || 'spawn-error';
      finish(null);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function decodePsStderr(text, stream = 'Error') {
  if (!text.startsWith('#< CLIXML')) return stream === 'Error' ? text : '';
  return [...text.matchAll(new RegExp(`<S S="${stream}">([\\s\\S]*?)<\\/S>`, 'g'))]
    .map((m) => m[1])
    .join('')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const firstLine = (text) => (String(text).split(/\r?\n/).find((l) => l.trim()) ?? '').trim();

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');
const PS_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-EncodedCommand'];

// The documented route: invoke the shipped script from PowerShell with an -Environment hashtable.
const INSTALL_SCRIPT = encode(`$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$options = @{}
foreach ($property in $request.options.PSObject.Properties) { $options[$property.Name] = $property.Value }
foreach ($name in @($request.switches)) { if ($name) { $options[[string]$name] = [switch]::Present } }
if ($null -ne $request.environment) {
    $settings = @{}
    foreach ($property in $request.environment.PSObject.Properties) { $settings[$property.Name] = [string]$property.Value }
    $options['Environment'] = $settings
}
& $request.installer @options`);

const SETUP_SCRIPT = encode(`$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($request.source)
$shortcut.TargetPath = $request.proxy
$shortcut.Arguments = $request.arguments
$shortcut.Save()
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($request.installer, [ref]$tokens, [ref]$errors)
[pscustomobject]@{
    psVersion = $PSVersionTable.PSVersion.ToString()
    parseErrors = @($errors).Count
    parameters = @($ast.ParamBlock.Parameters | ForEach-Object {
        [pscustomobject]@{ name = $_.Name.VariablePath.UserPath; type = $_.StaticType.FullName }
    })
} | ConvertTo-Json -Compress -Depth 4`);

const SAFE_LAUNCHER_VERBS = ['--validate-install', '--create-shortcut', '--stamp-shortcut', '--inspect-shortcut', '--read-shortcut-id', '--expected-app-id'];
function runLauncher(exe, args, envRoot) {
  if (!args.some((a) => SAFE_LAUNCHER_VERBS.includes(a))) throw new Error('Refusing a launching native verb.');
  if (args.includes('--config') && !args.some((a) => ['--validate-install', '--create-shortcut', '--stamp-shortcut'].includes(a)))
    throw new Error('Refusing a launching native verb.');
  return run(exe, args, { env: childEnv(envRoot), cwd: dirname(exe), timeoutMs: 30_000 });
}

// ---------------------------------------------------------------- files
function digest(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch (e) {
    return e.code === 'ENOENT' ? null : `unreadable:${e.code}`;
  }
}
function walk(root) {
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
      if (e.isDirectory() && !e.isSymbolicLink()) {
        dirs.push(p);
        stack.push(p);
      } else files.push(p);
    }
  }
  return { files, dirs };
}
function scanForSentinels(root, sentinels) {
  const hits = [];
  if (!sentinels.length) return hits;
  for (const f of walk(root).files) {
    let buffer;
    try {
      buffer = readFileSync(f);
    } catch (e) {
      hits.push({ path: rel(f), unreadable: e.code });
      continue;
    }
    if (containsAny(buffer, sentinels)) hits.push({ path: rel(f) });
  }
  return hits;
}
function stageLeftovers(root) {
  const { files, dirs } = walk(root);
  return [
    ...dirs.filter((d) => basename(d).toLowerCase().startsWith('gg-launcher-stage-')),
    ...files.filter((f) => /\.(previous|replacement)$/i.test(f)),
  ].map(rel);
}
function snapshot(fx) {
  const files = Object.fromEntries([fx.exe, fx.config, fx.desktop, fx.programs, fx.pwa].map((f) => [rel(f), digest(f)]));
  const listing = [];
  for (const d of [fx.install, dirname(fx.desktop), dirname(fx.programs), fx.pwaDir, fx.store, fx.repo])
    for (const f of walk(d).files) listing.push(`${rel(f)}#${digest(f)}`);
  return { files, listing: listing.sort(), top: existsSync(fx.root) ? readdirSync(fx.root).sort() : [] };
}
function snapshotDiff(before, after) {
  const changed = [];
  for (const k of new Set([...Object.keys(before.files), ...Object.keys(after.files)]))
    if (before.files[k] !== after.files[k])
      changed.push(`${k}: ${before.files[k] ? 'present' : 'absent'} -> ${after.files[k] ? (before.files[k] ? 'changed' : 'created') : 'absent'}`);
  const b = new Set(before.listing.map((l) => l.split('#')[0]));
  const a = new Set(after.listing.map((l) => l.split('#')[0]));
  for (const f of a) if (!b.has(f)) changed.push(`${f}: created`);
  for (const f of b) if (!a.has(f)) changed.push(`${f}: removed`);
  if (!isDeepStrictEqual(before.top, after.top)) changed.push(`case root entries: ${before.top.join(',')} -> ${after.top.join(',')}`);
  return [...new Set(changed)];
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- staged-artifact watcher
function startStageWatch(root, sentinels) {
  const state = { stageEntries: new Set(), stageConfigEvents: 0, reads: 0, nonEmptyReads: 0, hits: 0, readErrors: 0 };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = filename.toString();
    if (!/(^|[\\/])gg-launcher-stage-[0-9a-f]{32}([\\/]|$)/i.test(name)) return;
    state.stageEntries.add(name.replaceAll('\\', '/').replace(/gg-launcher-stage-[0-9a-f]{32}/i, 'gg-launcher-stage-*'));
    if (!/[\\/]GraphGoblin\.exe\.json$/i.test(name)) return;
    state.stageConfigEvents++;
    if (!sentinels.length) return;
    try {
      const buffer = readFileSync(join(root, name));
      state.reads++;
      if (buffer.length) state.nonEmptyReads++;
      if (containsAny(buffer, sentinels)) state.hits++;
    } catch {
      state.readErrors++;
    }
  });
  return {
    state,
    close: () => watcher.close(),
  };
}

// ---------------------------------------------------------------- results
const results = {
  schema: 'graphgoblin-qa-437/v1',
  issue: 437,
  label: opts.label,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  driver: { path: process.argv[1], sha256: digest(process.argv[1]) },
  options: {
    nativeExpect: opts['native-expect'],
    ackParamCli: opts['ack-param'] ?? null,
    ackDetect: !opts['no-ack-detect'],
    only: ONLY ? [...ONLY] : null,
    keepFixtures: opts['keep-fixtures'],
    port: PORT,
    networkContacted: false,
  },
  runtime: { node: process.version, powershell: null },
  checkout: {},
  inspection: {},
  catalog: { assertions: {}, observations: {} },
  cases: [],
  totals: null,
  cleanup: null,
  limitations: [
    'Only installer configuration persistence and native configuration validation are exercised; no gateway is started and no Chrome window is opened.',
    'Each disposable repo contains only the built files the installer and native validator read (copied byte-identically, digests recorded), not a runnable gateway.',
    'Staged-artifact detection reads gg-launcher-stage-*/GraphGoblin.exe.json on file-system events; a file written and deleted before a read is reported as inconclusive, not pass.',
    'Native refusal of a hand-written secret-bearing config is design-dependent and is an observation unless --native-expect is set.',
  ],
};
function makeCase(id, kind, description, meta = {}) {
  const c = { id, kind, description, ...meta, executions: [], assertions: [], observations: [] };
  results.cases.push(c);
  return c;
}
// Descriptions live once in results.catalog; an assertion carries its own only when it differs.
function describe(section, id, description) {
  const catalog = results.catalog[section];
  if (!(id in catalog)) catalog[id] = description;
  return catalog[id] === description ? {} : { description };
}
function check(c, id, description, ok, detail) {
  c.assertions.push({ id, outcome: ok === null ? 'inconclusive' : ok ? 'pass' : 'fail', ...describe('assertions', id, description), ...(detail === undefined ? {} : { detail }) });
}
function notApplicable(c, id, description, reason) {
  c.assertions.push({ id, outcome: 'not-applicable', ...describe('assertions', id, description), detail: reason });
}
function observe(c, id, description, value) {
  c.observations.push({ id, ...describe('observations', id, description), value });
}
function outputHas(r, sentinels) {
  return containsAny(Buffer.from(`${r.stdout}\n${r.stderr}\n${r.stderrText ?? ''}\n${r.warningText ?? ''}`, 'utf8'), sentinels);
}
function recordExecution(c, step, r, sentinels = []) {
  c.executions.push({
    step,
    exitCode: r.code,
    timedOut: r.timedOut,
    spawnError: r.spawnError,
    durationMs: r.durationMs,
    stdoutLines: redact(r.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6),
    message: redact(r.message ?? firstLine(r.stderrText ?? r.stderr)),
    ...(r.warningText ? { warning: redact(firstLine(r.warningText)) } : {}),
    outputContainsSyntheticValue: sentinels.length ? outputHas(r, sentinels) : null,
    ...(r.stage
      ? {
          staging: {
            entriesSeen: [...r.stage.stageEntries].sort(),
            stagedConfigEvents: r.stage.stageConfigEvents,
            stagedConfigReads: r.stage.reads,
            stagedConfigNonEmptyReads: r.stage.nonEmptyReads,
            stagedConfigSyntheticValueHits: r.stage.hits,
            stagedConfigReadErrors: r.stage.readErrors,
          },
        }
      : {}),
  });
}

// ---------------------------------------------------------------- fixtures
let TOOLS;
async function prepareTools() {
  const tools = join(RUN_ROOT, 'tools');
  const envRoot = join(tools, 'env');
  mkdirSync(tools, { recursive: true });
  const fixtureExe = join(tools, 'fixture-launcher.exe');
  const compile = await run(
    CSC,
    ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${fixtureExe}`, LAUNCHER_CS],
    { env: childEnv(envRoot), cwd: tools, timeoutMs: 60_000 },
  );
  if (compile.code !== 0 || !existsSync(fixtureExe)) throw new Error('Fixture launcher compilation failed.');
  const proxy = join(tools, 'chrome', 'chrome_proxy.exe');
  mkdirSync(dirname(proxy), { recursive: true });
  writeFileSync(proxy, 'Inert synthetic Shell Link target fixture (not Chrome).');
  const appId = (await runLauncher(fixtureExe, ['--expected-app-id', String(PORT)], envRoot)).stdout.trim();
  if (!/^[a-p]{32}$/.test(appId)) throw new Error('Fixture app ID unavailable.');
  const template = join(tools, 'pwa-template', 'Chrome source.lnk');
  mkdirSync(dirname(template), { recursive: true });
  const setup = await run(POWERSHELL, [...PS_ARGS, SETUP_SCRIPT], {
    env: childEnv(envRoot),
    cwd: tools,
    input: JSON.stringify({ source: template, proxy, arguments: `--profile-directory="Default" --app-id=${appId}`, installer: INSTALLER }),
    timeoutMs: 60_000,
  });
  const info = JSON.parse(setup.stdout.trim());
  results.runtime.powershell = info.psVersion;
  // Stamp the synthetic PWA AppUserModelID through the launcher's own non-launching verb.
  const stampRepo = join(tools, 'repo');
  for (const f of REPO_FILES) {
    mkdirSync(dirname(join(stampRepo, f)), { recursive: true });
    copyFileSync(join(CHECKOUT, f), join(stampRepo, f));
  }
  const stampConfig = join(tools, 'stamp-config.json');
  writeFileSync(
    stampConfig,
    JSON.stringify({ Repo: stampRepo, Node: NODE, DataDir: join(tools, 'stamp-store'), Port: PORT, Environment: {}, StartupTimeoutSeconds: 30, WindowTimeoutSeconds: 2, LauncherAppUserModelId: PWA_AUMID }),
  );
  const stamp = await runLauncher(fixtureExe, ['--ensure-gateway', '--config', stampConfig, '--stamp-shortcut', template], envRoot);
  const aumid = (await runLauncher(fixtureExe, ['--read-shortcut-id', template], envRoot)).stdout.trim();
  if (stamp.code !== 0 || aumid !== PWA_AUMID) throw new Error('Synthetic PWA shortcut could not be stamped.');
  TOOLS = { tools, template, templateDigest: digest(template), proxy, appId };
  return info;
}

function newFixture(id) {
  const root = join(RUN_ROOT, 'cases', id);
  const fx = {
    id,
    root,
    repo: join(root, 'repo'),
    store: join(root, 'store'),
    pwaDir: join(root, 'pwa'),
    pwa: join(root, 'pwa', 'Chrome source.lnk'),
    install: join(root, 'install'),
    desktop: join(root, 'shortcuts', 'Desktop', 'GraphGoblin.lnk'),
    programs: join(root, 'shortcuts', 'Programs', 'GraphGoblin.lnk'),
    envRoot: join(root, 'env'),
  };
  fx.exe = join(fx.install, 'GraphGoblin.exe');
  fx.config = `${fx.exe}.json`;
  for (const f of REPO_FILES) {
    mkdirSync(dirname(join(fx.repo, f)), { recursive: true });
    copyFileSync(join(CHECKOUT, f), join(fx.repo, f));
    if (digest(join(fx.repo, f)) !== digest(join(CHECKOUT, f))) throw new Error('Repo fixture copy mismatch.');
  }
  mkdirSync(fx.store, { recursive: true });
  mkdirSync(fx.pwaDir, { recursive: true });
  copyFileSync(TOOLS.template, fx.pwa);
  mkdirSync(dirname(fx.desktop), { recursive: true });
  mkdirSync(dirname(fx.programs), { recursive: true });
  childEnv(fx.envRoot);
  return fx;
}

async function runInstaller(fx, { environment = null, inherited = {}, switches = [], shortcuts = true, watchSentinels = [] } = {}) {
  const options = { RepoPath: fx.repo, NodePath: NODE, DataDir: fx.store, Port: PORT, PwaShortcut: fx.pwa, InstallDir: fx.install };
  const allSwitches = [...switches];
  if (shortcuts) {
    options.DesktopShortcut = fx.desktop;
    options.StartMenuShortcut = fx.programs;
  } else allSwitches.push('NoShortcuts');
  // Never let the installer fall back to personal Desktop/Start-menu defaults.
  if (!allSwitches.includes('NoShortcuts') && !(options.DesktopShortcut && options.StartMenuShortcut))
    throw new Error('Unsafe installer invocation.');
  const watcher = startStageWatch(fx.root, watchSentinels);
  const r = await run(POWERSHELL, [...PS_ARGS, INSTALL_SCRIPT], {
    env: childEnv(fx.envRoot, inherited),
    cwd: fx.root,
    input: JSON.stringify({ installer: INSTALLER, options, environment, switches: allSwitches }),
    timeoutMs: 180_000,
  });
  await sleep(400);
  watcher.close();
  r.stderrText = decodePsStderr(r.stderr);
  r.warningText = decodePsStderr(r.stderr, 'warning');
  r.message = firstLine(r.stderrText);
  r.stage = watcher.state;
  return r;
}

async function validatePublished(fx, configPath = fx.config) {
  if (!existsSync(fx.exe)) return { ok: false, detail: { reason: 'launcher not published' } };
  const r = await runLauncher(fx.exe, ['--validate-install', '--config', configPath], fx.envRoot);
  return { ok: r.code === 0 && r.stdout === '' && r.stderr === '', detail: { exitCode: r.code, stderr: redact(firstLine(r.stderr)) }, r };
}

async function verifyShortcut(fx, lnk, config) {
  const inspected = await runLauncher(fx.exe, ['--inspect-shortcut', lnk], fx.envRoot);
  let parsed = null;
  try {
    parsed = JSON.parse(inspected.stdout);
  } catch {}
  const id = (await runLauncher(fx.exe, ['--read-shortcut-id', lnk], fx.envRoot)).stdout.trim();
  const ok =
    !!parsed &&
    samePath(parsed.TargetPath, fx.exe) &&
    String(parsed.Arguments).toLowerCase() === `--config "${fx.exe}.json"`.toLowerCase() &&
    !!config &&
    id === config.LauncherAppUserModelId;
  return { ok, detail: { targetMatches: !!parsed && samePath(parsed.TargetPath, fx.exe), argumentsMatch: !!parsed && String(parsed.Arguments).toLowerCase() === `--config "${fx.exe}.json"`.toLowerCase(), appUserModelIdMatches: !!config && id === config.LauncherAppUserModelId } };
}

async function preconditionInstall(c, fx, environment = { GG_LOG_LEVEL: 'info' }) {
  const r = await runInstaller(fx, { environment });
  recordExecution(c, 'precondition: ordinary install', r);
  const config = readJson(fx.config);
  const ok = r.code === 0 && existsSync(fx.exe) && !!config && isDeepStrictEqual(config.Environment, environment);
  check(c, 'precondition.ordinary-install', `Ordinary install with ${Object.keys(environment).join(', ')} succeeds and persists exactly that Environment`, ok, { exitCode: r.code, message: redact(r.message) });
  if (!ok) return false;
  const v = await validatePublished(fx);
  check(c, 'precondition.native-validates', 'Published launcher accepts its published config through --validate-install (exit 0, no output)', v.ok, v.detail);
  return v.ok;
}

function stagedAssertion(c, stage, description = 'No staged launcher config containing the synthetic value was observed on disk during the run') {
  if (stage.hits > 0) return check(c, 'no-staged-plaintext', description, false, { stagedConfigEvents: stage.stageConfigEvents, hits: stage.hits });
  if (stage.stageConfigEvents === 0) return check(c, 'no-staged-plaintext', description, true, { stagedConfigEvents: 0 });
  if (stage.nonEmptyReads > 0) return check(c, 'no-staged-plaintext', description, true, { stagedConfigEvents: stage.stageConfigEvents, nonEmptyReads: stage.nonEmptyReads });
  return check(c, 'no-staged-plaintext', description, null, { stagedConfigEvents: stage.stageConfigEvents, reason: 'staged config seen but never read with content' });
}

function messageObservations(c, r, key) {
  observe(c, 'installer-message', 'First stderr line of the installer (redacted)', redact(r.message));
  observe(c, 'message-names-secret-concern', 'Message mentions secret/credential/plaintext/acknowledgement', /secret|credential|plain\s*-?text|acknowledg|sensitive/i.test(r.message));
  if (key) observe(c, 'message-names-key', 'Message names the refused key (case-insensitive)', r.message.toLowerCase().includes(key.toLowerCase()));
}

function persistedKeyObservation(c, fx, key) {
  const config = readJson(fx.config);
  const names = config?.Environment ? Object.keys(config.Environment) : [];
  observe(c, 'persisted-environment-keys', 'Environment key names in the published config after the run (values never recorded)', names);
  return names.some((n) => n.toLowerCase() === key.toLowerCase());
}

// ---------------------------------------------------------------- case groups
const SECRET_VARIANTS = [
  ['R01', 'GG_MASTER_KEY', 'upper'],
  ['R02', 'gg_master_key', 'lower'],
  ['R03', 'Gg_Master_Key', 'mixed (title)'],
  ['R04', 'GG_master_key', 'mixed (GG_ prefix, lower body)'],
  ['R05', 'GG_JEV_API_KEY', 'upper'],
  ['R06', 'gg_jev_api_key', 'lower'],
  ['R07', 'Gg_Jev_Api_Key', 'mixed (title)'],
  ['R08', 'GG_jev_api_key', 'mixed (GG_ prefix, lower body)'],
];
const sentinelFor = (key) => (key.toLowerCase() === 'gg_master_key' ? masterSentinel() : tokenSentinel());
const wanted = (id) => !ONLY || ONLY.has(id);

async function positiveCases() {
  if (wanted('P01')) {
    const c = makeCase('P01', 'positive', 'Ordinary explicit overrides (GG_LOG_LEVEL, GG_OLLAMA_ENABLED) with explicit shortcut destinations');
    const fx = newFixture('P01');
    const environment = { GG_LOG_LEVEL: 'info', GG_OLLAMA_ENABLED: 'false' };
    const r = await runInstaller(fx, { environment });
    recordExecution(c, 'install', r);
    const config = readJson(fx.config);
    check(c, 'installed', 'Installer exits 0 and reports "Launcher configured."', r.code === 0 && /Launcher configured\./.test(r.stdout), { exitCode: r.code, message: redact(r.message) });
    check(c, 'environment-persisted-exactly', 'Published Environment equals the explicit ordinary overrides exactly', !!config && isDeepStrictEqual(config.Environment, environment), { keys: config ? Object.keys(config.Environment ?? {}) : null });
    check(c, 'paths-persisted', 'Published Repo/DataDir/Port/Node equal the explicit disposable inputs', !!config && samePath(config.Repo, fx.repo) && samePath(config.DataDir, fx.store) && config.Port === PORT && samePath(config.Node, NODE));
    const v = await validatePublished(fx);
    check(c, 'native-validates', 'Published launcher accepts the published config through --validate-install', v.ok, v.detail);
    for (const [name, lnk] of [['desktop', fx.desktop], ['start-menu', fx.programs]]) {
      const s = existsSync(lnk) ? await verifyShortcut(fx, lnk, config) : { ok: false, detail: { reason: 'missing' } };
      check(c, `${name}-shortcut`, `Explicit ${name} shortcut targets the launcher with --config "<exe>.json" and the launcher AppUserModelID`, s.ok, s.detail);
    }
    check(c, 'data-dir-untouched', 'DataDir remains empty', readdirSync(fx.store).length === 0);
    check(c, 'no-stage-leftovers', 'No gg-launcher-stage-* folders or .previous/.replacement files remain', stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
    check(c, 'pwa-source-unchanged', 'Synthetic PWA source shortcut is unchanged', digest(fx.pwa) === TOOLS.templateDigest);
  }
  if (wanted('P02')) {
    const c = makeCase('P02', 'positive', "Guide's documented ordinary example (GG_REQUIRE_API_KEY, GG_DB_URL) with -NoShortcuts; false-positive control for 'API_KEY' substrings");
    const fx = newFixture('P02');
    const environment = { GG_REQUIRE_API_KEY: 'true', GG_DB_URL: `file:${fx.store.replaceAll('\\', '/')}/graphgoblin.db` };
    const r = await runInstaller(fx, { environment, shortcuts: false });
    recordExecution(c, 'install', r);
    const config = readJson(fx.config);
    check(c, 'installed', 'Installer exits 0 and reports "Launcher configured."', r.code === 0 && /Launcher configured\./.test(r.stdout), { exitCode: r.code, message: redact(r.message) });
    check(c, 'environment-persisted-exactly', 'Published Environment equals the documented ordinary overrides exactly', !!config && isDeepStrictEqual(config.Environment, environment));
    const v = await validatePublished(fx);
    check(c, 'native-validates', 'Published launcher accepts the published config through --validate-install', v.ok, v.detail);
    check(c, 'no-shortcuts-created', '-NoShortcuts creates no shortcut files at the disposable destinations', !existsSync(fx.desktop) && !existsSync(fx.programs));
    check(c, 'data-dir-untouched', 'DataDir remains empty', readdirSync(fx.store).length === 0);
  }
  if (wanted('P03')) {
    const c = makeCase('P03', 'positive', 'No -Environment at all, -NoShortcuts');
    const fx = newFixture('P03');
    const r = await runInstaller(fx, { shortcuts: false });
    recordExecution(c, 'install', r);
    const config = readJson(fx.config);
    check(c, 'installed', 'Installer exits 0', r.code === 0, { exitCode: r.code, message: redact(r.message) });
    check(c, 'environment-empty', 'Published Environment is empty', !!config && isDeepStrictEqual(config.Environment, {}));
    const v = await validatePublished(fx);
    check(c, 'native-validates', 'Published launcher accepts the published config through --validate-install', v.ok, v.detail);
  }
}

async function inheritedCases() {
  const groups = [
    ['I01', 'Inherited uppercase GG_MASTER_KEY, GG_JEV_API_KEY and JEV_API_KEY in the installer environment, explicit GG_LOG_LEVEL only', { GG_MASTER_KEY: masterSentinel(), GG_JEV_API_KEY: tokenSentinel(), JEV_API_KEY: tokenSentinel() }, { GG_LOG_LEVEL: 'info' }],
    ['I02', 'Inherited lower/mixed-case gg_master_key and Gg_Jev_Api_Key, no -Environment', { gg_master_key: masterSentinel(), Gg_Jev_Api_Key: tokenSentinel() }, null],
  ];
  for (const [id, description, inherited, environment] of groups) {
    if (!wanted(id)) continue;
    const c = makeCase(id, 'inherited-control', description, { inheritedKeys: Object.keys(inherited) });
    const fx = newFixture(id);
    const sentinels = Object.values(inherited);
    const r = await runInstaller(fx, { environment, inherited, shortcuts: false, watchSentinels: sentinels });
    recordExecution(c, 'install', r, sentinels);
    const config = readJson(fx.config);
    check(c, 'installed', 'Installer exits 0 (inherited values do not block an ordinary setup)', r.code === 0, { exitCode: r.code, message: redact(r.message) });
    check(c, 'inherited-not-persisted', 'Published Environment contains only the explicit overrides', !!config && isDeepStrictEqual(config.Environment, environment ?? {}), { keys: config ? Object.keys(config.Environment ?? {}) : null });
    check(c, 'no-echo', 'Installer output contains no part of any inherited synthetic value', !outputHas(r, sentinels));
    const hits = scanForSentinels(fx.root, sentinels);
    check(c, 'no-plaintext-files', 'No file under the case root contains any part of an inherited synthetic value', hits.length === 0, { hits: hits.map((h) => h.path) });
    stagedAssertion(c, r.stage, 'No staged launcher config containing an inherited synthetic value was observed');
    const v = await validatePublished(fx);
    check(c, 'native-validates', 'Published launcher accepts the published config through --validate-install', v.ok, v.detail);
  }
}

async function refusalOnExisting(id, key, variant, environmentFor, extraDescription = '') {
  const c = makeCase(id, 'secret-refusal-existing-install', `Explicit ${key} (${variant})${extraDescription} over a valid existing install`, { key, variant });
  const fx = newFixture(id);
  if (!(await preconditionInstall(c, fx))) return;
  const before = snapshot(fx);
  const value = sentinelFor(key);
  const environment = environmentFor(value);
  const r = await runInstaller(fx, { environment, watchSentinels: [value] });
  recordExecution(c, 'secret override install', r, [value]);
  check(c, 'refused', 'Installer refuses the secret-bearing override (non-zero exit, no timeout)', r.code !== 0 && r.code !== null && !r.timedOut, { exitCode: r.code });
  check(c, 'no-echo', 'Installer stdout/stderr contain no part of the synthetic value', !outputHas(r, [value]));
  const after = snapshot(fx);
  const diff = snapshotDiff(before, after);
  check(c, 'preexisting-unchanged', 'Preexisting launcher, config, shortcuts, PWA source, repo and DataDir are byte-identical with no new entries', diff.length === 0, diff);
  const hits = scanForSentinels(fx.root, [value]);
  check(c, 'no-plaintext-files', 'No file under the case root contains any part of the synthetic value', hits.length === 0, { hits: hits.map((h) => h.path) });
  stagedAssertion(c, r.stage);
  check(c, 'no-stage-leftovers', 'No gg-launcher-stage-* folders or .previous/.replacement files remain', stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
  check(c, 'data-dir-untouched', 'DataDir remains empty', readdirSync(fx.store).length === 0);
  const v = await validatePublished(fx);
  check(c, 'setup-still-valid', 'The existing published config still validates through the published launcher', v.ok, v.detail);
  messageObservations(c, r, key);
  observe(c, 'secret-key-persisted', 'Published config Environment carries the secret-bearing key name', persistedKeyObservation(c, fx, key));
}

async function refusalCases() {
  for (const [id, key, variant] of SECRET_VARIANTS)
    if (wanted(id)) await refusalOnExisting(id, key, variant, (value) => ({ GG_LOG_LEVEL: 'info', [key]: value }));
  if (wanted('R09'))
    await refusalOnExisting('R09', 'GG_JEV_API_KEY', 'upper', (value) => ({ GG_LOG_LEVEL: 'debug', GG_OLLAMA_ENABLED: 'false', GG_JEV_API_KEY: value }), ' combined with changed ordinary overrides (no silent strip-and-persist)');
}

async function freshRefusalCases() {
  for (const [id, key, variant] of [['F01', 'GG_MASTER_KEY', 'upper'], ['F02', 'GG_JEV_API_KEY', 'upper'], ['F03', 'GG_Master_Key', 'mixed (GG_ prefix, title body)']]) {
    if (!wanted(id)) continue;
    const c = makeCase(id, 'secret-refusal-fresh-install', `Explicit ${key} (${variant}) on a fresh InstallDir with explicit shortcut destinations`, { key, variant });
    const fx = newFixture(id);
    const value = sentinelFor(key);
    const r = await runInstaller(fx, { environment: { [key]: value }, watchSentinels: [value] });
    recordExecution(c, 'secret override install', r, [value]);
    check(c, 'refused', 'Installer refuses the secret-bearing override (non-zero exit, no timeout)', r.code !== 0 && r.code !== null && !r.timedOut, { exitCode: r.code });
    check(c, 'no-echo', 'Installer stdout/stderr contain no part of the synthetic value', !outputHas(r, [value]));
    check(c, 'no-launcher-published', 'No launcher executable or config is published', !existsSync(fx.exe) && !existsSync(fx.config));
    check(c, 'no-shortcuts-published', 'No Desktop/Start-menu shortcut is created', !existsSync(fx.desktop) && !existsSync(fx.programs));
    const hits = scanForSentinels(fx.root, [value]);
    check(c, 'no-plaintext-files', 'No file under the case root contains any part of the synthetic value', hits.length === 0, { hits: hits.map((h) => h.path) });
    stagedAssertion(c, r.stage);
    check(c, 'no-stage-leftovers', 'No gg-launcher-stage-* folders or .previous/.replacement files remain', stageLeftovers(fx.root).length === 0, stageLeftovers(fx.root));
    check(c, 'data-dir-untouched', 'DataDir remains empty', readdirSync(fx.store).length === 0);
    check(c, 'pwa-source-unchanged', 'Synthetic PWA source shortcut is unchanged', digest(fx.pwa) === TOOLS.templateDigest);
    messageObservations(c, r, key);
  }
}

async function regressionCases() {
  for (const [id, key, valueFor] of [['G01', 'GG_PORT', () => '9999'], ['G02', 'GG_Windows_Launcher_Log_Dir', (fx) => fx.root]]) {
    if (!wanted(id)) continue;
    const c = makeCase(id, 'existing-reserved-key-control', `Existing reserved-key refusal for ${key} still holds`, { key });
    const fx = newFixture(id);
    if (!(await preconditionInstall(c, fx))) continue;
    const before = snapshot(fx);
    const r = await runInstaller(fx, { environment: { GG_LOG_LEVEL: 'info', [key]: valueFor(fx) } });
    recordExecution(c, 'reserved override install', r);
    check(c, 'refused', 'Installer refuses the reserved key (non-zero exit)', r.code !== 0 && r.code !== null && !r.timedOut, { exitCode: r.code });
    check(c, 'refusal-message', 'Refusal names the staged configuration refusal / reserved GG_* overrides', /reserved GG_\*|refused/i.test(r.message), redact(r.message));
    const diff = snapshotDiff(before, snapshot(fx));
    check(c, 'preexisting-unchanged', 'Preexisting files byte-identical with no new entries', diff.length === 0, diff);
    const v = await validatePublished(fx);
    check(c, 'setup-still-valid', 'The existing published config still validates', v.ok, v.detail);
  }
}

async function nativeCases() {
  if (!wanted('N01')) return;
  const c = makeCase('N01', 'native-configuration', 'Published native launcher reading hand-written configs that carry secret-bearing keys (non-launching verbs only)', { nativeExpect: opts['native-expect'] });
  const fx = newFixture('N01');
  if (!(await preconditionInstall(c, fx))) return;
  const config = readJson(fx.config);
  for (const [name, lnk] of [['desktop', fx.desktop], ['start-menu', fx.programs]]) {
    const s = await verifyShortcut(fx, lnk, config);
    check(c, `precondition.${name}-shortcut`, `Published ${name} shortcut targets the launcher config with the launcher AppUserModelID`, s.ok, s.detail);
  }
  const nativeDir = join(fx.root, 'native');
  mkdirSync(nativeDir, { recursive: true });
  for (const key of ['GG_MASTER_KEY', 'GG_jev_api_key', 'gg_master_key']) {
    const value = sentinelFor(key);
    const tag = key.replace(/[^A-Za-z]/g, '');
    const fixtureConfig = join(nativeDir, `${tag}-${key === key.toUpperCase() ? 'u' : key === key.toLowerCase() ? 'l' : 'm'}.json`);
    writeFileSync(fixtureConfig, JSON.stringify({ ...config, Environment: { ...config.Environment, [key]: value } }));
    const before = snapshot(fx);
    const validate = await runLauncher(fx.exe, ['--validate-install', '--config', fixtureConfig], fx.envRoot);
    recordExecution(c, `--validate-install with ${key}`, validate, [value]);
    const accepted = validate.code === 0 && validate.stdout === '' && validate.stderr === '';
    check(c, `${key}.validate.no-echo`, `--validate-install output for ${key} contains no part of the synthetic value`, !outputHas(validate, [value]));
    observe(c, `${key}.validate.disposition`, `--validate-install disposition for a hand-written ${key} config`, accepted ? 'accepted' : `refused: ${redact(firstLine(validate.stderr))}`);
    if (opts['native-expect'] !== 'observe')
      check(c, `${key}.validate.disposition`, `--validate-install ${opts['native-expect']}s a hand-written ${key} config`, opts['native-expect'] === 'refuse' ? !accepted : accepted, { exitCode: validate.code });
    const created = join(nativeDir, `${basename(fixtureConfig, '.json')}-created.lnk`);
    const normal = await runLauncher(fx.exe, ['--config', fixtureConfig, '--ensure-gateway', '--create-shortcut', created], fx.envRoot);
    recordExecution(c, `--config --ensure-gateway --create-shortcut with ${key}`, normal, [value]);
    const normalAccepted = normal.code === 0 && existsSync(created);
    check(c, `${key}.create-shortcut.no-echo`, `Normal --config path output for ${key} contains no part of the synthetic value`, !outputHas(normal, [value]));
    observe(c, `${key}.create-shortcut.disposition`, `Normal --config path (create-shortcut, no launch) disposition for ${key}`, normalAccepted ? 'accepted' : `refused: ${redact(firstLine(normal.stderr))}`);
    if (opts['native-expect'] !== 'observe')
      check(c, `${key}.create-shortcut.disposition`, `Normal --config path ${opts['native-expect']}s a hand-written ${key} config`, opts['native-expect'] === 'refuse' ? !normalAccepted : normalAccepted, { exitCode: normal.code });
    unlinkSync(fixtureConfig); // the deliberate fixture input is the only expected carrier
    const hits = scanForSentinels(fx.root, [value]);
    check(c, `${key}.no-plaintext-files`, `After removing the fixture input, no launcher-produced file (logs, shortcuts) contains any part of the ${key} value`, hits.length === 0, { hits: hits.map((h) => h.path) });
    const diff = snapshotDiff(before, snapshot(fx));
    check(c, `${key}.published-install-unchanged`, 'The published launcher, config and shortcuts are unchanged by native reads', diff.length === 0, diff);
  }
  const v = await validatePublished(fx);
  check(c, 'published-config-still-validates', 'The ordinary published config still validates after the native reads', v.ok, v.detail);
}

async function acknowledgementCases(ackParam, ackSource) {
  if (!ackParam) {
    if (!wanted('A00')) return;
    const c = makeCase('A00', 'acknowledgement', 'Explicit acknowledgement route');
    notApplicable(c, 'acknowledgement-route', 'Installer offers a conspicuous acknowledgement switch for secret persistence', 'No acknowledgement switch was detected in the installer param block or supplied with --ack-param; refusal-only behaviour is tested by R/F cases.');
    return;
  }
  const groups = [
    ['A01', 'GG_MASTER_KEY', true],
    ['A02', 'GG_jev_api_key', true],
    ['A03', null, false],
  ];
  for (const [id, key] of groups) {
    if (!wanted(id)) continue;
    const c = makeCase(id, 'acknowledgement', key ? `Explicit ${key} with -${ackParam}` : `-${ackParam} with ordinary overrides only`, { ackParam, ackSource, key });
    const fx = newFixture(id);
    if (!(await preconditionInstall(c, fx))) continue;
    const value = key ? sentinelFor(key) : null;
    const environment = key ? { GG_LOG_LEVEL: 'info', [key]: value } : { GG_LOG_LEVEL: 'debug' };
    const r = await runInstaller(fx, { environment, switches: [ackParam], watchSentinels: value ? [value] : [] });
    recordExecution(c, 'acknowledged install', r, value ? [value] : []);
    const config = readJson(fx.config);
    check(c, 'installed', 'Acknowledged install exits 0', r.code === 0, { exitCode: r.code, message: redact(r.message) });
    if (value) {
      const stored = config?.Environment ? Object.entries(config.Environment).find(([k]) => k === key) : undefined;
      check(c, 'persisted-as-acknowledged', 'The acknowledged key is persisted with exactly the supplied value (value compared, never recorded)', !!stored && stored[1] === value);
      check(c, 'no-echo', 'Installer stdout/stderr contain no part of the synthetic value', !outputHas(r, [value]));
      observe(c, 'warning-present', 'Installer output carries a plaintext/secret warning', /secret|credential|plain\s*-?text|warning/i.test(`${r.stdout}\n${r.stderrText}\n${r.warningText}`));
    } else {
      check(c, 'environment-persisted-exactly', 'Published Environment equals the ordinary overrides exactly', !!config && isDeepStrictEqual(config.Environment, environment));
    }
    const v = await validatePublished(fx);
    check(c, 'native-validates', 'Published launcher accepts the acknowledged config', v.ok, v.detail);
  }
}

// ---------------------------------------------------------------- git (read-only)
async function gitFacts() {
  const env = {
    SystemRoot: SYSTEM_ROOT,
    PATH: process.env.PATH ?? '',
    USERPROFILE: process.env.USERPROFILE ?? '',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    GIT_OPTIONAL_LOCKS: '0', // never refresh or write the index
    GIT_TERMINAL_PROMPT: '0',
  };
  const head = await run('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD'], { env, cwd: CHECKOUT });
  const status = await run('git', ['-C', CHECKOUT, 'status', '--porcelain'], { env, cwd: CHECKOUT, timeoutMs: 120_000 });
  return { head: head.stdout.trim(), statusPorcelain: status.stdout.split(/\r?\n/).filter(Boolean), statusExit: status.code };
}
function productDigests() {
  return Object.fromEntries(['scripts/install-windows-launcher.ps1', ...REPO_FILES].map((f) => [f, digest(join(CHECKOUT, f))]));
}

// ---------------------------------------------------------------- main
async function main() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 22 || minor < 22 || (minor === 22 && patch < 2)) throw new Error(`Node ${process.version} is not 22.22.2+`);
  if (process.platform !== 'win32') throw new Error('Windows only.');
  mkdirSync(RUN_ROOT, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
  const gitBefore = await gitFacts();
  const digestsBefore = productDigests();
  results.checkout = {
    path: CHECKOUT,
    headBefore: gitBefore.head,
    expectedHead: opts['expect-head'] ?? null,
    headMatchesExpected: opts['expect-head'] ? gitBefore.head === opts['expect-head'] : null,
    statusPorcelainBefore: gitBefore.statusPorcelain,
    productDigestsBefore: digestsBefore,
  };
  const info = await prepareTools();
  const params = info.parameters ?? [];
  const detected = opts['no-ack-detect']
    ? null
    : params.find((p) => /SwitchParameter$/.test(p.type) && /acknowledg|allow.*(secret|plain|credential)|plain\s*text|insecure|unsafe/i.test(p.name))?.name ?? null;
  const ackParam = opts['ack-param'] ?? detected;
  results.inspection = {
    kind: 'code-inspection (PowerShell AST of the shipped installer param block)',
    installerParseErrors: info.parseErrors,
    installerParameters: params.map((p) => `${p.name}:${p.type.replace('System.Management.Automation.', '')}`),
    acknowledgementParameter: ackParam,
    acknowledgementSource: opts['ack-param'] ? 'cli' : detected ? 'detected' : 'none',
  };
  console.log(`[qa-437] run root ${RUN_ROOT}`);
  console.log(`[qa-437] installer params: ${results.inspection.installerParameters.join(', ')}`);
  for (const [name, fn] of [
    ['positive', positiveCases],
    ['inherited', inheritedCases],
    ['refusal', refusalCases],
    ['fresh-refusal', freshRefusalCases],
    ['regression', regressionCases],
    ['native', nativeCases],
    ['acknowledgement', () => acknowledgementCases(ackParam, results.inspection.acknowledgementSource)],
  ]) {
    const started = Date.now();
    await fn();
    console.log(`[qa-437] ${name} group done in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  // Global end-of-run sweep over every disposable fixture before cleanup.
  const sweep = scanForSentinels(RUN_ROOT, ALL_SENTINELS);
  results.endOfRunSweep = {
    description: 'Files under the run root containing any part of any synthetic value before cleanup (deliberate N01 fixture inputs were already removed)',
    count: sweep.length,
    files: sweep.map((h) => h.path),
  };
  const gitAfter = await gitFacts();
  const digestsAfter = productDigests();
  results.checkout.headAfter = gitAfter.head;
  results.checkout.statusPorcelainAfter = gitAfter.statusPorcelain;
  results.checkout.productDigestsUnchanged = isDeepStrictEqual(digestsBefore, digestsAfter);
  results.checkout.checkoutUnchanged = gitBefore.head === gitAfter.head && isDeepStrictEqual(gitBefore.statusPorcelain, gitAfter.statusPorcelain) && results.checkout.productDigestsUnchanged;

  if (!opts['keep-fixtures']) {
    let removed = false;
    for (let attempt = 0; attempt < 5 && !removed; attempt++) {
      try {
        rmSync(RUN_ROOT, { recursive: true, force: true });
        removed = !existsSync(RUN_ROOT);
      } catch {
        await sleep(1000);
      }
    }
    results.cleanup = { runRoot: RUN_ROOT, removed };
    const runs = join(OUT, 'runs');
    if (existsSync(runs) && readdirSync(runs).length === 0) rmSync(runs, { recursive: true, force: true });
  } else results.cleanup = { runRoot: RUN_ROOT, removed: false, kept: true };

  const tally = { assertions: 0, pass: 0, fail: 0, inconclusive: 0, notApplicable: 0, observations: 0, cases: results.cases.length };
  for (const c of results.cases) {
    tally.observations += c.observations.length;
    for (const a of c.assertions) {
      tally.assertions++;
      if (a.outcome === 'pass') tally.pass++;
      else if (a.outcome === 'fail') tally.fail++;
      else if (a.outcome === 'inconclusive') tally.inconclusive++;
      else tally.notApplicable++;
    }
    c.tally = {
      pass: c.assertions.filter((a) => a.outcome === 'pass').length,
      fail: c.assertions.filter((a) => a.outcome === 'fail').length,
      inconclusive: c.assertions.filter((a) => a.outcome === 'inconclusive').length,
      notApplicable: c.assertions.filter((a) => a.outcome === 'not-applicable').length,
    };
  }
  results.totals = tally;
  results.finishedAt = new Date().toISOString();

  let json = JSON.stringify(results, null, 1);
  results.selfCheck = containsAny(Buffer.from(json), ALL_SENTINELS) ? 'redacted' : 'clean';
  json = redact(JSON.stringify(results, null, 1));
  const resultsFile = join(RESULTS_DIR, `qa-437-${opts.label}-${STAMP}.json`);
  writeFileSync(resultsFile, json);
  const table = [
    `# QA #437 driver table: ${opts.label} (${STAMP})`,
    '',
    `Checkout ${results.checkout.headBefore}; Node ${process.version}; Windows PowerShell ${results.runtime.powershell}.`,
    `Assertions ${tally.assertions}: pass ${tally.pass}, fail ${tally.fail}, inconclusive ${tally.inconclusive}, n/a ${tally.notApplicable}; observations ${tally.observations}; cases ${tally.cases}.`,
    `Checkout unchanged: ${results.checkout.checkoutUnchanged}. Results self-check: ${results.selfCheck}. Fixtures removed: ${results.cleanup.removed}.`,
    '',
    '| Case | Kind | Pass | Fail | Inconcl. | N/A | Failed / inconclusive assertions |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.cases.map((c) => `| ${c.id} | ${c.kind} | ${c.tally.pass} | ${c.tally.fail} | ${c.tally.inconclusive} | ${c.tally.notApplicable} | ${c.assertions.filter((a) => a.outcome === 'fail' || a.outcome === 'inconclusive').map((a) => `${a.id} (${a.outcome})`).join(', ') || '-'} |`),
    '',
  ].join('\n');
  writeFileSync(join(RESULTS_DIR, `qa-437-${opts.label}-${STAMP}.table.md`), redact(table));
  console.log(`[qa-437] results ${resultsFile}`);
  console.log(`[qa-437] assertions ${tally.assertions}: pass ${tally.pass}, fail ${tally.fail}, inconclusive ${tally.inconclusive}, n/a ${tally.notApplicable}; observations ${tally.observations}`);
}

main().catch((error) => {
  console.error(`[qa-437] driver error: ${redact(error?.message ?? String(error))}`);
  try {
    results.driverError = redact(error?.message ?? String(error));
    results.finishedAt = new Date().toISOString();
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, `qa-437-${opts.label}-${STAMP}.error.json`), redact(JSON.stringify(results, null, 2)));
  } catch {}
  process.exit(1);
});
