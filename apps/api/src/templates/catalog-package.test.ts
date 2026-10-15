import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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

it('ships only declared starting-point assets and removes stale files on rebuild', async () => {
  const temporary = fileURLToPath(new URL('../../.tmp/', import.meta.url));
  await mkdir(temporary, { recursive: true });
  const root = await mkdtemp(join(temporary, 'catalog-package-'));
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
});
