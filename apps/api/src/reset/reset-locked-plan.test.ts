import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyStore, SEEDED_RUN_IDS, seedStores, snapshotTree } from './__fixtures__/stores.js';
import { cleanupStaleStoreCopies } from './store-copy.js';
import { runResetCli } from './reset.js';
import { readStoreFacts, type StoreFacts } from './store-facts.js';
import { identityOf } from './tree.js';

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-d3-'));
  const temporary = join(base, 'temp');
  await mkdir(temporary);
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) vi.stubEnv(name, temporary);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const readable: StoreFacts = { readable: true, format: 3, runIds: ['run-a', 'run-b'] };
const unreadable: StoreFacts = { readable: false, reason: 'database disk image is malformed' };
const readableStore = () => Promise.resolve(readable);

async function fixture() {
  const data = join(base, 'data');
  const files = [
    'graphgoblin.db',
    'graphgoblin.db-wal',
    'graphgoblin.db-shm',
    'graphgoblin.db-journal',
    'artifacts/text/output',
    'workspaces/run-a/src/output',
    'workspaces/run-b/src/output',
    'workspaces/my-notes/keep',
    'master.key',
    'notes.txt',
  ];
  for (const file of files) {
    const path = join(data, file);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `original bytes of ${file}`);
  }
  return data;
}

async function reset(data: string, readStore: (file: string) => Promise<StoreFacts>) {
  let out = '';
  let err = '';
  const code = await runResetCli({
    argv: ['--reset', '--yes', '--data-dir', data],
    env: { GG_DATA_DIR: data },
    readStore,
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

async function assertRefused(
  data: string,
  readStore: (file: string) => Promise<StoreFacts>,
  cause: string,
) {
  const before = await snapshotTree(data);
  const result = await reset(data, readStore);
  expect.soft(result.code).toBe(1);
  expect.soft(result.out).toBe('');
  expect.soft(result.err).toContain('reset refused:');
  expect.soft(result.err).toContain(cause);
  expect.soft(result.err).toContain('run the reset again');
  expect.soft(result.err).toContain('Nothing in the data directory was changed.');
  // Includes every sidecar, artifact, run/user workspace, master.key and unrelated byte, and
  // proves the newly acquired lock was released. No filesystem API is mocked.
  expect(await snapshotTree(data)).toEqual(before);
}

describe('confirmed reset retains the run IDs until their workspaces can be removed', () => {
  it.each([
    'store reader exited with 1',
    'store reader timed out',
    'store reader exited with SIGKILL',
  ])('refuses before removal when only the locked read fails: %s', async (reason) => {
    const data = await fixture();
    let calls = 0;
    await assertRefused(
      data,
      async () => {
        calls += 1;
        // This is the existing public readStore dependency; check the actual lock boundary.
        expect(
          await access(join(data, 'graphgoblin.lock')).then(
            () => true,
            () => false,
          ),
        ).toBe(calls === 2);
        return calls === 1 ? readable : { readable: false, reason };
      },
      reason,
    );
    expect(calls).toBe(2);
    const retry = await reset(data, readableStore);
    expect(retry.code).toBe(0);
    expect(retry.err).toBe('');
    expect(retry.out).toContain('Reset complete.');
  });

  it('refuses when two readable plans would keep a previously identified run workspace', async () => {
    const data = await fixture();
    let calls = 0;
    await assertRefused(
      data,
      () =>
        Promise.resolve<StoreFacts>(
          ++calls === 1
            ? readable
            : {
                readable: true,
                runIds: ['run-a'],
              },
        ),
      'workspaces/run-b',
    );
  });

  it.each([false, true])(
    'still resets when the preview is unreadable (locked readable=%s)',
    async (lockedReadable) => {
      const data = await fixture();
      const workspacesBefore = await snapshotTree(join(data, 'workspaces'));
      let calls = 0;
      const result = await reset(data, () =>
        Promise.resolve(++calls === 2 && lockedReadable ? readable : unreadable),
      );
      expect(calls).toBe(2);
      expect(result.code).toBe(0);
      expect(result.err).toBe('');
      expect(result.out).toContain('Reset complete.');
      expect(result.out).toContain('removed graphgoblin.db');
      expect(result.out).toContain('removed artifacts');
      const remaining = await snapshotTree(data);
      expect(remaining.some((entry) => entry.path.startsWith('graphgoblin.'))).toBe(false);
      if (lockedReadable) {
        expect(await readdir(join(data, 'workspaces'))).toEqual(['my-notes']);
      } else {
        expect(result.out).toContain('the store could not be read to match run IDs');
        expect(await snapshotTree(join(data, 'workspaces'))).toEqual(workspacesBefore);
      }
      expect(await readFile(join(data, 'master.key'), 'utf8')).toBe('original bytes of master.key');
      expect(await readFile(join(data, 'notes.txt'), 'utf8')).toBe('original bytes of notes.txt');
    },
  );

  it('refuses after a real built copy owner is killed during the locked read', async () => {
    const data = await fixture();
    const seeded = join(base, 'seeded');
    await seedStores(seeded);
    const real = join(base, 'real');
    await copyStore(join(seeded, 'format-3'), real);
    for (const suffix of ['', '-wal'])
      await writeFile(
        join(data, 'graphgoblin.db' + suffix),
        await readFile(join(real, 'graphgoblin.db' + suffix)),
      );
    for (const [index, name] of ['run-a', 'run-b'].entries())
      await rename(
        join(data, 'workspaces', name),
        join(data, 'workspaces', SEEDED_RUN_IDS[index]!),
      );
    const temporary = join(base, 'temp');
    const unrelated = 'gg-reset-store-similar';
    await mkdir(join(temporary, unrelated));
    await writeFile(join(temporary, unrelated, 'keep.txt'), 'unrelated bytes');
    const reader = fileURLToPath(
      new URL('../../dist/reset/store-facts-reader.js', import.meta.url),
    );
    await access(reader);
    let calls = 0;
    let killed = false;
    await assertRefused(
      data,
      async (file) => {
        calls += 1;
        if (calls === 1) {
          const facts = await readStoreFacts(file, { readerArguments: [reader] });
          expect(facts.readable).toBe(true);
          return facts;
        }
        const child = spawn(process.execPath, [reader, file, String(process.pid)], {
          detached: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.resume();
        child.stderr.resume();
        const closed = once(child, 'close');
        try {
          await expect
            .poll(
              async () => {
                if (child.exitCode !== null)
                  throw new Error('Copy owner exited before interruption');
                for (const name of await readdir(temporary)) {
                  if (
                    await readFile(join(temporary, name, 'store.db')).then(
                      (bytes) => readFile(file).then((original) => bytes.equals(original)),
                      () => false,
                    )
                  )
                    return true;
                }
                return false;
              },
              { interval: 5, timeout: 20_000 },
            )
            .toBe(true);
          killed = child.kill('SIGKILL');
          expect(killed).toBe(true);
          const [code, signal] = await closed;
          return { readable: false, reason: `store reader exited with ${String(signal ?? code)}` };
        } finally {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await closed;
        }
      },
      'store reader exited with',
    );
    expect(killed).toBe(true);
    // Exercise the next-reset reaper after the owner kill; unrelated temp entries stay intact.
    await expect
      .poll(
        async () => {
          await cleanupStaleStoreCopies();
          return (await readdir(temporary)).filter(
            (name) => name.startsWith('gg-reset-store-') && name !== unrelated,
          );
        },
        { timeout: 20_000, interval: 100 },
      )
      .toEqual([]);
    expect(await readFile(join(temporary, unrelated, 'keep.txt'), 'utf8')).toBe('unrelated bytes');
  }, 240_000);
});

it.skipIf(process.platform !== 'win32')(
  'names a busy stale copy, gives recovery steps and limits the unchanged claim to the data directory',
  async () => {
    const data = await fixture();
    const temporary = join(base, 'temp');
    const stale = join(temporary, 'gg-reset-store-D3held');
    await mkdir(stale);
    for (const name of ['store.db', 'store.db-wal'])
      await writeFile(join(stale, name), 'private copy bytes');
    await writeFile(
      join(stale, 'owner.json'),
      JSON.stringify({
        kind: 'graphgoblin-reset-store',
        pid: 2147483647,
        identity: await identityOf(stale),
      }),
    );
    const holder = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$f = [System.IO.File]::Open($env:GG_D3_HELD_FILE, "Open", "Read", "None"); [Console]::Out.WriteLine("HELD"); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()',
      ],
      {
        env: { ...process.env, GG_D3_HELD_FILE: join(stale, 'store.db-wal') },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let output = '';
    holder.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    holder.stderr.resume();
    const closed = once(holder, 'close');
    try {
      await expect.poll(() => output, { timeout: 20_000 }).toContain('HELD');
      await assertRefused(data, readableStore, `stale private reset copy ${stale}`);
      const result = await reset(data, readableStore);
      expect(result.err.split('\n')).toHaveLength(3);
      expect(result.err).toContain('Close the program holding its files');
      expect(result.err).not.toContain('EBUSY');
      expect(await readFile(join(stale, 'owner.json'), 'utf8')).toContain(
        'graphgoblin-reset-store',
      );
    } finally {
      holder.stdin.end('\n');
      await closed;
    }
    await delay(10);
    expect((await reset(data, readableStore)).code).toBe(0);
    expect(await readdir(temporary)).toEqual([]);
  },
  60_000,
);
