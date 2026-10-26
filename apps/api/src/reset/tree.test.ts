import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listEntry, removeEntry, statEntry } from './tree.js';

const bases: string[] = [];
afterEach(async () => {
  for (const base of bases.splice(0)) await rm(base, { recursive: true, force: true });
});

const linkDirectory = (target: string, path: string) =>
  symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-rid-tree-'));
  bases.push(base);
  const root = join(base, 'data');
  const outside = join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, 'graphgoblin.db'), 'outside bytes');
  return { base, root, outside };
}

describe('planned filesystem identities', () => {
  it('refuses a same-kind file replacement and preserves both files', async () => {
    const { base, root, outside } = await fixture();
    const file = join(root, 'graphgoblin.db');
    await writeFile(file, 'planned bytes');
    const entry = (await statEntry(root, 'graphgoblin.db'))!;
    await rename(file, join(base, 'original.db'));
    await writeFile(file, 'replacement bytes');
    const error = await removeEntry(root, entry).catch((error: unknown) => error);
    expect.soft(error).toBeInstanceOf(Error);
    expect.soft(String(error)).toContain('graphgoblin.db was replaced during the reset');
    expect.soft(await readFile(file, 'utf8').catch(() => 'missing')).toBe('replacement bytes');
    expect(await readFile(join(base, 'original.db'), 'utf8')).toBe('planned bytes');
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside bytes');
  });

  it.each(['directory', 'link'] as const)('refuses a root replaced by a %s', async (kind) => {
    const { base, root, outside } = await fixture();
    await writeFile(join(root, 'graphgoblin.db'), 'planned bytes');
    const entry = (await statEntry(root, 'graphgoblin.db'))!;
    await rename(root, join(base, 'original'));
    if (kind === 'link') await linkDirectory(outside, root);
    else {
      await mkdir(root);
      await writeFile(join(root, 'graphgoblin.db'), 'replacement bytes');
    }
    const error = await removeEntry(root, entry).catch((error: unknown) => error);
    expect
      .soft(String(error))
      .toContain(
        `graphgoblin.db: data-directory root ${kind === 'link' ? 'is now a link' : 'was replaced'} during the reset`,
      );
    expect
      .soft(await readFile(join(root, 'graphgoblin.db'), 'utf8').catch(() => 'missing'))
      .toBe(kind === 'link' ? 'outside bytes' : 'replacement bytes');
    expect(await readFile(join(base, 'original', 'graphgoblin.db'), 'utf8')).toBe('planned bytes');
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8').catch(() => 'missing')).toBe(
      'outside bytes',
    );
  });

  it.each(['directory', 'link'] as const)(
    'refuses a kept ancestor replaced by a %s',
    async (kind) => {
      const { base, root, outside } = await fixture();
      const folder = join(root, 'database');
      await mkdir(folder);
      await writeFile(join(folder, 'graphgoblin.db'), 'planned bytes');
      const entry = (await statEntry(root, 'database/graphgoblin.db'))!;
      await rename(folder, join(base, 'original'));
      if (kind === 'link') await linkDirectory(outside, folder);
      else {
        await mkdir(folder);
        await writeFile(join(folder, 'graphgoblin.db'), 'replacement bytes');
      }
      const error = await removeEntry(root, entry).catch((error: unknown) => error);
      expect
        .soft(String(error))
        .toContain(
          `database/graphgoblin.db: ancestor database ${kind === 'link' ? 'is now a link' : 'was replaced'} during the reset`,
        );
      expect
        .soft(await readFile(join(folder, 'graphgoblin.db'), 'utf8').catch(() => 'missing'))
        .toBe(kind === 'link' ? 'outside bytes' : 'replacement bytes');
      expect(await readFile(join(base, 'original', 'graphgoblin.db'), 'utf8')).toBe(
        'planned bytes',
      );
      expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside bytes');
    },
  );

  it('refuses a planned directory replaced by a different empty directory', async () => {
    const { base, root, outside } = await fixture();
    await mkdir(join(root, 'artifacts'));
    const entry = (await statEntry(root, 'artifacts'))!;
    await rename(join(root, 'artifacts'), join(base, 'original'));
    await mkdir(join(root, 'artifacts'));
    const error = await removeEntry(root, entry).catch((error: unknown) => error);
    expect.soft(String(error)).toContain('artifacts was replaced during the reset');
    expect
      .soft(
        await lstat(join(root, 'artifacts')).then(
          (s) => s.isDirectory(),
          () => false,
        ),
      )
      .toBe(true);
    expect((await lstat(join(base, 'original'))).isDirectory()).toBe(true);
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside bytes');
  });

  it('removes an unchanged tree, including a link itself, and preserves the outside bytes', async () => {
    const { root, outside } = await fixture();
    await mkdir(join(root, 'artifacts', 'nested'), { recursive: true });
    await writeFile(join(root, 'artifacts', 'nested', 'body'), 'planned bytes');
    await linkDirectory(outside, join(root, 'artifacts', 'link'));
    const entries = await listEntry(root, 'artifacts');
    for (const entry of entries) await removeEntry(root, entry);
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(join(outside, 'graphgoblin.db'), 'utf8')).toBe('outside bytes');
  });
});
