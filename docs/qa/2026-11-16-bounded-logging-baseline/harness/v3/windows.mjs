import assert from 'node:assert/strict';
import { lstat, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { under } from './binding.mjs';

function encoded(value) { return Buffer.from(value, 'utf8').toString('base64'); }

function powershell(native, cwd, label, source, inputs, timeout) {
  return native.run(label, join(native.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64')], cwd,
    { timeout, reapReadOnly: true, input: inputs.map(encoded).join('\n') + '\n' });
}

const inputHelper = String.raw`
$ErrorActionPreference = 'Stop'
function ReadFixturePath {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { return }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
}
`;

export async function confirmOwnedCleanup(native, disposable, stores, evidence) {
  const files = [];
  async function inventory(path) {
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)), path);
    assert.equal(await realpath(path), path);
    files.push(path);
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await inventory(under(path, name));
    }
  }
  await inventory(disposable);
  const storeFiles = [];
  for (const store of stores) {
    for (const name of ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm']) {
      const full = under(store, name);
      if (files.includes(full)) storeFiles.push(full);
    }
  }
  const report = await powershell(native, evidence, 'owned no-reparse and SQLite exclusive handles',
    inputHelper + String.raw`
$checks = 0
$handles = [Collections.Generic.List[IO.FileStream]]::new()
try {
  while ($null -ne ($item = ReadFixturePath)) {
    $isStore = $item.StartsWith('sqlite:')
    $path = $item.Substring($item.IndexOf(':') + 1)
    $attributes = [IO.File]::GetAttributes($path)
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe owned cleanup entry' }
    if ($isStore) {
      if ($attributes -band [IO.FileAttributes]::Directory) { throw 'Unexpected SQLite directory' }
      $handles.Add([IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None))
    }
    $checks++
  }
  [Console]::WriteLine('qa438-exclusive ' + $checks + ' ' + $handles.Count)
} finally {
  foreach ($handle in $handles) { $handle.Dispose() }
}
`, files.map((file) => (storeFiles.includes(file) ? 'sqlite:' : 'ordinary:') + file), 10_000);
  assert.equal(report.exit.code, 0, report.stderr);
  assert.equal(report.stdout.trim(), 'qa438-exclusive ' + files.length + ' ' + storeFiles.length);
  return { entries: files.length, exclusiveStoreFiles: storeFiles, probePid: report.pid };
}

export async function confirmLauncherChildrenAbsent(native, evidence, pids) {
  assert(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
  if (pids.length === 0) return { parentPids: [], rows: [] };
  const report = await powershell(native, evidence, 'census of exact recorded launcher parent PIDs',
    inputHelper + String.raw`
$conditions = @()
while ($null -ne ($line = ReadFixturePath)) {
  $conditions += 'ParentProcessId = ' + [UInt32]::Parse($line)
}
$rows = @(Get-CimInstance Win32_Process -Filter ($conditions -join ' OR ') -OperationTimeoutSec 6)
foreach ($row in $rows) {
  [Console]::WriteLine([string]$row.ParentProcessId + ':' + [string]$row.ProcessId)
}
`, pids.map(String), 9000);
  assert.equal(report.exit.code, 0, report.stderr);
  return { parentPids: pids, rows: report.stdout.trim().split(/\r?\n/u).filter(Boolean), probePid: report.pid };
}

export async function withReadSharingDenial(native, evidence, path, marker, release, observe, work) {
  const holder = powershell(native, evidence, 'native launcher log write/delete sharing denial',
    inputHelper + String.raw`
$path = ReadFixturePath
$marker = ReadFixturePath
$release = ReadFixturePath
$handle = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText($marker, 'exclusive against writes and deletes')
  $expiry = [DateTime]::UtcNow.AddSeconds(75)
  while (![IO.File]::Exists($release)) {
    if ([DateTime]::UtcNow -ge $expiry) { throw 'No owned fault release marker' }
    Start-Sleep -Milliseconds 80
  }
} finally { $handle.Dispose() }
`, [path, marker, release], 82_000);
  const exit = holder.then((value) => ({ value }), (error) => ({ error }));
  let error;
  let result;
  try {
    await observe('native sharing denial ready', async () => {
      try { return (await lstat(marker)).isFile(); } catch (failure) {
        if (failure.code === 'ENOENT') return false;
        throw failure;
      }
    }, 9000);
    result = await work();
  } catch (failure) { error = failure; }
  finally { await writeFile(release, 'release\n', { flag: 'wx' }); }
  const final = await exit;
  if (error) throw error;
  if (final.error) throw final.error;
  assert.equal(final.value.exit.code, 0, final.value.stderr);
  return result;
}
