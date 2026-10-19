// Disposable end-to-end check of the explicit reset (ADR-0040) through the built API binary:
// startup refuses an older store and names the reset; the dry run changes nothing; a confirmation
// naming another directory is refused; the confirmed reset removes exactly its manifest without
// following links; the next start initializes a fresh store. Run `pnpm build` first, then
// `pnpm test:reset`. Everything lives in a temporary directory; no installed instance is touched.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = join(root, 'apps', 'api', 'dist', 'main.js');
const sqlite = pathToFileURL(
  join(root, 'packages', 'infrastructure', 'dist', 'sqlite', 'index.js'),
).href;
const RUN = '01JRESETACCEPTANCEAAAAAAAA';
const TIMEOUT = 300_000;

/** The environment of a GraphGoblin process for this data directory, and nothing inherited. */
function environment(dataDir, extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
  );
  return { ...env, GG_DATA_DIR: dataDir, GG_WEB_DIST: '', GG_LOG_LEVEL: 'warn', ...extra };
}

/** Run the built binary to completion. */
function api(args, dataDir, extra) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [main, ...args],
      { env: environment(dataDir, extra), timeout: TIMEOUT, windowsHide: true },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

/** Seed a format-3 store with one run in a child process, whose exit releases SQLite's files. */
async function seedOldStore(dataDir) {
  const script = `
    const { openDatabase } = await import(${JSON.stringify(sqlite)});
    const handle = openDatabase({ url: ${JSON.stringify(pathToFileURL(join(dataDir, 'graphgoblin.db')).href)} });
    await handle.migrate();
    await handle.client.execute({
      sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [${JSON.stringify(RUN)}, 'local', 'loop', 'version', 'invocation', 'succeeded', 1, '2026-10-18T00:00:00.000Z', '{}'],
    });
    await handle.client.execute('UPDATE gg_upgrade_state SET format_version = 3');
    process.stdout.write('seeded', () => process.exit(0));`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', script],
    { timeout: TIMEOUT, windowsHide: true },
  );
  assert.equal(stdout, 'seeded');
}

/** Every entry below `dir`, byte for byte, never following links. */
async function snapshot(dir, prefix = '') {
  const records = [];
  for (const name of (await readdir(join(dir, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const full = join(dir, path);
    const stats = await lstat(full);
    if (stats.isSymbolicLink()) records.push(`${path} -> ${await readlink(full)}`);
    else if (stats.isDirectory()) records.push(`${path}/`, ...(await snapshot(dir, path)));
    else
      records.push(
        `${path} ${createHash('sha256')
          .update(await readFile(full))
          .digest('hex')}`,
      );
  }
  return records;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  'the built API refuses an older store, lists and then performs an explicit reset, and starts fresh',
  { timeout: 6 * TIMEOUT },
  async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-reset-acceptance-'));
    try {
      const dataDir = join(base, 'data');
      const outside = join(base, 'outside-repo');
      await mkdir(join(outside, 'src'), { recursive: true });
      await writeFile(join(outside, 'src', 'precious.txt'), 'never removed');
      await mkdir(dataDir);
      await seedOldStore(dataDir);
      await mkdir(join(dataDir, 'artifacts', 'text'), { recursive: true });
      await writeFile(join(dataDir, 'artifacts', 'text', 'abc123'), 'artifact body');
      await mkdir(join(dataDir, 'workspaces', RUN, 'src'), { recursive: true });
      await writeFile(join(dataDir, 'workspaces', RUN, 'src', 'out.txt'), 'run output');
      await symlink(
        outside,
        join(dataDir, 'workspaces', RUN, 'repo'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await mkdir(join(dataDir, 'workspaces', 'my-notes'));
      await writeFile(join(dataDir, 'workspaces', 'my-notes', 'keep.txt'), 'user directory');
      await writeFile(join(dataDir, 'master.key'), Buffer.alloc(32, 9).toString('base64'));
      // SQLite's shared-memory index (-shm) is rewritten by any reader, including startup's
      // read-only format check; the database and its WAL are the stored data.
      const stored = (records) =>
        records.map((record) => record.replace(/^(data\/graphgoblin\.db-shm) .*/, '$1'));
      const beforeStart = stored(await snapshot(base));

      // Startup refuses with the explanation only: no stack trace, nothing changed.
      const refused = await api([], dataDir, { GG_PORT: String(await freePort()) });
      assert.equal(refused.code, 1);
      assert.equal(
        refused.stderr,
        [
          `GraphGoblin did not start: this build cannot open the store in data directory ${dataDir}.`,
          `  Database: ${join(dataDir, 'graphgoblin.db')}`,
          '  Found:    format 3',
          '  Requires: format 4',
          '  Reason:   The store is format 3; this build reads only format 4',
          'Nothing was changed. This build does not convert stores from other formats.',
          'To keep that data, run the GraphGoblin build that wrote it. To start fresh, stop every GraphGoblin process using the data directory, then list what a reset would remove (this removes nothing):',
          `  node apps/api/dist/main.js --reset --data-dir "${dataDir}"`,
          '',
        ].join('\n'),
      );
      assert.deepEqual(stored(await snapshot(base)), beforeStart);

      // The dry run lists the manifest and changes nothing, byte for byte.
      const original = await snapshot(base);
      const dryRun = await api(['--reset', '--data-dir', dataDir], dataDir);
      assert.equal(dryRun.stderr, '');
      assert.equal(dryRun.code, 0);
      process.stdout.write(`--- dry run output ---\n${dryRun.stdout}--- end ---\n`);
      for (const line of [
        'GraphGoblin reset (dry run: nothing is removed)',
        `Database:       ${join(dataDir, 'graphgoblin.db')} (format 3; this build requires format 4)`,
        `  workspaces/${RUN}  run workspace            1 file, 2 directories, 1 link, 10 B`,
        '  artifacts                              artifacts                1 file, 2 directories, 13 B',
        "  graphgoblin.lock                       the reset's own lock     removed last, on release",
        '  master.key                             secret-store key; kept so the secrets in a backup of this store stay readable',
        '  workspaces/my-notes                    not a stored run ID',
        `  node apps/api/dist/main.js --reset --yes --data-dir "${dataDir}"`,
      ])
        assert.ok(dryRun.stdout.includes(line), `dry run output lacks: ${line}`);
      assert.match(dryRun.stdout, /\n {2}graphgoblin\.db +database +1 file, [\d.]+ KB\n/);
      assert.deepEqual(await snapshot(base), original);

      // A confirmation naming another directory is refused and changes nothing.
      const wrong = await api(['--reset', '--yes', '--data-dir', outside], dataDir);
      assert.equal(wrong.code, 1);
      assert.equal(wrong.stdout, '');
      assert.match(
        wrong.stderr,
        /^reset refused: --data-dir names .*, but this environment's data directory is /,
      );
      assert.match(wrong.stderr, /\nNothing was changed\.\n$/);
      assert.deepEqual(await snapshot(base), original);

      // The confirmed reset removes exactly its manifest and follows no link.
      const confirmed = await api(['--reset', '--yes', '--data-dir', dataDir], dataDir);
      assert.equal(confirmed.stderr, '');
      assert.equal(confirmed.code, 0);
      process.stdout.write(`--- confirmed output ---\n${confirmed.stdout}--- end ---\n`);
      assert.match(
        confirmed.stdout.slice(confirmed.stdout.indexOf('Removing:\n')),
        new RegExp(
          [
            '^Removing:',
            `  removed workspaces/${RUN} \\(1 file, 2 directories, 1 link, 10 B\\)`,
            '  removed artifacts \\(1 file, 2 directories, 13 B\\)',
            '  removed graphgoblin\\.db \\(1 file, [\\d.]+ KB\\)',
            '(  removed graphgoblin\\.db-(wal|shm) \\(1 file, [\\d.]+ (B|KB)\\)\\n)*  removed graphgoblin\\.lock',
            'Reset complete\\. The next start creates a new, empty format-4 store in .+\\.',
            '$',
          ].join('\\n'),
        ),
      );
      const kept = await snapshot(base);
      assert.deepEqual(
        kept,
        original.filter(
          (record) => !/^data\/(graphgoblin\.db|artifacts|workspaces\/01J)/.test(record),
        ),
      );

      // The next start initializes a fresh current-format store in the same directory.
      const port = await freePort();
      const server = spawn(process.execPath, [main], {
        env: environment(dataDir, { GG_PORT: String(port) }),
        stdio: 'ignore',
        windowsHide: true,
      });
      try {
        const deadline = Date.now() + TIMEOUT;
        let healthy = false;
        while (!healthy && Date.now() < deadline && server.exitCode === null) {
          healthy = await fetch(`http://127.0.0.1:${port}/healthz`).then(
            (response) => response.ok,
            () => false,
          );
          if (!healthy) await new Promise((resolve) => setTimeout(resolve, 500));
        }
        assert.ok(healthy, 'the API did not start on the reset data directory');
        assert.ok((await readdir(dataDir)).includes('graphgoblin.db'));
      } finally {
        server.kill();
      }
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
