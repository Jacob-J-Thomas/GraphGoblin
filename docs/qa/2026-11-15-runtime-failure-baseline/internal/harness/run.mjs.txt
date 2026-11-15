import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases, localScript } from './cases.mjs';

const suiteRoot = await realpath(dirname(fileURLToPath(import.meta.url)));
const [phase, checkoutInput, evidenceName, retainOption, ...extra] = process.argv.slice(2);
assert.ok(['baseline', 'candidate'].includes(phase));
assert.match(evidenceName ?? '', /^evidence-(baseline|candidate)-[a-z0-9-]{3,48}$/);
assert.ok(evidenceName.startsWith('evidence-' + phase + '-'));
assert.ok(retainOption === undefined || retainOption === '--retain-unexpected-repair-for-a5');
assert.equal(extra.length, 0);
assert.equal(process.platform, 'win32');
const [major, minor, patch] = process.versions.node.split('.').map(Number);
assert.ok(major === 22 && (minor > 22 || (minor === 22 && patch >= 2)));
assert.deepEqual(process.execArgv, ['--expose-gc'], 'only the cleanup GC flag is permitted');
assert.equal(typeof globalThis.gc, 'function');
assert.equal(process.env.NODE_OPTIONS, undefined, 'use the clean admitted environment');
const checkout = await realpath(resolve(checkoutInput));
const profileRoot = resolve(suiteRoot, '..', '..', '..');
const worktreeRoot = await realpath(join(profileRoot, '.codex', 'worktrees'));
const projectNode = await realpath(join(profileRoot, '.claude', 'codex-runs', 'GraphGoblin',
  'runtime', 'node-v22.23.4-win-x64', 'node.exe'));
assert.equal(await realpath(process.execPath), projectNode);
const checkoutRelative = relative(worktreeRoot, checkout);
assert.match(checkoutRelative, /^gg-[^\\/]+[\\/]GraphGoblin$/i, 'use an isolated GraphGoblin worktree');
const inputs = [
  ['contracts', 'contracts', '.'],
  ['engine', 'engine', '.'],
  ['testing', 'engine', './testing'],
  ['sqlite', 'infrastructure', './sqlite'],
  ['process', 'infrastructure', './process'],
];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// Resolve the built import condition declared by each public package export. The explicit
// path keeps the standalone harness out of the checkout and binds dependency resolution there.
const runtime = {};
const bindings = {};
for (const [key, pkg, entry] of inputs) {
  const packageRoot = join(checkout, 'packages', pkg);
  const { name, exports } = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(name, '@graphgoblin/' + pkg);
  const target = exports[entry].import;
  assert.match(target, /^\.\/dist\/(?:[a-z-]+\/)*index\.js$/);
  const file = await realpath(resolve(packageRoot, target));
  assert.equal(relative(packageRoot, file).replaceAll('\\', '/'), target.slice(2));
  bindings[key] = { name, entry, file, sha256: sha256(await readFile(file)) };
}

const evidenceDir = join(suiteRoot, evidenceName);
await mkdir(evidenceDir);
assert.equal(await realpath(evidenceDir), evidenceDir);
const save = (file, value) =>
  writeFile(join(evidenceDir, file), JSON.stringify(value, diagnosticJson, 2) + '\n', { flag: 'wx' });
const owner = { kind: 'user', id: 'local' };
const ownedChildren = new Map();
const ownedNames = ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm'];
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
assert.ok(isAbsolute(systemRoot));
const exclusiveOpenCommand = Buffer.from(String.raw`
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
let pendingCleanup = false;
// Finite asynchronous failure handling is first evidence. A host-level native stall needs the
// separately admitted process owner to terminate this exact runner if its event loop cannot run.
const watchdog = setTimeout(() => {
  for (const child of ownedChildren.values()) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.stderr.write('A3/A4 runner watchdog expired. Retain the incomplete owned evidence directory.\n');
  process.exit(124);
}, 110_000);

function diagnosticJson(_key, value) {
  if (value instanceof Error) {
    return { ...value, name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function spawnOwned(executable, args, options) {
  const spawnRequestedAt = new Date().toISOString();
  const child = spawn(executable, args, options);
  const entry = { pid: child.pid, spawnRequestedAt, executable, args, cwd: options.cwd };
  const closed = Promise.withResolvers();
  if (child.pid !== undefined) ownedChildren.set(child.pid, child);
  child.on('exit', (code, signal) => Object.assign(entry, { exit: { code, signal } }));
  child.on('close', (code, signal) => {
    entry.close = { code, signal };
    ownedChildren.delete(child.pid);
    closed.resolve();
  });
  child.on('error', (error) => {
    entry.error = error;
  });
  return { child, entry, closed: closed.promise };
}

function localSpawn(caseDir, processLog, executable, args, options) {
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, localScript);
  assert.equal(options.cwd, caseDir);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.deepEqual(options.env, { SystemRoot: systemRoot });
  const { child, entry } = spawnOwned(executable, args, options);
  processLog.push(entry);
  return child;
}

export function delegate(port, changes) {
  return new Proxy(port, {
    get(target, key) {
      if (Object.hasOwn(changes, key)) return changes[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function bounded(label, work, ms = 8_000) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' did not settle within ' + ms + ' ms')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function ownedStoreFiles(caseDir) {
  assert.equal(await realpath(caseDir), caseDir);
  assert.equal(dirname(caseDir), evidenceDir);
  assert.equal(await realpath(evidenceDir), evidenceDir);
  const files = [];
  for (const name of (await readdir(caseDir)).sort()) {
    assert.ok(ownedNames.includes(name), 'unexpected case-store entry: ' + name);
    const file = join(caseDir, name);
    const stat = await lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(file), file);
    files.push(file);
  }
  return files;
}

async function exclusiveOpen(caseDir, files, store) {
  const systemPowerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', exclusiveOpenCommand];
  const { child, entry, closed } = spawnOwned(systemPowerShell, args, {
    cwd: caseDir, env: { SystemRoot: systemRoot }, stdio: ['pipe', 'pipe', 'pipe'],
    shell: false, windowsHide: true,
  });
  store.exclusiveProbe = { process: entry, files, stdout: '', stderr: '' };
  const probe = store.exclusiveProbe;
  child.stdout.setEncoding('utf8').on('data', (data) => { probe.stdout = (probe.stdout + data).slice(0, 4096); });
  child.stderr.setEncoding('utf8').on('data', (data) => { probe.stderr = (probe.stderr + data).slice(0, 4096); });
  child.stdin.on('error', (error) => { probe.stdinError = error; });
  child.stdin.end(files.map((file) => Buffer.from(file, 'utf8').toString('base64')).join('\n') + '\n', 'ascii');
  try {
    await bounded('exclusive Windows SQLite file open', closed, 8_000);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    try {
      await bounded('exclusive-open helper exit', closed, 2_000);
    } catch (cleanupError) {
      probe.cleanupError = cleanupError;
      pendingCleanup = true;
    }
    throw error;
  }
  assert.deepEqual(entry.exit, { code: 0, signal: null });
  assert.deepEqual(entry.close, entry.exit);
  assert.equal(entry.error, undefined);
  assert.equal(probe.stdinError, undefined);
  assert.equal(probe.stderr, '');
  assert.equal(probe.stdout.trim(), 'qa-exclusive-open-ok ' + files.length);
}

async function cleanStore(caseDir, provedFiles) {
  assert.deepEqual(await ownedStoreFiles(caseDir), provedFiles);
  for (const file of provedFiles) await unlink(file);
  assert.deepEqual(await readdir(caseDir), []);
}

async function runCase(name, scenario) {
  const caseDir = join(evidenceDir, name);
  await mkdir(caseDir);
  assert.equal(await realpath(caseDir), caseDir);
  const dbFile = join(caseDir, 'graphgoblin.db');
  const {
    openDatabase, SqliteRunRepository, SqliteEventStore, SqliteLoopRepository,
    SqliteSessionRepository, SqliteTriggerAdmission,
  } = runtime.sqlite;
  const db = openDatabase({ url: pathToFileURL(dbFile).href });
  const fake = runtime.testing.createFakePorts();
  const runs = new SqliteRunRepository(db.db);
  const events = new SqliteEventStore(db.db, fake.clock);
  const loops = new SqliteLoopRepository(db.db, fake.clock, fake.ids);
  const sessions = new SqliteSessionRepository(db.db);
  const report = { name, phase, processLog: [], observations: {}, knownRuns: [], result: 'incomplete' };
  let manager;
  let failure;
  let safelyIdle = false;
  const baseEnv = { SystemRoot: systemRoot };
  const scripts = new runtime.process.ProcessScripts({
    baseEnv,
    maxOutputBytes: 8192,
    spawnImpl: (...args) => localSpawn(caseDir, report.processLog, ...args),
  });
  const defaultPorts = {
    ...fake,
    runs, events, loops, sessions, scripts,
    admission: new SqliteTriggerAdmission(db.db, events),
    workspace: delegate(fake.workspace, { resolve: async () => caseDir }),
  };

  async function raw(runId) {
    const rows = await db.client.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [runId] });
    assert.equal(rows.rows.length, 1);
    const eventRows = await db.client.execute({
      sql: 'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq',
      args: [runId],
    });
    return { run: { ...rows.rows[0] }, events: eventRows.rows.map((row) => ({ ...row })) };
  }

  async function startManager(overrides = {}) {
    assert.equal(manager, undefined, 'stop the idle manager before restarting');
    manager = new runtime.engine.RunManager(
      { ...defaultPorts, ...overrides }, runtime.testing.DEFAULT_TEST_SETTINGS,
    );
    await bounded('manager startup', manager.start());
    return manager;
  }

  async function idle() {
    await bounded('manager idle', manager.waitForIdle());
  }

  async function stopManager() {
    if (!manager) return;
    await idle();
    manager.stop();
    manager = undefined;
  }

  async function publish(definition) {
    const parsed = runtime.contracts.LoopDefinitionSchema.parse(definition);
    const { loop } = await loops.create('local', parsed);
    await loops.publish(loop.id);
    return loop.id;
  }

  async function start(loopId) {
    const run = await bounded('run admission', manager.startRun({
      ownerId: 'local', loopId, source: 'manual.api',
    }));
    report.knownRuns.push(run.id);
    return run.id;
  }

  async function snapshot(key, id) {
    if (!report.knownRuns.includes(id)) report.knownRuns.push(id);
    const observation = { raw: await raw(id) };
    report.observations[key] = observation;
    observation.snapshot = await manager.getSnapshot(id);
    observation.events = await events.read(id);
    observation.sessions = await sessions.listForRun(id);
    return observation;
  }

  try {
    await bounded('disposable migration', db.migrate(), 15_000);
    await bounded(name, scenario({
      phase, caseDir, runtime, fake, runs, events, sessions, owner, startManager, stopManager,
      idle, publish, start, snapshot, raw, report, delegate, bounded, setImmediate,
    }), 25_000);
    await stopManager();
    safelyIdle = true;
    assert.ok(report.processLog.every((process) => process.close && process.exit));
    report.result = 'assertions-met';
  } catch (error) {
    report.error = error;
    failure = error;
  } finally {
    if (manager) {
      manager.stop();
      try {
        await idle();
        safelyIdle = true;
      } catch (cleanupError) {
        report.managerCleanupError = cleanupError;
        failure ??= cleanupError;
        pendingCleanup = true;
      }
    }
    for (const child of ownedChildren.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    if (ownedChildren.size > 0) pendingCleanup = true;
    let databaseClosed = false;
    if (safelyIdle || !manager) {
      try {
        db.close();
        databaseClosed = true;
      } catch (cleanupError) {
        report.databaseCloseError = cleanupError;
        failure ??= cleanupError;
        pendingCleanup = true;
      }
    }
    report.store = {
      dir: caseDir, database: dbFile, closed: databaseClosed, retainForA5: false,
    };
    if (!failure && safelyIdle && databaseClosed) {
      try {
        // Native libsql statements can hold Windows handles after DatabaseHandle.close().
        // Collect before the single sharing check. A sharing violation is first evidence.
        globalThis.gc();
        await setImmediate();
        globalThis.gc();
        await setImmediate();
        report.store.collectionPasses = 2;
        const files = await ownedStoreFiles(caseDir);
        assert.ok(files.includes(dbFile), 'the exact SQLite database must be present after close');
        const retainForA5 = name === 'unexpected-repair' && retainOption !== undefined;
        if (retainForA5) assert.deepEqual(files, [dbFile]);
        await exclusiveOpen(caseDir, files, report.store);
        if (retainForA5) {
          report.store.databaseSha256 = sha256(await readFile(dbFile));
          assert.deepEqual(await ownedStoreFiles(caseDir), [dbFile]);
          report.store.terminalRunId = report.observations.terminal.snapshot.id;
          report.store.retainForA5 = true;
        } else {
          await cleanStore(caseDir, files);
          report.store.empty = true;
        }
      } catch (error) {
        report.cleanupError = error;
        failure = error;
      }
    }
    report.store.remaining = await readdir(caseDir);
    if (failure && report.result === 'assertions-met') report.result = 'cleanup-failed';
    await save(name + '.private.json', fake.logger.lines);
    await save(name + '.json', report);
  }
  if (failure) throw failure;
  return { name, result: report.result, store: report.store };
}

const summary = {
  phase, checkout, bindings, evidenceDir,
  tier: 'compiled engine with file SQLite; case-specific controlled ports and native Node child',
  runner: { pid: process.pid, executable: process.execPath, node: process.version },
  listeners: [],
  results: [],
};
await save('runner.json', summary);
try {
  for (const [key, { file }] of Object.entries(bindings))
    runtime[key] = await import(pathToFileURL(file).href);
  for (const [name, scenario] of Object.entries(cases)) {
    assert.equal(basename(name), name);
    summary.results.push(await runCase(name, scenario));
  }
} catch (error) {
  summary.error = error;
  process.exitCode = 1;
} finally {
  await save('summary.json', summary);
  if (!pendingCleanup) clearTimeout(watchdog);
}
