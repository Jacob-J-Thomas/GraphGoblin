// QA167I deadline-seam runner. Not product code. Verifies the checkout and assemblies, runs
// Qa167iDeadline.exe once, and retains raw private originals plus a scrubbed public projection.
// node qa167i-deadline.mjs --checkout <dir> --bin <dir> --build-record <json> --scratch <dir> --out <dir>
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { arg, checkoutState, fileSha, now, scrubber } from './qa167i-common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checkout = arg('--checkout');
const bin = arg('--bin');
const build = JSON.parse(readFileSync(arg('--build-record'), 'utf8'));
const scratch = arg('--scratch');
const out = arg('--out');
const frozen = JSON.parse(readFileSync(join(here, 'qa167i-cases.json'), 'utf8'));
const runId = `deadline-${now().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const privateRun = join(out, 'private', runId);
const publicRun = join(out, 'public', runId);
const work = join(scratch, runId);
for (const path of [privateRun, publicRun, work]) {
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  mkdirSync(path, { recursive: true });
}
const run = { schema: 'qa167i-deadline-run/1', runId, startUtc: now(), node: process.version, execPath: process.execPath };
run.checkout = checkoutState(checkout);
run.assemblies = {
  deadline: { sha256: fileSha(join(bin, 'Qa167iDeadline.exe')), recorded: build.outputs.deadline.sha256 },
  launcherSource: { sha256: fileSha(join(checkout, 'apps/windows-launcher/Launcher.cs')), recorded: build.inputs.launcherSource.sha256 },
  harnessSource: { sha256: fileSha(join(here, 'Qa167iDeadline.cs')), recorded: build.inputs.deadlineHarness.sha256 },
};
const save = () => writeFileSync(join(privateRun, 'run.json'), JSON.stringify(run, null, 2) + '\n');
const faults = [];
if (!run.checkout.matches) faults.push('checkout-mismatch');
for (const [name, item] of Object.entries(run.assemblies)) if (item.sha256 !== item.recorded) faults.push(`${name}-mismatch`);
if (faults.length) {
  run.status = 'SETUP-FAULT';
  run.faults = faults;
  save();
  throw new Error(faults.join(','));
}

const resultPath = join(work, 'result.json');
const started = Date.now();
const child = spawn(join(bin, 'Qa167iDeadline.exe'), [join(work, 'helper-work'), process.execPath, resultPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const stdout = [], stderr = [];
child.stdout.on('data', (chunk) => stdout.push(chunk));
child.stderr.on('data', (chunk) => stderr.push(chunk));
let watchdog = false;
const timer = setTimeout(() => { watchdog = true; child.kill(); }, 120_000); // driver watchdog on the exact handle
const exit = await new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
run.process = { pid: child.pid, ...exit, watchdog, ms: Date.now() - started };
writeFileSync(join(privateRun, 'stdout.bin'), Buffer.concat(stdout));
writeFileSync(join(privateRun, 'stderr.bin'), Buffer.concat(stderr));
const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null;
if (result) writeFileSync(join(privateRun, 'result.json'), readFileSync(resultPath));
run.result = result;
const ids = (result?.cases ?? []).map((item) => item.id);
run.frozenCaseIds = frozen.deadlineCases.map((item) => item.id);
run.caseIdsMatchFrozen = JSON.stringify(ids) === JSON.stringify(run.frozenCaseIds);
run.status = !result || watchdog ? 'SETUP-FAULT' : run.caseIdsMatchFrozen ? 'COMPLETED' : 'SETUP-FAULT';
run.endUtc = now();
save();
const scrub = scrubber([[scratch, '<scratch>'], [checkout, '<checkout>'], [out, '<out>']]);
writeFileSync(join(publicRun, 'run.json'), JSON.stringify(scrub(run), null, 2) + '\n');
console.log(Buffer.concat(stdout).toString('utf8').trim());
console.log(JSON.stringify({ runId, status: run.status, exit: exit.code, summary: result?.summary ?? null }));
