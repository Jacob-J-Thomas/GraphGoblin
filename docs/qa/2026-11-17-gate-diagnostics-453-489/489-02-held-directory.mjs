import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

assert.equal(process.platform, 'win32');
assert.equal(process.version, 'v22.23.4');
const { statEntry, identityOf } = await import(pathToFileURL(join(process.cwd(), 'apps/api/src/reset/tree.ts')));
const ps = await readFile(new URL('./489-02-hold-dir.ps1', import.meta.url), 'utf8');
const temp = await realpath(tmpdir());
const base = await mkdtemp(join(temp, 'gg-wp-b3-rid-tree-'));
const source = join(base, 'data');
const target = join(base, 'original');
const outside = join(base, 'outside');
const file = 'graphgoblin.db';
const receipt = {
  kind: 'Controlled mechanism witness, with a deliberately held Windows directory handle',
  node: process.version,
  cwd: process.cwd(),
  source,
  target,
  outside,
  started: new Date().toISOString(),
};

function errorRecord(error) {
  return Object.fromEntries(['name', 'code', 'errno', 'syscall', 'path', 'dest', 'message']
    .filter((field) => error[field] !== undefined)
    .map((field) => [field, error[field]]));
}

try {
  assert.equal(dirname(base), temp);
  assert.ok(basename(base).startsWith('gg-wp-b3-rid-tree-'));
  await mkdir(source);
  await mkdir(outside);
  await writeFile(join(source, file), 'planned bytes');
  await writeFile(join(outside, file), 'outside bytes');
  receipt.before = {
    base: await identityOf(base),
    source: await identityOf(source),
    target: (await identityOf(target)) ?? null,
    outside: await identityOf(outside),
    planned: await statEntry(source, file),
  };
  assert.equal(receipt.before.target, null);
  const holder = spawn(
    join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20_000,
      env: { ...process.env, GG_DIAG_489_OWNED_DIR: source },
    },
  );
  const closed = new Promise((resolve) => {
    holder.once('close', (code, signal) => resolve({ code, signal }));
  });
  holder.stdin.on('error', (error) => { receipt.holderStdinError = error.code; });
  holder.once('error', (error) => { receipt.holderSpawnError = errorRecord(error); });
  holder.stderr.setEncoding('utf8').on('data', (data) => {
    receipt.holderStderr = ((receipt.holderStderr ?? '') + data).slice(0, 1500);
  });
  const lines = createInterface({ input: holder.stdout, crlfDelay: Infinity });
  const commands = [];
  lines.on('line', (line) => commands.push(line));
  try {
    const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(12_000) });
    assert.equal(line, 'held:' + holder.pid);
    receipt.holder = { pid: holder.pid, desiredAccess: 'FILE_READ_ATTRIBUTES', shareMode: ['READ', 'WRITE'] };
    const start = performance.now();
    try {
      await rename(source, target);
      receipt.operation = { outcome: 'renamed' };
    } catch (error) {
      receipt.operation = { outcome: 'rejected', error: errorRecord(error) };
    }
    receipt.operation.elapsedMs = performance.now() - start;
    receipt.after = {
      source: (await identityOf(source)) ?? null,
      target: (await identityOf(target)) ?? null,
      outside: await identityOf(outside),
    };
  } finally {
    holder.stdin.end('release\n');
    receipt.holderExit = await closed;
    receipt.holderProtocol = commands;
    lines.close();
  }
  assert.deepEqual(receipt.holderExit, { code: 0, signal: null });
  assert.deepEqual(receipt.holderProtocol, ['held:' + receipt.holder.pid, 'released:' + receipt.holder.pid]);
  assert.equal(receipt.after.outside, receipt.before.outside);
  assert.equal(receipt.after.source ?? receipt.after.target, receipt.before.source);
} catch (error) {
  receipt.probeError = errorRecord(error);
  process.exitCode = 1;
} finally {
  try {
    assert.equal(await realpath(base), base);
    assert.equal(dirname(base), temp);
    assert.equal(await identityOf(base), receipt.before?.base);
    for (const directory of [source, target, outside]) {
      const identity = await identityOf(directory);
      if (identity === undefined) continue;
      assert.equal(await realpath(directory), directory);
      assert.equal(dirname(directory), base);
      assert.equal(identity, directory === outside ? receipt.before.outside : receipt.before.source);
      const path = join(directory, file);
      const stats = await lstat(path);
      assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1);
      await unlink(path);
      await rmdir(directory);
    }
    await rmdir(base);
    receipt.removedOnlyOwnedPaths = true;
  } catch (error) {
    receipt.cleanupError = errorRecord(error);
    process.exitCode = 1;
  }
  receipt.completed = new Date().toISOString();
  console.log(JSON.stringify(receipt, null, 2));
}
