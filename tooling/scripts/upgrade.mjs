#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDataDirLock } from '../../apps/api/dist/data-dir-lock.js';
import {
  openDatabase,
  openReadOnlyDatabaseClient,
  databaseFilePath,
  inspectDatabaseUpgrade,
  applyDatabaseUpgrade,
} from '../../packages/infrastructure/dist/sqlite/index.js';
import { upgradeExportV1, upgradeLoopV1 } from '../../packages/domain/dist/index.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function output(path, value) {
  await writeFile(resolve(path), JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
}
function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function tree(path, prefix = '') {
  const items = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (prefix === '' && ['graphgoblin.lock', 'graphgoblin.lock.reclaim'].includes(entry.name))
      continue;
    const key = prefix ? prefix + '/' + entry.name : entry.name,
      full = join(path, entry.name);
    if (entry.isDirectory()) {
      items[key] = { directory: true };
      Object.assign(items, await tree(full, key));
    } else if (entry.isSymbolicLink()) items[key] = { link: await readlink(full) };
    else items[key] = { sha256: hash(await readFile(full)) };
  }
  return Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)));
}
/** Complete stopped data copy, external DB plus WAL/SHM when applicable, hash-verified before opening SQLite. */
export async function backupStoppedData(dataDir, dbFile, backupDir) {
  if (within(dataDir, backupDir) || within(backupDir, dataDir))
    throw new Error('Backup directory must be separate from the data directory');
  await mkdir(backupDir, { recursive: false });
  const before = await tree(dataDir);
  await cp(dataDir, join(backupDir, 'data'), {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
    filter: (source) =>
      !['graphgoblin.lock', 'graphgoblin.lock.reclaim'].includes(relative(dataDir, source)),
  });
  const copied = await tree(join(backupDir, 'data'));
  if (
    JSON.stringify(before) !== JSON.stringify(copied) ||
    JSON.stringify(before) !== JSON.stringify(await tree(dataDir))
  )
    throw new Error('Stopped data backup verification failed');
  const external = {};
  if (!within(dataDir, dbFile)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const content = await readFile(dbFile + suffix);
        await writeFile(join(backupDir, 'database' + suffix), content, { flag: 'wx', mode: 0o600 });
        const digest = hash(content);
        if (
          hash(await readFile(join(backupDir, 'database' + suffix))) !== digest ||
          hash(await readFile(dbFile + suffix)) !== digest
        )
          throw new Error('External database backup verification failed');
        external[suffix] = { sha256: digest };
      } catch (error) {
        if (suffix !== '' && error?.code === 'ENOENT') continue;
        throw error;
      }
    }
  }
  await output(join(backupDir, 'backup.json'), {
    format: 'graphgoblin-stopped-backup',
    dataDir,
    dbFile,
    files: before,
    external,
  });
}
export function argumentsFor(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i],
      value = rest[i + 1];
    if (
      !key?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--') ||
      Object.hasOwn(options, key.slice(2))
    )
      throw new Error('Expected unique --option value arguments');
    options[key.slice(2)] = value;
  }
  const allowed = {
    inventory: ['data-dir', 'db-url', 'out'],
    apply: ['data-dir', 'db-url', 'manifest', 'backup-dir'],
    export: ['input', 'out', 'resolutions'],
    audit: ['data-dir', 'db-url', 'out'],
  };
  if (
    !Object.hasOwn(allowed, command) ||
    Object.keys(options).some((key) => !allowed[command].includes(key))
  )
    throw new Error('Use inventory, apply, export or audit with the documented arguments');
  for (const key of allowed[command].filter((key) => key !== 'resolutions'))
    if (!options[key]) throw new Error('Missing --' + key);
  return { command, options };
}
export async function runUpgrade(argv) {
  const { command, options } = argumentsFor(argv);
  if (command === 'export') {
    const original = await json(options.input);
    const resolutions = options.resolutions ? await json(options.resolutions) : {};
    const result =
      original?.format === 'graphgoblin-loop'
        ? upgradeExportV1(original, resolutions)
        : upgradeLoopV1(original, resolutions);
    if (!result.ok) {
      await output(options.out, { format: 'graphgoblin-upgrade-refusals', issues: result.issues });
      return { ok: false, command, refusals: result.issues.length };
    }
    await output(options.out, result.value);
    return { ok: true, command, notices: result.notices.length };
  }
  const dataDir = resolve(options['data-dir']),
    url = options['db-url'],
    dbFile = databaseFilePath(url);
  if (!dbFile) throw new Error('Offline upgrade requires a local file database URL');
  // Ownership is established before the database is opened; live GraphGoblin makes this fail.
  const lock = await acquireDataDirLock(dataDir);
  let handle;
  try {
    if (!(await stat(dbFile)).isFile()) throw new Error('Database file does not exist');
    if (command === 'apply')
      await backupStoppedData(dataDir, dbFile, resolve(options['backup-dir']));
    if (command === 'apply') handle = openDatabase({ url });
    else {
      const client = openReadOnlyDatabaseClient(dbFile);
      handle = { client, close: () => client.close() };
    }
    if (command === 'inventory') {
      const inventory = await inspectDatabaseUpgrade(handle.client);
      await output(options.out, {
        format: 'graphgoblin-upgrade-inventory',
        targetVersion: 2,
        sourceHash: inventory.sourceHash,
        versions: inventory.versions,
        blockedRuns: inventory.blockedRuns,
        issues: inventory.issues,
        manifest: {
          format: 'graphgoblin-upgrade-manifest',
          targetVersion: 2,
          sourceHash: inventory.sourceHash,
          approvedBy: '',
          approvedAt: '',
          versions: Object.fromEntries(
            inventory.versions.map((version) => [
              version.id,
              { definitionHash: version.definitionHash, resolutions: {} },
            ]),
          ),
          failedRuns: Object.fromEntries(
            inventory.failedRuns.map((id) => [
              id,
              { disposition: 'nonresumable-replay', reason: '' },
            ]),
          ),
        },
      });
      return {
        ok: true,
        command,
        versions: inventory.versions.length,
        blockedRuns: inventory.blockedRuns.length,
        affectedFailedRuns: inventory.failedRuns.length,
      };
    }
    if (command === 'apply')
      return {
        ok: true,
        command,
        ...(await applyDatabaseUpgrade(handle.client, await json(options.manifest))),
      };
    const result = await handle.client.execute(
      'SELECT kind,identity,source_hash,manifest_hash,payload FROM gg_upgrade_archive ORDER BY manifest_hash,kind,identity',
    );
    await output(options.out, {
      format: 'graphgoblin-upgrade-audit',
      records: result.rows.map((row) => ({
        kind: row.kind,
        identity: row.identity,
        sourceHash: row.source_hash,
        manifestHash: row.manifest_hash,
        payload: JSON.parse(String(row.payload)),
      })),
    });
    return { ok: true, command, records: result.rows.length };
  } finally {
    handle?.close();
    await lock.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runUpgrade(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 2;
  } catch {
    process.stderr.write(
      'Offline upgrade refused; preserve the backup and inspect the inventory/approved manifest.\n',
    );
    process.exitCode = 1;
  }
}
