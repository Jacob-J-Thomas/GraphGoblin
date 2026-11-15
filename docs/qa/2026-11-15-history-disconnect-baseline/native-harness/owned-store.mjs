import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { bounded } from './transport.mjs';

const ownedNames = ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm'];
const program = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
$qaHandles = [Collections.Generic.List[IO.FileStream]]::new()
try {
  while ($null -ne ($qaLine = [Console]::In.ReadLine())) {
    $qaFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($qaLine))
    $qaAttributes = [IO.File]::GetAttributes($qaFile)
    if ($qaAttributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) {
      throw "Exclusive-open target must be a regular file: $qaFile"
    }
    $qaHandles.Add([IO.File]::Open($qaFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None))
  }
} finally {
  foreach ($qaHandle in $qaHandles) { $qaHandle.Dispose() }
}
[Console]::Out.WriteLine('qa-exclusive-open-ok ' + $qaHandles.Count)
`, 'utf16le').toString('base64');

async function inventory(evidenceDir, storeDir) {
  assert.equal(await realpath(evidenceDir), evidenceDir);
  assert.equal(await realpath(storeDir), storeDir);
  assert.equal(dirname(storeDir), evidenceDir);
  const paths = [];
  for (const name of (await readdir(storeDir)).sort()) {
    assert.ok(ownedNames.includes(name), 'unexpected owned-store entry: ' + name);
    const path = join(storeDir, name);
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(path), path);
    paths.push(path);
  }
  return paths;
}

export async function cleanOwnedStore(evidenceDir, storeDir, receipt, ownChild) {
  // Mirror the reviewed #381 cleanup. No sharing-check retry or force-remove.
  globalThis.gc();
  await setImmediate();
  globalThis.gc();
  await setImmediate();
  receipt.collectionPasses = 2;
  const files = await inventory(evidenceDir, storeDir);
  assert.ok(files.includes(join(storeDir, 'graphgoblin.db')));
  receipt.files = files;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  assert.ok(isAbsolute(systemRoot));
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const requestedAt = new Date().toISOString();
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', program], {
    cwd: storeDir, env: { SystemRoot: systemRoot }, shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = Promise.withResolvers();
  ownChild(child);
  const probe = { pid: child.pid, requestedAt, executable, stdout: '', stderr: '' };
  receipt.probe = probe;
  child.once('error', (error) => { probe.error = error; });
  child.once('exit', (code, signal) => { probe.exit = { code, signal }; });
  child.once('close', (code, signal) => {
    probe.close = { code, signal };
    ownChild(undefined);
    closed.resolve();
  });
  child.stdout.setEncoding('utf8').on('data', (data) => { probe.stdout = (probe.stdout + data).slice(0, 4096); });
  child.stderr.setEncoding('utf8').on('data', (data) => { probe.stderr = (probe.stderr + data).slice(0, 4096); });
  child.stdin.on('error', (error) => { probe.stdinError = error; });
  child.stdin.end(files.map((file) => Buffer.from(file, 'utf8').toString('base64')).join('\n') + '\n', 'ascii');
  try {
    await bounded('exclusive Windows SQLite open', closed.promise, 8_000);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    try {
      await bounded('exclusive-open helper exit', closed.promise, 2_000);
    } catch (cleanupError) {
      probe.cleanupError = cleanupError;
    }
    throw error;
  }
  assert.deepEqual(probe.exit, { code: 0, signal: null });
  assert.deepEqual(probe.close, probe.exit);
  assert.equal(probe.error, undefined);
  assert.equal(probe.stdinError, undefined);
  assert.equal(probe.stderr, '');
  assert.equal(probe.stdout.trim(), 'qa-exclusive-open-ok ' + files.length);
  assert.deepEqual(await inventory(evidenceDir, storeDir), files);
  for (const file of files) await unlink(file);
  assert.deepEqual(await readdir(storeDir), []);
  receipt.empty = true;
}
