import process from 'node:process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import { ClaudeHarness } from '../dist/claude/harness.js';
import { runClaudeProcess } from '../dist/claude/process.js';
import { subscriptionEnvironment } from '../dist/claude/environment.js';
const directory = await mkdtemp(join(tmpdir(), 'gg-readiness-native-claude-'));
const binary = join(homedir(), '.local', 'bin', 'claude.exe');
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
  claude: {},
  lifetime: [],
};
if (process.platform !== 'win32' || !existsSync(binary))
  report.claude = { skipped: 'Native Windows Claude binary missing' };
else {
  report.claude = await new ClaudeHarness({ binary }).preflight();
  for (const mode of ['complete', 'timeout', 'cancel']) {
    const before = await snapshot();
    const controller = new globalThis.AbortController();
    const result = runClaudeProcess({
      binary,
      args: ['--help'],
      cwd: directory,
      env: subscriptionEnvironment(),
      signal: controller.signal,
      timeoutMs: mode === 'timeout' ? 1 : 15000,
      maxOutputBytes: 128 * 1024,
    });
    const timer = mode === 'cancel' ? setTimeout(() => controller.abort(), 1) : undefined;
    const outcome = await result;
    clearTimeout(timer);
    const after = await snapshot();
    report.lifetime.push({
      harness: 'claude',
      mode,
      before,
      after,
      outcome: {
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        aborted: outcome.aborted,
        terminationUnconfirmed: outcome.terminationUnconfirmed ?? false,
      },
      newProcesses: after.filter((p) => !before.some((b) => b.ProcessId === p.ProcessId)),
    });
  }
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
