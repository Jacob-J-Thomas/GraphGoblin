import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { copyCatalog } from './catalog-package.js';
import { TemplateCatalog } from './catalog.js';

const source = fileURLToPath(new URL('../../templates', import.meta.url));
const expected = [
  'catalog.json',
  ...['implementation', 'qa', 'review', 'starter'].flatMap((id) => [
    `${id}/draft.json`,
    `${id}/manifest.json`,
  ]),
].sort();

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? (await files(join(root, entry.name))).map((file) => `${entry.name}/${file}`)
          : [entry.name],
      ),
    )
  )
    .flat()
    .sort();
}

async function temporaryRoot(): Promise<string> {
  const temporary = fileURLToPath(new URL('../../.tmp/', import.meta.url));
  await mkdir(temporary, { recursive: true });
  return realpath(await mkdtemp(join(temporary, 'catalog-package-')));
}

it('ships only declared starting-point assets and removes stale files on rebuild', async () => {
  const root = await temporaryRoot();
  try {
    const input = join(root, 'source');
    const target = join(root, 'dist');
    await cp(source, input, { recursive: true });
    await mkdir(join(target, 'qa'), { recursive: true });
    await writeFile(join(target, 'qa', 'adversary.json'), 'obsolete graph');
    await writeFile(join(input, 'qa', 'parent.json'), 'unreferenced graph');
    await writeFile(join(input, 'qa', 'executor.md'), 'unreferenced prompt');
    await copyCatalog(input, target);
    expect(await files(source)).toEqual(expected);
    expect(await files(target)).toEqual(expected);
    const entries = await new TemplateCatalog(target).list();
    expect(entries).toEqual(await new TemplateCatalog(source).list());
    for (const file of expected)
      expect(await readFile(join(target, file))).toEqual(await readFile(join(source, file)));
    await writeFile(join(target, 'starter', 'loop.json'), 'stale graph');
    await copyCatalog(input, target);
    expect(await files(target)).toEqual(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['root', 'ancestor', 'entry'] as const)(
  'refuses a linked target %s without touching files beyond the link',
  async (kind) => {
    const root = await temporaryRoot();
    try {
      const outside = join(root, 'unrelated');
      const protectedDirectory = join(outside, 'catalog');
      await mkdir(protectedDirectory, { recursive: true });
      const sentinel = join(protectedDirectory, 'keep.json');
      await writeFile(sentinel, 'preserve unrelated files');
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      let link: string;
      let target: string;
      if (kind === 'ancestor') {
        link = join(root, 'alias');
        await symlink(outside, link, linkType);
        target = join(link, 'catalog');
      } else if (kind === 'root') {
        link = target = join(root, 'target');
        await symlink(protectedDirectory, link, linkType);
      } else {
        target = join(root, 'target');
        await mkdir(join(target, 'nested'), { recursive: true });
        link = join(target, 'nested', 'linked');
        await symlink(protectedDirectory, link, linkType);
      }
      await expect(copyCatalog(source, target)).rejects.toThrow(
        kind === 'entry'
          ? 'Catalogue target links are not permitted.'
          : 'The catalogue target must be a canonical directory.',
      );
      expect(await readFile(sentinel, 'utf8')).toBe('preserve unrelated files');
      expect(await files(outside)).toEqual(['catalog/keep.json']);
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
