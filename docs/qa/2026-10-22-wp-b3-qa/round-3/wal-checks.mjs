// Independent QA only. Run from the checkout with Node 22 after pnpm.cmd build.
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, copyFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const repo = process.cwd();
const evidence = resolve('docs/qa/2026-10-22-wp-b3-qa/round-3');
const self = fileURLToPath(import.meta.url);
const sqliteUrl = pathToFileURL(resolve('packages/infrastructure/dist/sqlite/index.js')).href;
const main = resolve('apps/api/dist/main.js');
const names = ['graphgoblin.db', 'graphgoblin.db-wal', 'graphgoblin.db-shm'];
const [mode, ...workerArgs] = process.argv.slice(2);

if (mode === '--seed') {
  const [source, target, kind] = workerArgs;
  const { openDatabase, SqliteModelCatalog } = await import(sqliteUrl);
  const handle = openDatabase({ url: pathToFileURL(join(source, names[0])).href });
  await handle.migrate();
  await new SqliteModelCatalog(handle.db).seed();
  await handle.client.execute('PRAGMA wal_autocheckpoint = 0');
  await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  const ledgerBefore = (
    await handle.client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')
  ).rows[0].n;
  const mutation =
    kind === 'truncated-ledger'
      ? 'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)'
      : kind === 'format-3'
        ? 'UPDATE gg_upgrade_state SET format_version = 3'
        : "UPDATE model_catalog SET display_name = 'Independent QA WAL catalog entry' WHERE harness = 'codex' AND model = 'gpt-6-luna'";
  const changed = await handle.client.execute(mutation);
  const ledgerAfter = (
    await handle.client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')
  ).rows[0].n;
  const format = (await handle.client.execute('SELECT format_version FROM gg_upgrade_state'))
    .rows[0].format_version;
  const pendingMigrations = await handle.pendingMigrations();
  const catalog = await new SqliteModelCatalog(handle.db).list();
  // Copy committed WAL state while the source writer remains open. The copy has no writer.
  for (const name of names) await copyFile(join(source, name), join(target, name));
  handle.close();
  process.stdout.write(
    JSON.stringify({
      kind,
      mutation,
      rowsAffected: changed.rowsAffected,
      ledgerBefore,
      ledgerAfter,
      format,
      pendingMigrations,
      catalog: catalog.map(({ harness, model, displayName }) => ({ harness, model, displayName })),
    }),
    () => process.exit(0),
  );
} else if (mode === '--guard') {
  const [dataDir] = workerArgs;
  const {
    openReadOnlyDatabaseClient,
    guardCurrentStore,
    pendingMigrationCount,
    databaseView,
    SqliteModelCatalog,
  } = await import(sqliteUrl);
  const client = openReadOnlyDatabaseClient(join(dataDir, names[0]));
  let result;
  try {
    const state = await guardCurrentStore(client);
    result = {
      accepted: true,
      state,
      pendingMigrations: await pendingMigrationCount(client),
      catalog: await new SqliteModelCatalog(databaseView(client)).list(),
    };
  } catch (error) {
    result = {
      accepted: false,
      name: error.name,
      reason: error.reason,
      foundFormat: error.foundFormat,
      requiredFormat: error.requiredFormat,
    };
  } finally {
    client.close();
  }
  process.stdout.write(JSON.stringify(result), () => process.exit(0));
} else {
  const originalTemp = tmpdir();
  const base = await mkdtemp(join(originalTemp, 'gg-qa-266-r3-wal-'));
  const workTemp = join(base, 'process-temp');
  await mkdir(workTemp);
  const slash = String.fromCharCode(92);
  function clean(input) {
    let s = input;
    for (const [a, b] of [
      [repo, '<worktree>'],
      [originalTemp, '%TEMP%'],
      [process.env.USERPROFILE, '%USERPROFILE%'],
    ]) {
      if (!a) continue;
      for (const spelling of [a.split(slash).join(slash + slash), a.split(slash).join('/'), a])
        s = s.split(spelling).join(b);
    }
    return s;
  }
  async function save(name, value) {
    await writeFile(join(evidence, name), clean(JSON.stringify(value, null, 2)) + '\n');
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GG_') && key !== 'JEV_API_KEY'),
  );
  Object.assign(env, {
    TEMP: workTemp,
    TMP: workTemp,
    GG_WEB_DIST: '',
    GG_LOG_LEVEL: 'warn',
    GG_PORT: '5651',
    GG_HOST: '127.0.0.1',
  });
  const processes = [];
  const directories = [];
  const verdicts = [];
  let active;
  async function snapshot(dir) {
    const result = {};
    for (const name of names) {
      try {
        const bytes = await readFile(join(dir, name));
        result[name] = {
          present: true,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        result[name] = { present: false };
      }
    }
    return result;
  }
  function compare(before, after) {
    return {
      allThreePresent: names.every((n) => before[n].present && after[n].present),
      databaseUnchanged: before[names[0]].sha256 === after[names[0]].sha256,
      walUnchanged: before[names[1]].sha256 === after[names[1]].sha256,
      shmChanged: before[names[2]].sha256 !== after[names[2]].sha256,
    };
  }
  async function command(label, args, dataDir, extra = {}) {
    const start = Date.now();
    const value = await new Promise((res) => {
      execFile(
        process.execPath,
        args,
        {
          env: { ...env, GG_DATA_DIR: dataDir, ...extra },
          windowsHide: true,
          timeout: 300_000,
          maxBuffer: 2_000_000,
        },
        (error, stdout, stderr) => {
          res({
            code: error?.code ?? 0,
            signal: error?.signal ?? null,
            killed: error?.killed ?? false,
            stdout,
            stderr,
            elapsedMs: Date.now() - start,
          });
        },
      );
    });
    processes.push({ label, processExited: true, code: value.code, signal: value.signal });
    return value;
  }
  async function runCheck(label, dir, args, extra) {
    const before = await snapshot(dir);
    const result = await command(label, args, dir, extra);
    const after = await snapshot(dir);
    return { result, before, after, comparison: compare(before, after) };
  }
  async function healthyStartup(dir) {
    const before = await snapshot(dir);
    const child = spawn(process.execPath, [main], {
      env: { ...env, GG_DATA_DIR: dir },
      windowsHide: true,
    });
    let stdout = '',
      stderr = '',
      closed = false;
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    const completion = new Promise((res, rej) => {
      child.once('error', rej);
      child.once('close', (code, signal) => {
        closed = true;
        res({ code, signal });
      });
    });
    active = { child, completion };
    let health, catalog;
    try {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        if (closed) throw new Error('healthy startup exited: ' + stderr);
        try {
          const response = await fetch('http://127.0.0.1:5651/healthz', {
            signal: AbortSignal.timeout(2000),
          });
          if (response.ok) {
            health = { status: response.status, body: await response.json() };
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!health) throw new Error('healthy startup health deadline exceeded');
      const response = await fetch('http://127.0.0.1:5651/model-catalog', {
        signal: AbortSignal.timeout(5000),
      });
      catalog = { status: response.status, body: await response.json() };
    } finally {
      if (!closed) child.kill();
      const exit = await completion;
      active = undefined;
      processes.push({ label: 'healthy-built-api', processExited: true, ...exit });
    }
    const after = await snapshot(dir);
    return {
      health,
      catalog,
      stdout,
      stderr,
      before,
      after,
      comparison: compare(before, after),
      note: 'A supported full startup seeds/refreshes its catalog and opens a writable connection. Byte preservation is required of its preceding read-only guard, measured separately.',
    };
  }
  try {
    const stub = join(base, 'qa-codex-readiness.mjs');
    await writeFile(
      stub,
      "// Controlled readiness fixture, never a model invocation.\nif (process.argv.includes('--version')) console.log('codex-cli 0.0.0-qa-readiness');\nelse if (process.argv.slice(2).join(' ') === 'login status') console.log('Logged in (QA readiness fixture; no provider call)');\nelse process.exit(2);\n",
    );
    for (const kind of ['truncated-ledger', 'healthy-current', 'format-3']) {
      const source = join(base, kind + '-source'),
        dir = join(base, kind);
      await mkdir(source);
      await mkdir(dir);
      directories.push(source, dir);
      const seed = await command(kind + '-seed', [self, '--seed', source, dir, kind], dir);
      if (seed.code !== 0) throw new Error('seed failed: ' + seed.stderr);
      const metadata = JSON.parse(seed.stdout);
      if (metadata.rowsAffected !== 1) throw new Error('mutation did not affect exactly one row');
      const initial = await snapshot(dir);
      if (!names.every((n) => initial[n].present) || initial[names[1]].bytes === 0)
        throw new Error('fixture lacks nonempty WAL');
      const preflight = await runCheck(kind + '-preflight', dir, [main, '--preflight']);
      let controlledPreflight;
      if (
        kind === 'healthy-current' &&
        preflight.result.code !== 0 &&
        /Harness codex.*not logged in/.test(preflight.result.stdout)
      ) {
        controlledPreflight = await runCheck(
          kind + '-preflight-controlled-codex',
          dir,
          [main, '--preflight'],
          { GG_CODEX_BINARY: stub },
        );
      }
      const guard = await runCheck(kind + '-startup-guard', dir, [self, '--guard', dir]);
      guard.value = JSON.parse(guard.result.stdout);
      const startup =
        kind === 'healthy-current'
          ? await healthyStartup(dir)
          : await runCheck(kind + '-built-startup', dir, [main]);
      const expected =
        kind === 'truncated-ledger'
          ? 'the migration ledger is behind the store structure'
          : 'The store is format 3; this build reads only format 4';
      const checks = [];
      const bytePass = (v) =>
        v.comparison.allThreePresent && v.comparison.databaseUnchanged && v.comparison.walUnchanged;
      checks.push({
        check: 'preflight preserves DB/WAL and all three files',
        pass: bytePass(preflight),
      });
      if (kind === 'healthy-current') {
        const ready = controlledPreflight ?? preflight;
        checks.push({
          check: 'healthy CLI exit 0, migrated database and stored default model',
          pass:
            ready.result.code === 0 &&
            /Database\s+reachable and migrated/.test(ready.result.stdout) &&
            /Default model\s+.*is in the model catalog/.test(ready.result.stdout),
          controlledCodexReadiness: !!controlledPreflight,
        });
        if (controlledPreflight)
          checks.push({
            check: 'controlled preflight preserves DB/WAL and all three files',
            pass: bytePass(controlledPreflight),
          });
        checks.push({
          check:
            'startup read-only guard accepts current, pending migrations 0, catalog listed, bytes intact',
          pass:
            bytePass(guard) &&
            guard.value.accepted &&
            guard.value.state === 'current' &&
            guard.value.pendingMigrations === 0 &&
            guard.value.catalog.length > 0,
        });
        checks.push({
          check: 'built API starts healthy and serves model catalog',
          pass:
            startup.health.status === 200 &&
            startup.health.body.status === 'ok' &&
            startup.catalog.status === 200 &&
            startup.catalog.body.items.length > 0,
        });
      } else {
        checks.push({
          check:
            'CLI refuses expected reason and prints exact reset command for its configured directory',
          pass:
            preflight.result.code === 1 &&
            preflight.result.stdout.includes(expected) &&
            preflight.result.stdout.includes(
              `node apps/api/dist/main.js --reset --data-dir "${dir}"`,
            ),
        });
        checks.push({
          check: 'startup guard refuses expected reason, preserving DB/WAL and all three files',
          pass: bytePass(guard) && !guard.value.accepted && guard.value.reason.includes(expected),
        });
        checks.push({
          check:
            'built startup exit 1, expected reason and reset instruction, preserving DB/WAL and all three files',
          pass:
            bytePass(startup) &&
            startup.result.code === 1 &&
            startup.result.stderr.includes(expected) &&
            startup.result.stderr.includes('No stored data was changed.') &&
            startup.result.stderr.includes(
              `node apps/api/dist/main.js --reset --data-dir "${dir}"`,
            ),
        });
      }
      verdicts.push({ kind, checks });
      await save(kind + '.json', {
        kind,
        dataDirectory: dir,
        sourceDirectory: source,
        metadata,
        initial,
        preflight,
        ...(controlledPreflight ? { controlledPreflight } : {}),
        guard,
        startup,
        checks,
      });
      console.log(
        kind + ': ' + checks.filter((c) => c.pass).length + '/' + checks.length + ' passed',
      );
    }
    await save('wal-summary.json', {
      head: 'b31b0cd04536418d7523bf0644b5bf20a84e42f4',
      node: process.version,
      port: 5651,
      directory: base,
      verdicts,
    });
  } catch (error) {
    await save('wal-error.json', { message: error.message, stack: error.stack });
    throw error;
  } finally {
    if (active) {
      active.child.kill();
      await active.completion;
      processes.push({ label: 'active-finally', processExited: true });
    }
    if (dirname(base) !== originalTemp || !basename(base).startsWith('gg-qa-266-'))
      throw new Error('cleanup scope refused');
    const entriesBeforeCleanup = await readdir(base);
    await rm(base, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    await save('wal-cleanup.json', {
      directory: base,
      stores: directories,
      processes,
      entriesBeforeCleanup,
      removed: true,
      existsAfterCleanup: await stat(base).then(
        () => true,
        (e) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      ),
    });
  }
}
