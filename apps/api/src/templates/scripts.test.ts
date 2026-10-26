import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { TemplateCatalog } from './catalog.js';

const source = fileURLToPath(new URL('../../templates', import.meta.url));
async function gate(input?: string) {
  const previous = process.argv;
  process.argv = [process.execPath, 'check-templates.mjs', ...(input ? [input] : [])];
  try {
    vi.resetModules();
    await import('../../scripts/check-templates.mjs');
  } finally {
    process.argv = previous;
  }
}
async function copy(input: string, output: string) {
  const previous = process.argv;
  process.argv = [process.execPath, 'copy-catalog.ts', input, output];
  try {
    vi.resetModules();
    await import('./copy-catalog.js');
  } finally {
    process.argv = previous;
  }
}

it('template gate validates shipped drafts and refuses both broken graphs and undeclared assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-templates-'));
  const input = join(root, 'templates');
  await cp(source, input, { recursive: true });
  await expect(gate(input)).resolves.toBeUndefined();
  const draftPath = join(input, 'starter/draft.json');
  const original = await readFile(draftPath, 'utf8');
  const draft: { loop: { edges: { to: { node: string } }[] } } = JSON.parse(original);
  draft.loop.edges[0]!.to.node = 'missing';
  await writeFile(draftPath, JSON.stringify(draft));
  await expect(gate(input)).rejects.toThrow();
  await writeFile(draftPath, original);
  await writeFile(join(input, 'unlisted.json'), '{}');
  await expect(gate(input)).rejects.toThrow('Only the catalogue');
  expect(await readFile(join(input, 'unlisted.json'), 'utf8')).toBe('{}');
});

it('catalog build entry copies independent drafts and refuses an invalid source without damaging an existing catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-copy-catalog-'));
  const target = join(root, 'catalog');
  await copy(source, target);
  const catalog = new TemplateCatalog(target);
  expect((await catalog.list()).map(({ manifest }) => manifest.id).sort()).toEqual([
    'implementation',
    'qa',
    'review',
    'starter',
  ]);
  const before = await readFile(join(target, 'catalog.json'), 'utf8');
  await expect(copy(join(root, 'missing'), target)).rejects.toThrow();
  expect(await readFile(join(target, 'catalog.json'), 'utf8')).toBe(before);
});

it('template gate validates the shipped catalogue when no input override is supplied', async () => {
  await expect(gate()).resolves.toBeUndefined();
});
