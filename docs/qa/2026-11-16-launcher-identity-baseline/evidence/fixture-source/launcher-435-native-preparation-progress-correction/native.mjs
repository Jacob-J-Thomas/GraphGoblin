import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';

export async function bounded(label, work, ms) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' exceeded ' + ms + ' ms')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export async function observe(label, read, ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    await pause(150);
  }
  throw new Error('Did not observe ' + label);
}

export function createNative(scratch, records) {
  assert.ok(isAbsolute(systemRoot));
  const env = {
    SystemRoot: systemRoot, WINDIR: systemRoot,
    PATH: [join(systemRoot, 'System32'), systemRoot].join(';'),
    TEMP: scratch, TMP: scratch,
  };
  const powerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  async function run(label, executable, args, cwd, {
    childEnv = env, timeout = 18_000, reapReadOnly = false, input,
  } = {}) {
    assert.ok(isAbsolute(executable));
    assert.ok(isAbsolute(cwd));
    const record = { label, executable, args, cwd, requestedUtc: new Date().toISOString() };
    records.push(record);
    const receiptPrefix = join(scratch, 'process-' + String(records.length).padStart(3, '0'));
    await writeFile(receiptPrefix + '-attempt.json', JSON.stringify(record) + '\n', { flag: 'wx' });
    const stdout = [];
    const stderr = [];
    const cap = 256 * 1024;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const child = spawn(executable, args, {
      cwd, env: childEnv, shell: false, windowsHide: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    record.pid = child.pid;
    const closed = Promise.withResolvers();
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= cap) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= cap) stderr.push(chunk);
    });
    child.on('error', (error) => { record.spawnError = error; });
    child.once('exit', (code, signal) => { record.exit = { code, signal }; });
    child.once('close', (code, signal) => {
      record.close = { code, signal };
      closed.resolve();
    });
    if (input !== undefined) {
      child.stdin.on('error', (error) => { record.inputError = error; });
      child.stdin.end(input, 'ascii');
    }
    try {
      await writeFile(receiptPrefix + '-spawn.json', JSON.stringify(record) + '\n', { flag: 'wx' });
      await bounded(label, closed.promise, timeout);
    } catch (error) {
      record.timeout = error.message;
      if (reapReadOnly && child.exitCode === null && child.signalCode === null) {
        record.terminationRequested = child.kill();
        await bounded(label + ' helper close', closed.promise, 2000).catch((e) => { record.reapError = e; });
      }
      throw error;
    } finally {
      record.stdout = Buffer.concat(stdout).toString('utf8');
      record.stderr = Buffer.concat(stderr).toString('utf8');
      record.stdoutBytes = stdoutBytes;
      record.stderrBytes = stderrBytes;
      await writeFile(receiptPrefix + '-outcome.json', JSON.stringify(record, (_key, value) =>
        value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value, 2) + '\n',
      { flag: 'wx' });
    }
    assert.equal(record.spawnError, undefined);
    assert.equal(record.inputError, undefined);
    assert.ok(stdoutBytes <= cap && stderrBytes <= cap, label + ' evidence exceeded capture limit');
    assert.deepEqual(record.exit, record.close);
    assert.equal(record.exit.signal, null);
    return record;
  }

  async function runPowerShell(label, source, options = {}) {
    const encoded = Buffer.from(source, 'utf16le').toString('base64');
    const output = await run(label, powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-EncodedCommand', encoded], scratch, {
      childEnv: { ...env, ...options.extraEnv }, timeout: 9000, reapReadOnly: true, input: options.input,
    });
    assert.equal(output.exit.code, 0, label + ': ' + output.stderr);
    assert.equal(output.stderr, '');
    return output;
  }

  async function cim(pid) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const output = await runPowerShell('Win32_Process exact PID ' + pid, String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$qaPid = [int]::Parse($env:QA435_PID)
$qaRow = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $qaPid) -OperationTimeoutSec 4
if ($null -eq $qaRow) { [Console]::WriteLine('e30='); return }
if (!$qaRow.CreationDate -or !$qaRow.ExecutablePath -or !$qaRow.CommandLine) { throw 'Incomplete Windows process identity' }
$qaJson = [ordered]@{
  pid = [int]$qaRow.ProcessId
  parentPid = [int]$qaRow.ParentProcessId
  executable = $qaRow.ExecutablePath
  commandLine = $qaRow.CommandLine
  creationUtc = $qaRow.CreationDate.ToUniversalTime().ToString('o')
  creationFileTime = $qaRow.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
} | ConvertTo-Json -Compress
[Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($qaJson)))
`, { extraEnv: { QA435_PID: String(pid) } });
    // The system PowerShell console code page may be unable to represent an alias path.
    const encoded = output.stdout.trim();
    assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/);
    const bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.toString('base64'), encoded);
    const result = JSON.parse(bytes.toString('utf8'));
    if (result.pid !== undefined) {
      assert.equal(result.pid, pid);
      assert.match(result.creationFileTime, /^[1-9][0-9]{16,18}$/);
    }
    return result;
  }

  async function closeStore(evidenceDir, store, cleanup) {
    const ownedNames = ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm', 'master.key'];
    async function select() {
      assert.equal(await realpath(evidenceDir), evidenceDir);
      assert.equal(await realpath(store), store);
      assert.equal(dirname(store), evidenceDir);
      const files = [];
      for (const name of (await readdir(store)).sort()) {
        assert.ok(ownedNames.includes(name), 'unexpected store entry: ' + name);
        const file = join(store, name);
        const stat = await lstat(file);
        assert.ok(stat.isFile() && !stat.isSymbolicLink());
        assert.equal(await realpath(file), file);
        files.push(file);
      }
      return files;
    }
    const files = await select();
    cleanup.before = files;
    if (files.length) {
      const probe = await runPowerShell('exclusive owned store files', String.raw`
$ErrorActionPreference = 'Stop'
$qaHandles = [Collections.Generic.List[IO.FileStream]]::new()
try {
  while ($null -ne ($qaLine = [Console]::In.ReadLine())) {
    $qaFile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($qaLine))
    if ([IO.File]::GetAttributes($qaFile) -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint)) {
      throw 'Expected regular store file'
    }
    $qaHandles.Add([IO.File]::Open($qaFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None))
  }
} finally {
  foreach ($qaHandle in $qaHandles) { $qaHandle.Dispose() }
}
[Console]::WriteLine('qa-exclusive-open-ok ' + $qaHandles.Count)
`, { input: files.map((file) => Buffer.from(file, 'utf8').toString('base64')).join('\n') + '\n' });
      assert.equal(probe.stdout.trim(), 'qa-exclusive-open-ok ' + files.length);
      cleanup.probePid = probe.pid;
      assert.deepEqual(await select(), files);
      for (const file of files) await unlink(file);
    }
    assert.deepEqual(await readdir(store), []);
    cleanup.empty = true;
  }
  return { env, run, cim, closeStore };
}

export function checkPort(port) {
  assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536 && ![4747, 4748].includes(port));
}

export async function selectPort() {
  const server = createServer();
  const port = await bounded('own temporary IPv4 port assignment', new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close((error) => error ? reject(error) : resolve(value));
    });
  }), 4000);
  checkPort(port);
  return port;
}

export async function refused(port) {
  checkPort(port);
  return bounded('exact owned candidate port state', new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
    socket.setTimeout(2400, () => { socket.destroy(); reject(new Error('Loopback port status is ambiguous')); });
  }), 2800);
}
