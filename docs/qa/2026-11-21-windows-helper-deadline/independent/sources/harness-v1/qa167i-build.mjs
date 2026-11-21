// QA167I build step. Not product code. Compiles the checkout's unmodified Launcher.cs three ways:
//   1. production launcher GraphGoblin.exe with the installer's csc flags (scripts/install-windows-launcher.ps1);
//   2. Qa167iDeadline.exe: Launcher.cs + harness in one assembly (/main:Qa167iDeadline) for the internal seam;
//   3. Qa167iPublicEntry.exe referencing GraphGoblin.exe (public members only).
// Refuses to overwrite outputs or the record. Stops at the first failed compile (no stale assembly reuse).
// node qa167i-build.mjs --checkout <dir> --bin <dir> --record <json>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { arg, checkoutState, fileSha, now } from './qa167i-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checkout = arg('--checkout');
const bin = arg('--bin');
const recordPath = arg('--record');
if (existsSync(recordPath)) throw new Error('build record exists; never overwritten');
mkdirSync(bin, { recursive: true });
const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const launcherSource = join(checkout, 'apps', 'windows-launcher', 'Launcher.cs');
const deadlineSource = join(here, 'Qa167iDeadline.cs');
const publicSource = join(here, 'Qa167iPublicEntry.cs');
const outputs = {
  launcher: join(bin, 'GraphGoblin.exe'),
  deadline: join(bin, 'Qa167iDeadline.exe'),
  publicEntry: join(bin, 'Qa167iPublicEntry.exe'),
};
for (const output of Object.values(outputs)) if (existsSync(output)) throw new Error(`${output} exists; never overwritten`);

const record = {
  schema: 'qa167i-build-record/1',
  startUtc: now(),
  node: process.version,
  checkout: checkoutState(checkout),
  compiler: { path: compiler, sha256: fileSha(compiler) },
  inputs: {
    launcherSource: { sha256: fileSha(launcherSource) },
    deadlineHarness: { sha256: fileSha(deadlineSource) },
    publicEntryHarness: { sha256: fileSha(publicSource) },
  },
  steps: [],
};
const save = () => writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
if (!record.checkout.matches) {
  record.fault = 'checkout-mismatch';
  save();
  throw new Error('checkout mismatch');
}
function compile(label, args) {
  const started = Date.now();
  const result = spawnSync(compiler, args, { encoding: 'utf8', windowsHide: true, timeout: 180_000 });
  record.steps.push({ label, args, exit: result.status, signal: result.signal, ms: Date.now() - started, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) {
    record.fault = `${label}-compile-failed`;
    record.endUtc = now();
    save();
    throw new Error(`${label} compilation failed`);
  }
}
const frameworkReferences = ['/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll'];
compile('production-launcher', ['/nologo', '/target:winexe', '/optimize+', '/platform:x64', ...frameworkReferences, `/out:${outputs.launcher}`, launcherSource]);
compile('deadline-harness-same-assembly', ['/nologo', '/target:exe', '/optimize+', '/platform:x64', '/main:Qa167iDeadline', ...frameworkReferences, `/out:${outputs.deadline}`, launcherSource, deadlineSource]);
compile('public-entry-harness', ['/nologo', '/target:exe', '/optimize+', '/platform:x64', `/reference:${outputs.launcher}`, '/reference:System.Web.Extensions.dll', `/out:${outputs.publicEntry}`, publicSource]);
record.inputs.launcherSourceAfter = { sha256: fileSha(launcherSource) };
record.outputs = Object.fromEntries(
  Object.entries(outputs).map(([name, path]) => [name, { file: path, sha256: fileSha(path), bytes: readFileSync(path).length }]),
);
record.endUtc = now();
save();
console.log(JSON.stringify(Object.fromEntries(Object.entries(record.outputs).map(([name, item]) => [name, item.sha256]))));
