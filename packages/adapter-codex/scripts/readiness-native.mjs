import process from 'node:process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
import { bundledCli, runCli } from '../dist/cli.js';
import { CodexHarness } from '../dist/harness.js';
const directory = await mkdtemp(join(tmpdir(), 'gg-readiness-native-codex-'));
const snapshot = async () => {
  const script =
    "$ErrorActionPreference='Stop'; try { $items=@(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -in @('claude','codex') } | Select-Object @{Name='ProcessId';Expression={$_.Id}},ProcessName); ConvertTo-Json -InputObject @{ok=$true;processes=$items} -Compress } catch { exit 1 }";
  const result = await execute('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
  });
  if (result.stderr.trim())
    throw new Error('Process snapshot returned stderr; evidence is invalid');
  const data = JSON.parse(result.stdout);
  if (data.ok !== true || !Array.isArray(data.processes))
    throw new Error('Process snapshot did not confirm successful enumeration');
  return data.processes;
};

const report = {
  directory,
  measuredAt: new Date().toISOString(),
  node: process.version,
  snapshotSource: 'Get-Process with successful enumeration sentinel',
  codex: await new CodexHarness().preflight(),
  lifetime: [],
};
const codexCli = bundledCli();
if (process.platform === 'win32' && codexCli) {
  report.codexCli = codexCli;
  for (const mode of ['complete', 'timeout']) {
    const before = await snapshot();
    const outcome = await runCli(
      { ...codexCli, cwd: directory },
      ['exec', '--help'],
      mode === 'timeout' ? 1 : 15000,
    );
    const after = await snapshot();
    report.lifetime.push({
      harness: 'codex',
      mode,
      before,
      after,
      outcome: { code: outcome.code, spawnError: Boolean(outcome.spawnError) },
      newProcesses: after.filter((p) => !before.some((b) => b.ProcessId === p.ProcessId)),
    });
  }
}
report.codexProbeCancellation =
  'No cancellation interface on the Codex readiness runner; no turn started.';
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
