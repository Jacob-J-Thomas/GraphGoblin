#!/usr/bin/env node
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
  unlink,
  rmdir,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDataDirLock } from '../../apps/api/dist/data-dir-lock.js';
import {
  openDatabase,
  openReadOnlyDatabaseClient,
  databaseFilePath,
  inspectDatabaseUpgrade,
  applyDatabaseUpgrade,
  guardCurrentStore as guardDatabaseUpgrade,
  verifyStoreHead as verifyDatabaseHead,
  RUN_HISTORY_TABLES,
} from '../../packages/infrastructure/dist/sqlite/index.js';
import { generatedResolutions, pendingSummary } from './upgrade-resolutions.mjs';
import { CURRENT_DEFINITION_FORMAT } from '../../packages/contracts/dist/index.js';
import { upgradeExportCurrent, upgradeLoopCurrent } from '../../packages/domain/dist/index.js';

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
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
async function tree(path, prefix = '', skipLocks = true, topLevelNames) {
  const items = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (prefix === '' && topLevelNames && !topLevelNames.has(entry.name)) continue;
    if (
      skipLocks &&
      prefix === '' &&
      ['graphgoblin.lock', 'graphgoblin.lock.reclaim'].includes(entry.name)
    )
      continue;
    const key = prefix ? prefix + '/' + entry.name : entry.name,
      full = join(path, entry.name);
    if (entry.isSymbolicLink()) items[key] = { link: await readlink(full) };
    else if (entry.isDirectory()) {
      items[key] = { directory: true };
      Object.assign(items, await tree(full, key, skipLocks));
    } else if (entry.isFile()) items[key] = { sha256: hash(await readFile(full)) };
    else
      throw new Error(
        'Unsupported filesystem entry (expected regular file, link or directory): ' + full,
      );
  }
  return Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)));
}
/** Database files must be regular paths: preserved links cannot serve as an independent database backup. */
async function requireRegularDatabasePaths(dbFile) {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbFile + suffix;
    try {
      const info = await lstat(file);
      if (!info.isFile() || relative(file, await realpath(file)) !== '')
        throw new Error(
          'Database and sidecars must be regular files without symbolic links or linked ancestors',
        );
    } catch (error) {
      if (suffix !== '' && error?.code === 'ENOENT') continue;
      throw error;
    }
  }
}
/** Stopped data copy preserving ordinary links, independent DB/WAL/SHM bytes, verified before opening SQLite. */
export async function backupStoppedData(dataDir, dbFile, backupDir) {
  dataDir = resolve(dataDir);
  dbFile = resolve(dbFile);
  backupDir = resolve(backupDir);
  const physicalDataDir = await realpath(dataDir);
  backupDir = join(await realpath(dirname(backupDir)), basename(backupDir));
  if (relative(dataDir, physicalDataDir) !== '')
    throw new Error(
      'Data directory must use its physical path without symbolic links or linked ancestors',
    );
  if (within(physicalDataDir, backupDir) || within(backupDir, physicalDataDir))
    throw new Error('Backup directory must be separate from the data directory');
  await requireRegularDatabasePaths(dbFile);
  if (within(backupDir, dbFile))
    throw new Error('Backup directory must be separate from the database');
  const before = await tree(dataDir);
  await mkdir(backupDir, { recursive: false });
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
/** Re-read the complete backup before opening a writer. A directory name alone is no proof. */
export async function verifyStoppedBackup(dataDir, dbFile, backupDir, compareSource = true) {
  const record = await json(join(backupDir, 'backup.json'));
  if (
    record.format !== 'graphgoblin-stopped-backup' ||
    record.dataDir !== resolve(dataDir) ||
    record.dbFile !== resolve(dbFile)
  )
    throw new Error('Backup identity is invalid');
  if (JSON.stringify(await tree(join(backupDir, 'data'))) !== JSON.stringify(record.files))
    throw new Error('Backup file verification failed');
  if (compareSource && JSON.stringify(await tree(dataDir)) !== JSON.stringify(record.files))
    throw new Error('Stopped source changed after backup');
  const external = {};
  if (!within(resolve(dataDir), resolve(dbFile)))
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        external[suffix] = { sha256: hash(await readFile(join(backupDir, 'database' + suffix))) };
      } catch (error) {
        if (suffix !== '' && error?.code === 'ENOENT') continue;
        throw error;
      }
    }
  if (JSON.stringify(external) !== JSON.stringify(record.external))
    throw new Error('External database backup verification failed');
  if (compareSource)
    for (const suffix of ['', '-wal', '-shm']) {
      if (within(resolve(dataDir), resolve(dbFile))) break;
      let digest;
      try {
        digest = hash(await readFile(dbFile + suffix));
      } catch (error) {
        if (suffix !== '' && error?.code === 'ENOENT') digest = undefined;
        else throw error;
      }
      if (digest !== record.external[suffix]?.sha256)
        throw new Error('External database changed after backup');
    }
}
async function artifactInventory(dataDir) {
  const root = join(dataDir, 'artifacts');
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Artifacts must be a physical directory');
    return Object.entries(await tree(root, '', false))
      .filter(([, entry]) => !entry.directory)
      .map(([path, entry]) => ({ path, ...entry }));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}
async function workspaceInventory(dataDir, runIds) {
  const root = join(dataDir, 'workspaces');
  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], leftInPlace: [] };
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Workspaces must be a physical directory');
  // A disappearing descendant is a changed inventory, never an empty subtree.
  const leftInPlace = (await readdir(root)).filter((name) => !runIds.has(name)).sort();
  return {
    entries: Object.entries(await tree(root, '', false, runIds)).map(([path, entry]) => ({
      path,
      ...entry,
    })),
    leftInPlace,
  };
}
/** Remove exactly the inventoried leaves, then their empty directories. No recursive deletion.
 * Check physical ancestors immediately before each mutation; nested links are removed as links. */
export async function cleanupWorkspaces(dataDir, entries) {
  const root = resolve(dataDir, 'workspaces');
  const ordered = [...entries].sort(
    (a, b) => b.path.split('/').length - a.path.split('/').length || a.path.localeCompare(b.path),
  );
  for (const entry of ordered) {
    const full = resolve(root, entry.path);
    if (!within(root, full) || full === root)
      throw new Error('Workspace cleanup path escapes its inventory root');
    let parent = dirname(full);
    for (;;) {
      const info = await lstat(parent);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        relative(parent, await realpath(parent)) !== ''
      )
        throw new Error('Workspace cleanup refuses linked ancestors');
      if (parent === root) break;
      parent = dirname(parent);
    }
    const info = await lstat(full);
    if (entry.directory) {
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error('Workspace directory changed during cleanup');
      await rmdir(full);
    } else {
      if (
        info.isSymbolicLink() !== Object.hasOwn(entry, 'link') ||
        (!info.isSymbolicLink() && !info.isFile())
      )
        throw new Error('Workspace file/link changed during cleanup');
      try {
        await unlink(full);
      } catch (error) {
        // Windows directory junctions may require RemoveDirectory; rmdir never traverses them.
        if (
          info.isSymbolicLink() &&
          process.platform === 'win32' &&
          ['EPERM', 'EISDIR'].includes(error.code)
        )
          await rmdir(full);
        else throw error;
      }
    }
  }
}
async function inspectStore(client, dataDir, resolutions) {
  const inventory = await inspectDatabaseUpgrade(client, resolutions);
  const artifactFiles = inventory.status === 'current' ? [] : await artifactInventory(dataDir);
  const workspaceRunIds =
    inventory.status !== 'current' && inventory.tableCounts.runs !== undefined
      ? (await client.execute('SELECT id FROM runs ORDER BY id')).rows.map((row) => String(row.id))
      : [];
  const workspaces =
    inventory.status === 'current'
      ? { entries: [], leftInPlace: [] }
      : await workspaceInventory(dataDir, new Set(workspaceRunIds));
  const { entries: workspaceEntries, leftInPlace: workspaceLeftInPlace } = workspaces;
  return {
    ...inventory,
    format: 'graphgoblin-upgrade-inspection',
    targetVersion: CURRENT_DEFINITION_FORMAT,
    databasePlanHash: inventory.planHash,
    planHash: hash(
      JSON.stringify({
        databasePlanHash: inventory.planHash,
        artifactFiles,
        workspaceEntries,
        workspaceLeftInPlace,
      }),
    ),
    counts: {
      ...inventory.counts,
      artifactFiles: artifactFiles.length,
      workspaces: workspaceEntries.filter((entry) => !entry.path.includes('/')).length,
      workspaceFiles: workspaceEntries.filter((entry) => !entry.directory).length,
    },
    pendingByKind: pendingSummary(inventory.definitions),
    workspaceEntries,
    workspaceRunIds,
    workspaceLeftInPlace,
    artifactFiles,
  };
}
export function argumentsFor(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key?.startsWith('--') || Object.hasOwn(options, key.slice(2)))
      throw new Error('Expected unique --option value arguments');
    if (key === '--approve-generated') {
      options['approve-generated'] = true;
      continue;
    }
    const value = rest[++i];
    if (value === undefined || value.startsWith('--')) throw new Error('Expected --option value');
    options[key.slice(2)] = value;
  }
  const allowed = {
    inspect: ['data-dir', 'db-url', 'out', 'resolutions'],
    apply: ['data-dir', 'db-url', 'plan-hash', 'backup-dir', 'resolutions'],
    export: ['input', 'out', 'resolutions'],
    resolutions: ['from', 'approve-generated', 'out', 'merge'],
  };
  if (
    !Object.hasOwn(allowed, command) ||
    Object.keys(options).some((key) => !allowed[command].includes(key))
  )
    throw new Error('Use inspect, apply, export or resolutions with the documented arguments');
  for (const key of allowed[command].filter((key) => !['resolutions', 'merge'].includes(key)))
    if (!options[key]) throw new Error('Missing --' + key);
  return { command, options };
}
export async function runUpgrade(argv) {
  const { command, options } = argumentsFor(argv);
  if (command === 'resolutions') {
    const { resolutions: generated, summary } = generatedResolutions(
      await json(options.from),
      options.merge ? await json(options.merge) : undefined,
    );
    await output(options.out, generated);
    return { ok: true, command, out: resolve(options.out), ...summary };
  }
  const resolutions = options.resolutions ? await json(options.resolutions) : {};
  if (command === 'export') {
    const original = await json(options.input);
    const result =
      original?.format === 'graphgoblin-loop'
        ? await upgradeExportCurrent(original, resolutions)
        : await upgradeLoopCurrent(original, resolutions);
    if (!result.ok) {
      await output(options.out, {
        format: 'graphgoblin-upgrade-refusals',
        issues: result.issues,
        notices: result.notices,
        reviewItems: result.reviewItems,
      });
      return { ok: false, command, refusals: result.issues.length };
    }
    await output(options.out, result.value);
    return { ok: true, command, notices: result.notices.length };
  }
  const dataDir = resolve(options['data-dir']),
    url = options['db-url'],
    dbFile = databaseFilePath(url);
  if (!dbFile) throw new Error('Offline upgrade requires a local file database URL');
  if (['artifacts', 'workspaces'].some((name) => within(resolve(dataDir, name), dbFile)))
    throw new Error('Database must be outside the artifact and temporary workspace cleanup roots');
  // Physical paths bind lock, source, backup and artifact removal to the same directory.
  if (relative(dataDir, await realpath(dataDir)) !== '')
    throw new Error('Use the physical data directory');
  const lock = await acquireDataDirLock(dataDir);
  const lockRecord = await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8');
  const assertLock = async () => {
    if ((await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8')) !== lockRecord)
      throw new Error('Directory lock was lost; upgrade refused');
  };
  let handle;
  let backupDir;
  let committed = false;
  try {
    await requireRegularDatabasePaths(dbFile);
    const reader = openReadOnlyDatabaseClient(dbFile);
    let plan;
    try {
      plan = await inspectStore(reader, dataDir, resolutions);
    } finally {
      reader.close();
    }
    if (command === 'inspect') {
      await output(options.out, plan);
      return {
        ok: true,
        command,
        status: plan.status,
        counts: plan.counts,
        pending: plan.definitions.filter((entry) => entry.conversion === 'pending').length,
        invalid:
          plan.issues.length +
          plan.definitions.filter((entry) => entry.conversion === 'invalid').length,
        blockedRuns: plan.blockedRuns.length,
        blockedReceipts: plan.blockedReceipts.length,
        disarm: plan.disarm.length,
        pendingByKind: plan.pendingByKind,
        workspaceLeftInPlace: plan.workspaceLeftInPlace,
        planHash: plan.planHash,
      };
    }
    if (plan.planHash !== options['plan-hash'])
      throw new Error('Plan hash changed; inspect and review again');
    if (plan.issues.length || plan.definitions.some((entry) => entry.conversion !== 'automatic'))
      throw new Error('Inspect reports blockers or unresolved pending/invalid items');
    if (plan.status === 'current')
      return { ok: true, command, status: 'current', message: 'Nothing needs doing' };
    if (plan.blockedRuns.length || plan.blockedReceipts.length)
      throw new Error('Inspect reports ordinary blockers');
    const workspaceRunIds = new Set(plan.workspaceRunIds);
    backupDir = resolve(options['backup-dir']);
    await assertLock();
    await backupStoppedData(dataDir, dbFile, backupDir);
    await verifyStoppedBackup(dataDir, dbFile, backupDir);
    handle = openDatabase({ url });
    const result = await applyDatabaseUpgrade(
      handle.client,
      { planHash: plan.databasePlanHash, resolutions },
      {
        verifySafety: async () => {
          await assertLock();
          if (
            JSON.stringify(await artifactInventory(dataDir)) !== JSON.stringify(plan.artifactFiles)
          )
            throw new Error('Artifact plan changed before commit');
          if (
            JSON.stringify(await workspaceInventory(dataDir, workspaceRunIds)) !==
            JSON.stringify({
              entries: plan.workspaceEntries,
              leftInPlace: plan.workspaceLeftInPlace,
            })
          )
            throw new Error('Workspace plan changed before commit');
          await verifyStoppedBackup(dataDir, dbFile, backupDir, false);
        },
      },
    );
    committed = result.status === 'upgraded';
    await assertLock();
    if (JSON.stringify(await artifactInventory(dataDir)) !== JSON.stringify(plan.artifactFiles))
      throw new Error('Artifact files changed; database committed but cleanup is incomplete');
    if (
      JSON.stringify(await workspaceInventory(dataDir, workspaceRunIds)) !==
      JSON.stringify({ entries: plan.workspaceEntries, leftInPlace: plan.workspaceLeftInPlace })
    )
      throw new Error('Workspace paths changed; database committed but cleanup is incomplete');
    await cleanupWorkspaces(dataDir, plan.workspaceEntries);
    if ((await workspaceInventory(dataDir, workspaceRunIds)).entries.length)
      throw new Error('Workspace cleanup readback failed');
    for (const file of plan.artifactFiles) await unlink(join(dataDir, 'artifacts', file.path));
    if ((await artifactInventory(dataDir)).length)
      throw new Error('Artifact cleanup readback failed');
    await guardDatabaseUpgrade(handle.client);
    await verifyDatabaseHead(handle.client);
    const readback = await inspectDatabaseUpgrade(handle.client);
    if (
      readback.status !== 'current' ||
      RUN_HISTORY_TABLES.some((name) => readback.tableCounts[name])
    )
      throw new Error('Committed store readback failed');
    return {
      ok: true,
      command,
      ...result,
      planHash: plan.planHash,
      backupDir,
      deletedArtifactFiles: plan.artifactFiles.length,
      deletedWorkspaces: plan.counts.workspaces,
      deletedWorkspaceFiles: plan.counts.workspaceFiles,
      workspaceLeftInPlace: plan.workspaceLeftInPlace,
      disarmed: plan.disarm,
      readback: 'verified',
    };
  } catch (error) {
    throw new Error(
      `Offline upgrade failed (${committed ? 'database committed; restore backup if cleanup/readback failed' : 'no cutover committed'}). Backup: ${backupDir ?? 'not created'}. ${error.message}`,
      { cause: error },
    );
  } finally {
    handle?.close();
    await lock.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runUpgrade(process.argv.slice(2));
    process.stdout.write(
      JSON.stringify(result, null, result.command === 'resolutions' ? 2 : undefined) + '\n',
    );
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
