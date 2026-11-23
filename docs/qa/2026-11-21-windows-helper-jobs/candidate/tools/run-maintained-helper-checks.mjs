// GraphGoblin #459 independent QA: run the checkout's maintained NativeChecks --helper-checks control
// unmodified (compiled into scratch with the maintained acceptance flags), recording its output.
// Usage: node run-maintained-helper-checks.mjs <checkout> <scratch dir> <output dir>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [checkout, scratch, out] = process.argv.slice(2);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
mkdirSync(join(scratch, 'work'), { recursive: true });
mkdirSync(join(scratch, 'temp'), { recursive: true });
mkdirSync(out, { recursive: true });
const exe = join(scratch, 'NativeChecks.exe');
const sources = ['apps/windows-launcher/Launcher.cs', 'apps/windows-launcher/NativeChecks.cs'].map((file) => join(checkout, file));
const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const compileOutput = execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:NativeChecks', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${exe}`, ...sources], { encoding: 'utf8', windowsHide: true });
const keep = ['SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'PSModulePath', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const env = Object.fromEntries(keep.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
env.Path = `${dirname(process.execPath)};${process.env.Path ?? process.env.PATH ?? ''}`;
env.TEMP = env.TMP = join(scratch, 'temp');
const started = Date.now();
const result = spawnSync(exe, ['--helper-checks', join(scratch, 'work'), process.execPath], { env, windowsHide: true, timeout: 120_000, encoding: 'utf8' });
const record = {
  schema: 'gg459-maintained-helper-checks/1',
  sources: Object.fromEntries(sources.map((path, index) => [['Launcher.cs', 'NativeChecks.cs'][index], sha(path)])),
  compileFlags: '/nologo /target:exe /platform:x64 /main:NativeChecks /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll',
  compileOutputLines: compileOutput.split(/\r?\n/).filter(Boolean).length,
  exeSha256: sha(exe),
  argv: ['--helper-checks', '<scratch>/work', '<node>'],
  startedAt: new Date(started).toISOString(),
  elapsedMs: Date.now() - started,
  status: result.status,
  signal: result.signal,
  error: result.error?.code ?? null,
  stdout: result.stdout,
  stderr: result.stderr,
  passedMarker: /Native helper job, pipe and deadline checks passed/.test(result.stdout ?? ''),
};
writeFileSync(join(out, 'maintained-helper-checks.json'), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ status: record.status, elapsedMs: record.elapsedMs, passedMarker: record.passedMarker, stdout: record.stdout, stderr: record.stderr }, null, 1));
