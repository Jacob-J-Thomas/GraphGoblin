// QA459I independent #459 correction QA build step. Not product code.
// Compiles the checkout's unmodified apps/windows-launcher/Launcher.cs with the shipped installer's
// csc flags (scripts/install-windows-launcher.ps1) into <scratch>/bin/GraphGoblin.exe, then compiles
// the independent harness against that assembly. Writes a private build record with exact hashes.
//
// node qa459i-build.mjs --checkout <checkout> --scratch <scratch> --record <build-record.json>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
};
const checkout = arg('--checkout');
const scratch = arg('--scratch');
const recordPath = arg('--record');
if (existsSync(recordPath)) throw new Error('build record exists; never overwritten');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const bin = join(scratch, 'bin');
mkdirSync(bin, { recursive: true });
const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const launcherSource = join(checkout, 'apps', 'windows-launcher', 'Launcher.cs');
const harnessSource = join(here, 'harness', 'Qa459iHarness.cs');
const launcherExe = join(bin, 'GraphGoblin.exe');
const harnessExe = join(bin, 'Qa459iHarness.exe');
for (const output of [launcherExe, harnessExe]) if (existsSync(output)) throw new Error(`${output} exists; never overwritten`);

const record = {
  schema: 'qa459i-build-record/1',
  startUtc: new Date().toISOString(),
  node: process.version,
  checkout: { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), trackedChanges: git('status', '--porcelain=v1', '--untracked-files=no').length },
  compiler: { path: compiler, sha256: sha256(compiler) },
  steps: [],
};
function compile(label, args) {
  const started = Date.now();
  const result = spawnSync(compiler, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  record.steps.push({ label, args, exit: result.status, signal: result.signal, ms: Date.now() - started, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) {
    record.endUtc = new Date().toISOString();
    writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
    throw new Error(`${label} compilation failed`);
  }
}
// Exactly the installer's flags and source (install-windows-launcher.ps1 lines 355-358).
compile('production-launcher', [
  '/nologo', '/target:winexe', '/optimize+', '/platform:x64',
  '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
  `/out:${launcherExe}`, launcherSource,
]);
compile('independent-harness', [
  '/nologo', '/target:exe', '/optimize+', '/platform:x64',
  `/reference:${launcherExe}`, '/reference:System.Web.Extensions.dll',
  `/out:${harnessExe}`, harnessSource,
]);
record.inputs = {
  launcherSource: { path: launcherSource, sha256: sha256(launcherSource), gitBlob: git('rev-parse', 'HEAD:apps/windows-launcher/Launcher.cs') },
  harnessSource: { path: harnessSource, sha256: sha256(harnessSource) },
};
record.outputs = {
  launcherAssembly: { path: launcherExe, sha256: sha256(launcherExe), bytes: readFileSync(launcherExe).length },
  harnessAssembly: { path: harnessExe, sha256: sha256(harnessExe), bytes: readFileSync(harnessExe).length },
};
record.endUtc = new Date().toISOString();
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ launcher: record.outputs.launcherAssembly.sha256, harness: record.outputs.harnessAssembly.sha256 }));
