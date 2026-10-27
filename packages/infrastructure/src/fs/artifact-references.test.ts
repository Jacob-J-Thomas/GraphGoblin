import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FsArtifactStore } from './artifacts.js';

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('resolves only the exact canonical artifact spelling returned by put', async () => {
  directory = await mkdtemp(join(tmpdir(), 'gg-wp-e3-'));
  const store = new FsArtifactStore(directory);
  const { ref } = await store.put('Transcript', 'canonical content');
  expect(await store.get(ref)).toBe('canonical content');
  const [kind, hash] = ref.slice(9).split('/');
  for (const alternative of [
    ref.toUpperCase(),
    ref.replace('artifact:', 'Artifact:'),
    `artifact:${kind!.toUpperCase()}/${hash}`,
    `artifact:${kind}/${hash!.toUpperCase()}`,
    ref + '\n',
    ref + '\r\n',
    ref + '\u0000',
    ref + ' ',
    ref.replace('/', '\\'),
    ref.replace('/', '//'),
    ref.replace('/', '/./'),
    ref.replace('/', '/../transcript/'),
    ref.replace('transcript', '%74ranscript'),
  ])
    expect(await store.get(alternative), alternative).toBeUndefined();
});
