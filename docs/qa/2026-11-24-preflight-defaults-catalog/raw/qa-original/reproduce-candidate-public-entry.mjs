import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, evidenceArg, output = 'CANDIDATE-PUBLIC-ENTRY.json'] = process.argv.slice(2);
assert.equal(output, 'CANDIDATE-PUBLIC-ENTRY.json');
const repo = resolve(repoArg);
const evidence = resolve(evidenceArg);
const { openDatabase, guardCurrentStore, pendingMigrationCount, SqliteModelCatalog, DEFAULT_MODEL_CATALOG } =
  await import(pathToFileURL(join(repo, 'packages/infrastructure/dist/sqlite/index.js')).href);
const entry = join(repo, 'apps/api/dist/main.js');
const fixture = pathToFileURL(join(repo, 'packages/adapter-codex/src/fixtures/readiness-cli.mjs')).href;
const data = resolve(await mkdtemp(join(evidence, 'candidate-store-')));
assert.equal(dirname(data), evidence);
const fixtureCli = join(data, 'readiness.mjs');
await writeFile(fixtureCli, "process.argv.splice(2, 0, 'ready');\nawait import(" + JSON.stringify(fixture) + ");\n");
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SystemRoot|Windir|ComSpec|Path|PathExt|Temp|Tmp|UserProfile|AppData|LocalAppData)$/i.test(key)));
const envFor = (name, file, model, effort) => ({
  ...clean,
  GG_HOST: '127.0.0.1',
  GG_PORT: '0',
  GG_DB_URL: pathToFileURL(file).href,
  GG_DATA_DIR: join(data, name + '-data'),
  GG_MASTER_KEY: Buffer.alloc(32, 8).toString('base64'),
  GG_DEFAULTS: JSON.stringify({ byHarness: { codex: { model, effort } } }),
  GG_OLLAMA_ENABLED: 'false',
  GG_OLLAMA_URL: 'http://127.0.0.1:1',
  GG_CODEX_BINARY: fixtureCli,
  GG_CLAUDE_BINARY: join(data, 'absent-claude.exe'),
  GG_WEB_DIST: '',
  GG_GOBLIN_DIST: '',
  GG_SWAGGER_UI: 'false',
});
const snapshot = async file => Object.fromEntries(await Promise.all(
  ['', '-wal'].map(async suffix => {
    const bytes = await readFile(file + suffix).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    return [suffix || 'db', bytes && { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }];
  })));
const assertPreserved = (before, after) => {
  assert.deepEqual(before.db, after.db);
  if (before['-wal']) assert.deepEqual(before['-wal'], after['-wal']);
  else assert.equal(after['-wal']?.size ?? 0, 0);
};
const preflight = (env) => {
  const result = spawnSync(process.execPath, [entry, '--preflight'], {
    cwd: repo, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};
const publicStartup = async env => {
  const child = spawn(process.execPath, [entry], { cwd: repo, env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  let listening;
  const ready = new Promise(resolve => { listening = resolve; });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
    const found = stdout.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (found) listening(found[1]);
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const first = await Promise.race([ready, exit]);
    if (typeof first !== 'string') return { ...first, stdout, stderr };
    const api = await fetch(first + '/system/shutdown', { signal: AbortSignal.timeout(4000) });
    assert.equal(api.status, 200);
    const { controlToken } = await api.json();
    const drain = await fetch(first + '/system/shutdown', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-graphgoblin-shutdown-token': controlToken },
      body: JSON.stringify({ action: 'drain' }),
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(drain.status, 202);
    await drain.json();
    return { ...(await exit), listened: true, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exit;
    }
  }
};
const open = (file, migrationsFolder) =>
  openDatabase({ url: pathToFileURL(file).href, ...(migrationsFolder && { migrationsFolder }) });
const createCurrent = async (file, migrationsFolder) => {
  const db = open(file, migrationsFolder);
  try {
    await db.migrate();
    await new SqliteModelCatalog(db.db).seed();
    await db.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
    globalThis.gc?.();
  }
};
const evidenceRows = [];
const run = async (name, file, model, effort, guard, { start = true, afterPreflight } = {}) => {
  const env = envFor(name, file, model, effort);
  const before = await snapshot(file);
  const observed = preflight(env);
  const after = await snapshot(file);
  assertPreserved(before, after);
  await afterPreflight?.();
  const startup = start ? await publicStartup(env) : undefined;
  evidenceRows.push({ name, model, effort, guard, before, after, preflight: observed, startup });
  await writeFile(join(evidence, output), JSON.stringify(evidenceRows, null, 2) + '\n');
};
try {
  for (const effort of ['none', 'low', undefined]) {
    const label = effort ?? 'omitted';
    const file = join(data, label + '.db');
    await createCurrent(file);
    await run('migrated-' + label, file, 'gpt-5.5', effort, 'current; zero pending');
  }
  const historical = join(data, 'migrations');
  await mkdir(join(historical, 'meta'), { recursive: true });
  const source = join(repo, 'packages/infrastructure/drizzle');
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 27);
  await writeFile(join(historical, 'meta/_journal.json'), JSON.stringify(journal));
  await Promise.all(journal.entries.map(({ tag }) =>
    copyFile(join(source, tag + '.sql'), join(historical, tag + '.sql'))));

  const pending = join(data, 'pending.db');
  await createCurrent(pending, historical);
  const writer = open(pending);
  let closed = false;
  try {
    assert.equal(await guardCurrentStore(writer.client), 'current');
    assert.equal(await pendingMigrationCount(writer.client), 3);
    await writer.client.execute('PRAGMA journal_mode = WAL');
    const seed = DEFAULT_MODEL_CATALOG.find(row => row.harness === 'codex' && row.model === 'gpt-6-luna');
    assert.ok(seed);
    const custom = 'fixture-only-codex-model';
    const catalog = new SqliteModelCatalog(writer.db);
    await catalog.upsert({ ...seed, enabled: false });
    await catalog.upsert({ ...seed, model: custom, source: 'litellm' });
    assert.ok((await snapshot(pending))['-wal'].size > 0);
    await run('pending-disabled', pending, seed.model, 'low', 'current; 3 pending, stored row disabled', { start: false });
    await run('pending-stored-only', pending, custom, 'low', 'current; 3 pending, model only in stored rows', {
      afterPreflight: () => {
        writer.close();
        closed = true;
      },
    });
  } finally {
    if (!closed) writer.close();
  }
  const omitted = join(data, 'pending-missing-seed.db');
  await createCurrent(omitted, historical);
  const missingSeedWriter = open(omitted);
  let missingSeedClosed = false;
  try {
    assert.equal(await guardCurrentStore(missingSeedWriter.client), 'current');
    assert.equal(await pendingMigrationCount(missingSeedWriter.client), 3);
    await missingSeedWriter.client.execute(
      "DELETE FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'",
    );
    const prior = await missingSeedWriter.client.execute(
      "SELECT model FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'",
    );
    assert.deepEqual(prior.rows, []);
    assert.ok((await snapshot(omitted))['-wal'].size > 0);
    await run('pending-missing-seed', omitted, 'gpt-6.1-terra', 'medium', 'current; 3 pending, shipped row absent', {
      afterPreflight: () => {
        missingSeedWriter.close();
        missingSeedClosed = true;
        globalThis.gc?.();
      },
    });
  } finally {
    if (!missingSeedClosed) missingSeedWriter.close();
  }
  const narrowed = join(data, 'pending-stored-effort.db');
  await createCurrent(narrowed, historical);
  const narrowedWriter = open(narrowed);
  let narrowedClosed = false;
  try {
    assert.equal(await guardCurrentStore(narrowedWriter.client), 'current');
    assert.equal(await pendingMigrationCount(narrowedWriter.client), 3);
    const seed = DEFAULT_MODEL_CATALOG.find(row => row.harness === 'codex' && row.model === 'gpt-5.5');
    assert.ok(seed?.efforts.includes('high'));
    await new SqliteModelCatalog(narrowedWriter.db).upsert({ ...seed, efforts: ['low'], defaultEffort: 'low' });
    assert.ok((await snapshot(narrowed))['-wal'].size > 0);
    await run('pending-stored-effort', narrowed, seed.model, 'high', 'current; 3 pending, stored efforts only low', {
      afterPreflight: () => {
        narrowedWriter.close();
        narrowedClosed = true;
        globalThis.gc?.();
      },
    });
  } finally {
    if (!narrowedClosed) narrowedWriter.close();
  }
  await run('missing', join(data, 'missing.db'), 'gpt-5.5', 'low', 'absent');
  const unsupported = join(data, 'unsupported.db');
  await createCurrent(unsupported);
  const writer2 = open(unsupported);
  try {
    await writer2.client.execute('UPDATE gg_upgrade_state SET format_version = 3');
    await writer2.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    writer2.close();
  }
  await run('unsupported', unsupported, 'gpt-5.5', 'low', 'format 3');
  const unreadable = join(data, 'unreadable.db');
  await writeFile(unreadable, 'controlled non-SQLite bytes');
  await run('unreadable', unreadable, 'gpt-5.5', 'low', 'not SQLite');
} finally {
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log(evidenceRows.map(r => ({
  name: r.name,
  preflight: r.preflight.code,
  checks: r.preflight.stdout.split(/\r?\n/).filter(line => /Default model|Database|Harness codex/.test(line)).map(line => line.trim()),
  startup: r.startup?.code,
  listened: r.startup?.listened,
  startupError: r.startup?.stderr?.split(/\r?\n/)[0],
})));
