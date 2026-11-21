// QA459T independent #459 D166 F4 candidate timing extension driver. Not product code.
// Compiles the checkout's unmodified committed apps/windows-launcher/Launcher.cs together with the
// frozen harness/Qa459tCleanupDecision.cs in one csc invocation (/main:Qa459tCleanupDecision), so the
// harness reaches the intended internal seam HelperProcess.AwaitCleanup without reflection. Binds the
// source, harness and assembly hashes, runs the harness once and records raw and scrubbed results.
// Stops on a failed compile; never overwrites an output; never runs an older assembly.
//
// node qa459t-f4.mjs --checkout <dir> --scratch <dir> --out <dir> --expect-head <sha> --expect-tree <sha>
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WATCHDOG_MS = 60_000;
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
const runId = `f4-${now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const privateRun = join(out, 'private', 'f4', runId);
const publicRun = join(out, 'public', 'f4', runId);
const scratchRun = join(scratch, 'f4', runId);
for (const path of [privateRun, publicRun, scratchRun]) {
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

const run = { schema: 'qa459t-f4-run/1', runId, startUtc: now(), node: process.version, setupFaults: [] };
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
const harnessSource = join(here, 'harness', 'Qa459tCleanupDecision.cs');
run.checkout = {
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').split('\n').filter(Boolean).length,
  launcherGitBlob: git('rev-parse', 'HEAD:apps/windows-launcher/Launcher.cs'),
  launcherWorktreeMatchesHead: (() => {
    try {
      execFileSync('git', ['-C', checkout, 'diff', '--quiet', 'HEAD', '--', 'apps/windows-launcher/Launcher.cs']);
      return true;
    } catch {
      return false;
    }
  })(),
  expectedHead: expectHead,
  expectedTree: expectTree,
};
run.driver = Object.fromEntries(['qa459t-f4.mjs', 'harness/Qa459tCleanupDecision.cs', 'README.md'].map((path) => [path, fileSha(join(here, path))]));
run.inputs = { launcherSource: { sha256: fileSha(launcherSource) }, harnessSource: { sha256: fileSha(harnessSource) } };
save();
if (run.checkout.head !== expectHead || run.checkout.tree !== expectTree || run.checkout.trackedChanges !== 0 || !run.checkout.launcherWorktreeMatchesHead)
  fault('checkout-mismatch', run.checkout);

// ---------- compile (one invocation; same assembly gives internal access) ----------
const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const exe = join(scratchRun, 'bin', 'Qa459tCleanupDecision.exe');
mkdirSync(dirname(exe), { recursive: true });
if (existsSync(exe)) fault('assembly-exists', exe);
const args = [
  '/nologo', '/target:exe', '/optimize+', '/platform:x64', '/main:Qa459tCleanupDecision',
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
  `/out:${exe}`, launcherSource, harnessSource,
];
const compileStarted = Date.now();
const compiled = spawnSync(compiler, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
run.compile = { compiler: { path: compiler, sha256: fileSha(compiler) }, args, exit: compiled.status, signal: compiled.signal, ms: Date.now() - compileStarted, stdout: compiled.stdout, stderr: compiled.stderr };
save();
if (compiled.status !== 0 || !existsSync(exe)) fault('compile-failed', { exit: compiled.status });
run.assembly = { sha256: fileSha(exe), bytes: readFileSync(exe).length };
run.inputs.launcherSourceAfterCompile = { sha256: fileSha(launcherSource) };
run.inputs.harnessSourceAfterCompile = { sha256: fileSha(harnessSource) };
save();
if (run.inputs.launcherSourceAfterCompile.sha256 !== run.inputs.launcherSource.sha256 || run.inputs.harnessSourceAfterCompile.sha256 !== run.inputs.harnessSource.sha256)
  fault('source-changed-during-compile', run.inputs);

// ---------- execute once ----------
const resultPath = join(scratchRun, 'f4-result.json');
const executed = await new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(exe, [resultPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  let watchdog = false;
  const timer = setTimeout(() => {
    watchdog = true;
    child.kill(); // exact retained handle; QA watchdog only
  }, WATCHDOG_MS);
  child.on('error', (error) => {
    clearTimeout(timer);
    resolve({ pid: child.pid, spawnError: error.code ?? String(error), ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), watchdog });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ pid: child.pid, code, signal, ms: Date.now() - started, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), watchdog });
  });
});
writeFileSync(join(privateRun, 'harness.stdout.bin'), executed.stdout);
writeFileSync(join(privateRun, 'harness.stderr.bin'), executed.stderr);
run.execution = {
  pid: executed.pid,
  exit: executed.code ?? null,
  signal: executed.signal ?? null,
  spawnError: executed.spawnError ?? null,
  watchdog: executed.watchdog,
  ms: executed.ms,
  stdout: executed.stdout.toString('utf8'),
  stderr: executed.stderr.toString('utf8'),
};
if (!existsSync(resultPath)) fault('no-result', run.execution);
const raw = readFileSync(resultPath);
writeFileSync(join(privateRun, 'f4-result.json'), raw);
let result;
try {
  result = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(result.cases)) throw new Error('no cases');
} catch (error) {
  fault('result-unparseable', { message: String(error), execution: run.execution });
}
run.result = { sha256: sha256(raw), bytes: raw.length };
run.cases = result.cases.map((item) => ({
  id: item.id,
  name: item.name,
  expectedResult: item.expectedResult,
  actualResult: item.actualResult,
  trace: item.trace,
  samples: item.samples,
  observations: item.observations,
  wallMs: item.wallMs,
  verdict: item.verdict,
  failedChecks: item.checks.filter((check) => !check.pass).map((check) => check.name),
}));
run.cleanupMilliseconds = result.cleanupMilliseconds;
run.summary = { ...result.summary, harnessExit: executed.code ?? null, watchdog: executed.watchdog };
writeFileSync(join(publicRun, 'f4-result.json'), JSON.stringify(scrub(result), null, 2) + '\n');
const ok = executed.code === 0 && !executed.watchdog && result.summary.failed === 0 && result.cases.length === 8 && result.cleanupMilliseconds === 2000;
finish(ok ? 'COMPLETED-ALL-PASS' : 'COMPLETED-WITH-FAILURES', ok ? 0 : 1);
