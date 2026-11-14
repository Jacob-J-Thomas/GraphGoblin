import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writePluginOutput } from './plugin-output.mjs';

vi.mock('node:fs/promises', async (load) => {
  const actual = await load();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const inventory = '.graphgoblin-plugin-output.json';

describe('generated plugin output', () => {
  let scratch;
  let options;

  beforeEach(async () => {
    scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg-plugin-漢 '));
    const packageDir = join(scratch, 'package');
    const defaultOutDir = join(packageDir, 'dist', 'marketplace');
    const source = join(packageDir, 'source');
    await mkdir(source, { recursive: true });
    const entry = join(scratch, 'mcp', 'dist', 'main.js');
    await mkdir(join(scratch, 'mcp', 'dist'), { recursive: true });
    await writeFile(entry, '');
    options = {
      packageDir,
      defaultOutDir,
      outDir: defaultOutDir,
      protectedPaths: [source, entry],
      kind: 'test-plugin',
      files: { 'plugin/manifest.json': 'original', '.mcp.json': 'mcp config' },
    };
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('publishes into a clean destination and refreshes owned files on rebuild', async () => {
    expect(await writePluginOutput(options)).toBe(options.outDir);
    await writePluginOutput({
      ...options,
      files: { ...options.files, 'plugin/manifest.json': new Uint8Array([65, 66]) },
    });
    expect(await readFile(join(options.outDir, 'plugin', 'manifest.json'), 'utf8')).toBe('AB');
    const explicit = join(scratch, 'empty output');
    await mkdir(explicit);
    await writePluginOutput({ ...options, outDir: explicit });
    expect(await readdir(explicit)).toContain(inventory);
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
  });

  it('protects roots, working directory, package and input paths', async () => {
    const [source, entry] = options.protectedPaths;
    for (const path of [
      parse(scratch).root,
      process.cwd(),
      options.packageDir,
      join(options.packageDir, 'other'),
      source,
      join(source, 'new'),
      join(scratch, 'mcp', 'dist'),
      entry,
    ]) {
      await expect(writePluginOutput({ ...options, outDir: path })).rejects.toThrow(
        /Unsafe plugin output destination.*overlaps/,
      );
    }
    const file = join(scratch, 'not-a-directory');
    await writeFile(file, 'owner file');
    await expect(writePluginOutput({ ...options, outDir: file })).rejects.toThrow(
      /not a directory/,
    );
    expect(await readFile(file, 'utf8')).toBe('owner file');
  });

  it('refuses a linked target and an output with a linked ancestor', async () => {
    const target = join(scratch, 'foreign');
    const linked = join(scratch, 'redirected');
    await mkdir(target);
    await writeFile(join(target, 'sentinel'), 'keep');
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    for (const outDir of [linked, join(linked, 'child')]) {
      await expect(writePluginOutput({ ...options, outDir })).rejects.toThrow(/link/);
    }
    expect(await readdir(target)).toEqual(['sentinel']);
  });

  it.runIf(process.platform === 'win32')(
    'refuses ambiguous Windows names below missing parents',
    async () => {
      for (const name of ['trailing.', 'NUL.out', 'directory:stream']) {
        const outDir = join(scratch, 'missing', name);
        await expect(writePluginOutput({ ...options, outDir })).rejects.toThrow(
          /ambiguous Windows path/,
        );
      }
    },
  );

  it('uses the closest physical parent for missing build inputs', async () => {
    const mcpEntry = join(scratch, 'not built', 'main.js');
    const inputIsMissing = { ...options, protectedPaths: [mcpEntry] };
    await expect(writePluginOutput(inputIsMissing)).resolves.toBe(options.outDir);
    const inputDirectory = join(scratch, 'not built');
    await expect(writePluginOutput({ ...inputIsMissing, outDir: inputDirectory })).rejects.toThrow(
      /overlaps/,
    );
  });

  it('preserves foreign files even when the marker is made to list them', async () => {
    const outDir = options.outDir;
    await writePluginOutput(options);
    const marker = join(outDir, inventory);
    const ownership = JSON.parse(await readFile(marker, 'utf8'));
    const sentinel = join(outDir, 'foreign.txt');
    await writeFile(sentinel, 'sentinel bytes');
    await expect(writePluginOutput(options)).rejects.toThrow(/foreign.txt.*not owned/);

    await unlink(join(outDir, '.mcp.json'));
    delete ownership.files['.mcp.json'];
    ownership.files['foreign.txt'] = createHash('sha256').update('sentinel bytes').digest('hex');
    await writeFile(marker, JSON.stringify(ownership));
    await expect(writePluginOutput(options)).rejects.toThrow(/foreign.txt.*not owned/);
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel bytes');
  });

  it.each([
    ['unmarked output', async (outDir) => unlink(join(outDir, inventory))],
    ['malformed marker', async (outDir) => writeFile(join(outDir, inventory), '{')],
    ['null marker', async (outDir) => writeFile(join(outDir, inventory), 'null')],
    [
      'wrong builder',
      async (outDir) =>
        writeFile(join(outDir, inventory), JSON.stringify({ format: 1, kind: 'other' })),
    ],
    [
      'incomplete inventory',
      async (outDir) =>
        writeFile(
          join(outDir, inventory),
          JSON.stringify({ format: 1, kind: 'test-plugin', files: {} }),
        ),
    ],
    [
      'modified content',
      async (outDir) => writeFile(join(outDir, '.mcp.json'), 'important change'),
    ],
    ['missing content', async (outDir) => unlink(join(outDir, '.mcp.json'))],
    ['unexpected folder', async (outDir) => mkdir(join(outDir, 'foreign'))],
  ])('refuses %s and preserves the original artifact', async (_label, damage) => {
    await writePluginOutput(options);
    await damage(options.outDir);
    await expect(writePluginOutput(options)).rejects.toThrow(/Unsafe plugin output destination/);
    expect(await readFile(join(options.outDir, 'plugin', 'manifest.json'), 'utf8')).toBe(
      'original',
    );
  });

  it('restores the incumbent if publication fails after moving it', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    fs.rename.mockImplementationOnce(rename);
    fs.rename.mockRejectedValueOnce(new Error('instrumented publish failure'));
    await expect(writePluginOutput(options)).rejects.toThrow(/instrumented publish failure/);
    expect(await readFile(join(options.outDir, '.mcp.json'), 'utf8')).toBe('mcp config');
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
  });

  it('restores a moved tree if its post-move ownership check fails', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    fs.rename.mockImplementationOnce(async (source, target) => {
      await rename(source, target);
      await writeFile(join(target, 'foreign'), 'arrived during rename');
    });
    await expect(writePluginOutput(options)).rejects.toThrow(/foreign.*not owned/);
    expect(await readFile(join(options.outDir, 'foreign'), 'utf8')).toBe('arrived during rename');
  });

  it.runIf(process.platform === 'win32')(
    'preserves a Windows stream arriving during quarantine',
    async () => {
      await writePluginOutput(options);
      const { rename } = await vi.importActual('node:fs/promises');
      fs.rename.mockImplementationOnce(async (source, target) => {
        await rename(source, target);
        await writeFile(join(target, '.mcp.json') + ':owner-stream', 'arrived during quarantine');
      });
      await expect(writePluginOutput(options)).rejects.toThrow(/alternate data stream found/);
      expect(await readFile(join(options.outDir, '.mcp.json') + ':owner-stream', 'utf8')).toBe(
        'arrived during quarantine',
      );
      expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
    },
  );

  it('leaves the prior output staged when another party recreates the destination', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    fs.rename.mockImplementationOnce(rename);
    fs.rename.mockImplementationOnce(async (_source, target) => {
      await mkdir(target);
      await writeFile(join(target, 'foreign'), 'new owner contents');
      throw new Error('instrumented publish conflict');
    });
    await expect(writePluginOutput(options)).rejects.toThrow(/instrumented publish conflict/);
    expect(await readFile(join(options.outDir, 'foreign'), 'utf8')).toBe('new owner contents');
    const previous = join(options.packageDir, 'dist', '.marketplace.graphgoblin-build', 'previous');
    expect(await readFile(join(previous, '.mcp.json'), 'utf8')).toBe('mcp config');
  });

  it('serializes writes and preserves a staging directory from an interrupted build', async () => {
    await mkdir(join(options.packageDir, 'dist'));
    const lock = join(options.packageDir, 'dist', '.marketplace.graphgoblin-build');
    await mkdir(lock);
    await writeFile(join(lock, 'sentinel'), 'preserve');
    await expect(writePluginOutput(options)).rejects.toThrow(/another build is using/);
    expect(await readFile(join(lock, 'sentinel'), 'utf8')).toBe('preserve');

    const outDir = join(scratch, 'concurrent');
    const attempts = await Promise.allSettled([
      writePluginOutput({ ...options, outDir }),
      writePluginOutput({ ...options, outDir }),
    ]);
    expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true);
    expect(attempts.find((attempt) => attempt.status === 'rejected')?.reason.message).toMatch(
      /another build is using/,
    );
    await writePluginOutput({ ...options, outDir });
  });

  it('rejects path traversal and reserved generated names before writing', async () => {
    for (const name of ['../elsewhere', '/absolute', inventory]) {
      await expect(writePluginOutput({ ...options, files: { [name]: 'x' } })).rejects.toThrow(
        /Invalid generated plugin file name/,
      );
    }
  });
});
