// QA459N independent #459 D166 relevant ordinary native regressions runner. Not product code.
// Executes, unchanged, the three maintained NativeChecks modes that the existing acceptance subtest
// 'native closed outcomes, launcher pair bounds and NUL stdio checks'
// (tooling/scripts/windows-launcher.acceptance.mjs, test 'bounded Windows logs: ...') runs, with that
// subtest's exact csc command, argument order, timeouts, isolated TEMP/TMP environment and expected
// stdout. Only the fixture location differs: an owned disposable scratch folder instead of the
// checkout's .tmp. NativeChecks.cs and Launcher.cs are the candidate's committed, unmodified sources.
//
// node qa459n-native.mjs --checkout <dir> --scratch <dir> --out <dir> --expect-head <sha> --expect-tree <sha>
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
};
const checkout = option('--checkout');
const scratch = option('--scratch');
const out = option('--out');
const expectHead = option('--expect-head');
const expectTree = option('--expect-tree');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileSha = (path) => sha256(readFileSync(path));
const now = () => new Date().toISOString();
const runId = `native-${now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const privateRun = join(out, 'private', 'native', runId);
const publicRun = join(out, 'public', 'native', runId);
const base = join(scratch, 'native', runId);
for (const path of [privateRun, publicRun, base]) {
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  mkdirSync(path, { recursive: true });
}
const roots = [
  [scratch, '<scratch>'],
  [checkout, '<checkout>'],
  [out, '<out>'],
  [homedir(), '<home>'],
];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function scrub(value) {
  if (typeof value === 'string') {
    let text = value;
    for (const [path, token] of roots)
      for (const form of [path.replace(/\//g, '\\').replace(/\\/g, '\\\\'), path.replace(/\//g, '\\'), path.replace(/\\/g, '/')])
        text = text.replace(new RegExp(escapeRegExp(form), 'gi'), token);
    return text.replace(/98jak/gi, '<user>');
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  return value;
}

const run = { schema: 'qa459n-native-run/1', runId, startUtc: now(), node: process.version, execPath: process.execPath, setupFaults: [], entries: [] };
const save = () => writeFileSync(join(privateRun, 'run.json'), JSON.stringify(run, null, 2) + '\n');
const finish = (status, code) => {
  run.status = status;
  run.endUtc = now();
  save();
  writeFileSync(join(publicRun, 'run.json'), JSON.stringify(scrub(run), null, 2) + '\n');
  console.log(JSON.stringify({ runId, status, summary: run.summary ?? null }));
  process.exit(code);
};
const fault = (kind, detail) => {
  run.setupFaults.push({ at: now(), kind, detail });
  finish('SETUP-FAULT', 3);
};

// ---------- binding ----------
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const launcherSource = join(checkout, 'apps', 'windows-launcher', 'Launcher.cs');
const checksSource = join(checkout, 'apps', 'windows-launcher', 'NativeChecks.cs');
const acceptance = join(checkout, 'tooling', 'scripts', 'windows-launcher.acceptance.mjs');
const cleanPath = (path) => {
  try {
    execFileSync('git', ['-C', checkout, 'diff', '--quiet', 'HEAD', '--', path]);
    return true;
  } catch {
    return false;
  }
};
run.checkout = {
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').split('\n').filter(Boolean).length,
  sourcesMatchHead: cleanPath('apps/windows-launcher') && cleanPath('tooling/scripts/windows-launcher.acceptance.mjs'),
  expectedHead: expectHead,
  expectedTree: expectTree,
};
run.sources = {
  'apps/windows-launcher/Launcher.cs': { sha256: fileSha(launcherSource), gitBlob: git('rev-parse', 'HEAD:apps/windows-launcher/Launcher.cs') },
  'apps/windows-launcher/NativeChecks.cs': { sha256: fileSha(checksSource), gitBlob: git('rev-parse', 'HEAD:apps/windows-launcher/NativeChecks.cs') },
  'tooling/scripts/windows-launcher.acceptance.mjs': { sha256: fileSha(acceptance) },
};
run.driver = Object.fromEntries(['qa459n-native.mjs', 'README.md'].map((path) => [path, fileSha(join(here, path))]));
save();
if (run.checkout.head !== expectHead || run.checkout.tree !== expectTree || run.checkout.trackedChanges !== 0 || !run.checkout.sourcesMatchHead)
  fault('checkout-mismatch', run.checkout);

// ---------- fixture folders, as in the maintained 'bounded Windows logs' test ----------
const systemTool = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
const install = join(base, 'install α');
mkdirSync(install, { recursive: true });
const who = spawnSync(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
const sid = /"(S-1-[0-9-]+)"/.exec(who.stdout ?? '')?.[1];
if (who.status !== 0 || !sid) fault('current-user-sid', { exit: who.status });
const acl = spawnSync(systemTool('icacls.exe'), [install, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
run.privateInstall = { whoamiExit: who.status, icaclsExit: acl.status };
save();
if (acl.status !== 0) fault('private-install-acl', run.privateInstall);
const isolatedTemp = join(base, 'isolated temp');
mkdirSync(isolatedTemp);
const work = join(base, 'native checks');
mkdirSync(work);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GG_') && key !== 'JEV_API_KEY'));
const environment = { ...env, TEMP: isolatedTemp, TMP: isolatedTemp };

// ---------- the maintained compile command ----------
const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const checks = join(install, 'NativeChecks.exe');
if (existsSync(checks)) fault('assembly-exists', checks);
const compileArgs = ['/nologo', '/target:exe', '/platform:x64', '/main:NativeChecks', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${checks}`, launcherSource, checksSource];
const compileStarted = Date.now();
const compiled = spawnSync(compiler, compileArgs, { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
run.compile = { compiler: { path: compiler, sha256: fileSha(compiler) }, args: compileArgs, exit: compiled.status, signal: compiled.signal, ms: Date.now() - compileStarted, stdout: compiled.stdout, stderr: compiled.stderr };
save();
if (compiled.status !== 0 || !existsSync(checks)) fault('compile-failed', { exit: compiled.status });
run.assembly = { sha256: fileSha(checks), bytes: readFileSync(checks).length };
if (fileSha(launcherSource) !== run.sources['apps/windows-launcher/Launcher.cs'].sha256 || fileSha(checksSource) !== run.sources['apps/windows-launcher/NativeChecks.cs'].sha256)
  fault('source-changed-during-compile', null);
save();

// ---------- run one maintained mode with the subtest's timeout (execFile semantics) ----------
function execute(file, args, timeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    const startedUtc = now();
    const child = spawn(file, args, { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(); // exact retained handle; the maintained execFile timeout behaves the same way
    }, timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, startedUtc, spawnError: error.code ?? String(error), ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, startedUtc, code, signal, ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut });
    });
  });
}

const ENTRIES = [
  {
    id: 'N1',
    mode: '--bounded-log-checks',
    args: ['--bounded-log-checks', work, process.execPath],
    timeout: 60_000,
    expect: (stdout) => /bounded log, closed outcome and NUL stdio checks passed/.test(stdout),
    expectation: 'exit 0 and stdout matches /bounded log, closed outcome and NUL stdio checks passed/',
  },
  {
    id: 'N2',
    mode: '--helper-checks',
    args: ['--helper-checks', work, process.execPath],
    timeout: 60_000,
    expect: (stdout) => /Native helper job, pipe and deadline checks passed/.test(stdout),
    expectation: 'exit 0 and stdout matches /Native helper job, pipe and deadline checks passed/',
  },
  {
    id: 'N3',
    mode: '--cleanup-deadline-checks',
    args: ['--cleanup-deadline-checks'],
    timeout: 10_000,
    expect: (stdout) => stdout.trim() === 'Deterministic cleanup decision checks passed (no kernel fault injected).',
    expectation: "exit 0 and trimmed stdout equals 'Deterministic cleanup decision checks passed (no kernel fault injected).'",
  },
];
// The maintained subtest awaits each command in order and stops at the first rejection.
for (const entry of ENTRIES) {
  const result = await execute(checks, entry.args, entry.timeout);
  writeFileSync(join(privateRun, `${entry.id}.stdout.bin`), result.stdout);
  writeFileSync(join(privateRun, `${entry.id}.stderr.bin`), result.stderr);
  const stdout = result.stdout.toString('utf8');
  const pass = result.code === 0 && !result.timedOut && entry.expect(stdout);
  run.entries.push({
    id: entry.id,
    mode: entry.mode,
    expectation: entry.expectation,
    pid: result.pid,
    startedUtc: result.startedUtc,
    exit: result.code ?? null,
    signal: result.signal ?? null,
    spawnError: result.spawnError ?? null,
    timedOut: result.timedOut,
    ms: result.ms,
    stdout,
    stderr: result.stderr.toString('utf8'),
    verdict: pass ? 'PASS' : 'FAIL',
  });
  save();
  if (!pass) break;
}
// The maintained parent test also requires no managed log names in the isolated TEMP.
run.isolatedTempManagedLogNames = readdirSync(isolatedTemp).filter((name) => /(gateway|launcher)\.log/i.test(name));
run.summary = {
  entries: run.entries.length,
  passed: run.entries.filter((item) => item.verdict === 'PASS').length,
  failed: run.entries.filter((item) => item.verdict !== 'PASS').length,
  isolatedTempClean: run.isolatedTempManagedLogNames.length === 0,
};
const ok = run.summary.entries === 3 && run.summary.failed === 0 && run.summary.isolatedTempClean;
finish(ok ? 'COMPLETED-ALL-PASS' : 'COMPLETED-WITH-FAILURES', ok ? 0 : 1);
