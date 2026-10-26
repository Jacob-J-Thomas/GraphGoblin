import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyStore, seedStores, snapshotTree } from './__fixtures__/stores.js';
import { identityOf } from './tree.js';

const main = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
let base: string;
beforeAll(async () => {
  await access(main);
  base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-qafix-copy-'));
  await seedStores(join(base, 'seeded'));
}, 240_000);
afterAll(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function until<T>(read: () => Promise<T | undefined>, timeout = 60_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for real reset process state');
    await delay(5);
  }
}
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('reset private-copy ownership across process death', () => {
  it('reaps a marked dead owner on the next reset and preserves live and unrelated directories', async () => {
    const temporary = join(base, 'stale-temp');
    await mkdir(temporary);
    const stale = join(temporary, 'gg-reset-store-STALE1');
    const live = join(temporary, 'gg-reset-store-ALIVE1');
    const unrelated = join(temporary, 'gg-reset-store-OTHER1');
    for (const directory of [stale, live, unrelated]) {
      await mkdir(directory);
      await writeFile(join(directory, 'store.db'), 'copy bytes');
    }
    for (const [directory, pid] of [
      [stale, 2147483647],
      [live, process.pid],
    ] as const)
      await writeFile(
        join(directory, 'owner.json'),
        JSON.stringify({
          kind: 'graphgoblin-reset-store',
          pid,
          identity: await identityOf(directory),
        }),
      );
    const preserved = await snapshotTree(live);
    const other = await snapshotTree(unrelated);
    const env = {
      ...process.env,
      GG_DATA_DIR: join(base, 'absent'),
      TEMP: temporary,
      TMP: temporary,
      TMPDIR: temporary,
    };
    const child = spawn(process.execPath, [main, '--reset'], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.resume();
    child.stderr.resume();
    const [code] = await once(child, 'close');
    expect(code).toBe(0);
    expect
      .soft(
        await access(stale).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    expect(await snapshotTree(live)).toEqual(preserved);
    expect(await snapshotTree(unrelated)).toEqual(other);
  }, 60_000);

  it.each([false, true])(
    'cleans a copy after a killed reset (confirmed=%s)',
    async (confirmed) => {
      const fixture = join(base, String(confirmed));
      const data = join(fixture, 'data');
      const temporary = join(fixture, 'temp');
      await copyStore(join(base, 'seeded', 'format-3'), data);
      await mkdir(temporary);
      const unrelated = join(temporary, 'gg-reset-store-ABCDEF');
      await mkdir(unrelated);
      await writeFile(join(unrelated, 'keep.txt'), 'unrelated bytes');
      const before = await snapshotTree(data);
      const original = hash(await readFile(join(data, 'graphgoblin.db')));
      const env: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
      );
      Object.assign(env, {
        GG_DATA_DIR: data,
        GG_WEB_DIST: '',
        GG_LOG_LEVEL: 'warn',
        TMP: temporary,
        TEMP: temporary,
        TMPDIR: temporary,
      });
      const args = ['--reset', ...(confirmed ? ['--yes', '--data-dir', data] : [])];
      const child = spawn(process.execPath, [main, ...args], {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (c) => {
        output += String(c);
      });
      child.stderr.on('data', (c) => {
        output += String(c);
      });
      const exited = once(child, 'exit');
      try {
        await until(async () => {
          if (child.exitCode !== null)
            throw new Error(`Reset exited before interruption: ${output}`);
          if (
            confirmed &&
            !(await access(join(data, 'graphgoblin.lock')).then(
              () => true,
              () => false,
            ))
          )
            return;
          for (const name of await readdir(temporary)) {
            if (!name.startsWith('gg-reset-store-') || name === 'gg-reset-store-ABCDEF') continue;
            const file = join(temporary, name, 'store.db');
            if (
              await readFile(file).then(
                (bytes) => hash(bytes) === original,
                () => false,
              )
            )
              return file;
          }
        });
        // Real TerminateProcess via Node, never taskkill or a simulated interruption.
        expect(child.kill('SIGKILL')).toBe(true);
        await exited;
        const copies = () =>
          readdir(temporary).then((names) =>
            names.filter((n) => n.startsWith('gg-reset-store-') && n !== 'gg-reset-store-ABCDEF'),
          );
        await expect
          .poll(copies, { timeout: 20_000, interval: 50 })
          .toEqual([])
          .catch(async (error: unknown) => {
            for (const name of await copies()) {
              const directory = join(temporary, name);
              const marker = await readFile(join(directory, 'owner.json'), 'utf8').catch(
                () => 'no marker',
              );
              const owner: unknown = JSON.parse(marker === 'no marker' ? '{}' : marker);
              const pid =
                typeof owner === 'object' &&
                owner !== null &&
                'pid' in owner &&
                typeof owner.pid === 'number'
                  ? owner.pid
                  : undefined;
              let live = false;
              if (pid !== undefined) {
                try {
                  process.kill(pid, 0);
                  live = true;
                } catch {
                  /* dead */
                }
              }
              console.error('interrupted reset copy', {
                files: await readdir(directory),
                marker,
                live,
                output,
              });
            }
            throw error;
          });
        expect(await readFile(join(unrelated, 'keep.txt'), 'utf8')).toBe('unrelated bytes');
        const after = await snapshotTree(data);
        expect(after.filter((r) => r.path !== 'graphgoblin.lock')).toEqual(
          before.filter((r) => r.path !== 'graphgoblin.lock'),
        );
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
      }
    },
    120_000,
  );
});
