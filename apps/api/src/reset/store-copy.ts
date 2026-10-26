import { fork, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { StoreFactsSchema, STORE_READ_TIMEOUT_MS, type StoreFacts } from './store-facts.js';
import { hasCode, listEntry, removeEntry, statEntry, type TreeEntry } from './tree.js';

const PREFIX = 'gg-reset-store-';
const COPY_NAME = /^gg-reset-store-[A-Za-z0-9]{6}$/;
const FILES = new Set([
  'owner.json',
  'owner.next',
  'store.db',
  'store.db-wal',
  'store.db-shm',
  'store.db-journal',
]);
const OwnerSchema = z
  .object({
    kind: z.literal('graphgoblin-reset-store'),
    pid: z.number().int().positive().safe(),
    workerPid: z.number().int().positive().safe().optional(),
    identity: z.string(),
  })
  .strict();

/** Only ESRCH proves death. Permission failures and PID reuse preserve the copy. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasCode(error, 'ESRCH');
  }
}

/** Delete only known files, using the reset's full ancestor/entry identity checks, never rm -r. */
async function removeCopy(root: string, directory: TreeEntry): Promise<void> {
  const entries = await listEntry(root, directory.path);
  if (!entries.length) return;
  if (
    entries.at(-1)!.identity !== directory.identity ||
    entries.some(
      (entry) =>
        entry.path !== directory.path &&
        (entry.kind !== 'file' ||
          !FILES.has(basename(entry.path)) ||
          entry.path.split('/').length !== 2),
    )
  )
    throw new Error(`private reset copy ${join(root, directory.path)} changed; it was not removed`);
  // Retain the ownership proof until every payload file is gone, even if cleanup is killed.
  const marker = `${directory.path}/owner.json`;
  for (const entry of [
    ...entries.filter((entry) => entry.path !== directory.path && entry.path !== marker),
    ...entries.filter((entry) => entry.path === marker),
    entries.at(-1)!,
  ])
    await removeEntry(root, entry);
}

/**
 * Reap only our marked physical directories with dead owners and no unexpected entries. A prefix
 * alone is not ownership: malformed/unmarked directories, live readers, and links stay untouched.
 */
export async function cleanupStaleStoreCopies(): Promise<void> {
  // Resolve only the OS-configured root (as reset does for GG_DATA_DIR), never a copy candidate.
  const root = await realpath(tmpdir());
  for (const name of await readdir(root)) {
    if (!COPY_NAME.test(name)) continue;
    const directory = await statEntry(root, name).catch(() => undefined);
    if (directory?.kind !== 'directory') continue;
    const marker = await statEntry(root, `${name}/owner.json`).catch(() => undefined);
    if (marker?.kind !== 'file' || marker.bytes > 4096) continue;
    const owner = await readFile(join(root, name, 'owner.json'), 'utf8')
      .then(
        (text) => OwnerSchema.safeParse(JSON.parse(text)),
        () => undefined,
      )
      .catch(() => undefined);
    if (
      !owner?.success ||
      owner.data.identity !== directory.identity ||
      alive(owner.data.pid) ||
      (owner.data.workerPid !== undefined && alive(owner.data.workerPid))
    )
      continue;
    // An unexpected file belongs to someone else; preserve the entire directory.
    let safe = true;
    for (const file of await readdir(join(root, name))) {
      if (
        !FILES.has(file) ||
        (await statEntry(root, `${name}/${file}`).catch(() => undefined))?.kind !== 'file'
      ) {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    try {
      await removeCopy(root, directory);
    } catch (error) {
      throw new Error(
        `could not clean stale private reset copy ${join(root, name)}. Close the program holding its files, check its permissions, then run the reset again`,
        { cause: error },
      );
    }
  }
}

/**
 * The copy owner never opens SQLite. Its worker exits before cleanup, releasing native handles
 * even on Windows. A 250 ms liveness poll bounds detection delay without a tight polling loop,
 * keeping cleanup alive after a killed CLI.
 * If this owner is killed too, the next reset reaps its marked directory after both PIDs die.
 */
export async function readStoreCopy(
  databaseFile: string,
  parent = process.ppid,
): Promise<StoreFacts> {
  // The CLI supplies its PID before spawning: process.ppid could already be init after orphaning.
  let worker: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let workerError: Error | undefined;
  let orphaned = false;
  const root = await realpath(tmpdir());
  const path = await mkdtemp(join(root, PREFIX));
  const directory = (await statEntry(root, basename(path)))!;
  const monitor = setInterval(() => {
    if (!alive(parent)) {
      orphaned = true;
      worker?.kill();
    }
  }, 250);
  try {
    const owner = {
      kind: 'graphgoblin-reset-store' as const,
      pid: process.pid,
      identity: directory.identity,
    };
    await writeFile(join(path, 'owner.json'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    const copy = join(path, 'store.db');
    await copyFile(databaseFile, copy, constants.COPYFILE_EXCL);
    await copyFile(databaseFile + '-wal', copy + '-wal', constants.COPYFILE_EXCL).catch(
      (error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      },
    );
    if (orphaned)
      return { readable: false, reason: 'the reset process exited during its store read' };
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    worker = fork(
      fileURLToPath(new URL(`./store-facts-worker.${extension}`, import.meta.url)),
      [copy],
      {
        silent: true,
        windowsHide: true,
      },
    );
    worker.stdout!.resume();
    let stderr = '';
    worker.stderr!.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(0, 4096);
    });
    let facts: StoreFacts | undefined;
    worker.on('message', (value) => {
      const parsed = StoreFactsSchema.safeParse(value);
      facts = parsed.success
        ? parsed.data
        : { readable: false, reason: 'invalid store reader facts' };
    });
    worker.once('error', (error) => {
      workerError = error;
    });
    closed = new Promise<void>((resolve) => {
      worker!.once('close', resolve);
    });
    // The worker waits for this publication before opening the copy. A killed owner therefore
    // cannot strand an unrecorded worker holding the database open.
    await writeFile(join(path, 'owner.next'), JSON.stringify({ ...owner, workerPid: worker.pid }), {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(join(path, 'owner.next'), join(path, 'owner.json'));
    worker.send('read');
    const timeout = setTimeout(() => worker!.kill(), STORE_READ_TIMEOUT_MS);
    try {
      await closed;
    } finally {
      clearTimeout(timeout);
    }
    return (
      facts ?? {
        readable: false,
        reason: workerError?.message || stderr || 'the store reader exited without facts',
      }
    );
  } catch (error) {
    return { readable: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearInterval(monitor);
    if (worker && closed) {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill();
      await closed;
    }
    // No SQLite handle exists in this process; the worker has closed before this removes bytes.
    await removeCopy(root, directory);
  }
}
