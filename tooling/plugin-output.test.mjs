import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as metadata from './plugin-output-metadata.mjs';
import { checkSourceInventory, writePluginOutput } from './plugin-output.mjs';

vi.mock('node:fs/promises', async (load) => {
  const actual = await load();
  return {
    ...actual,
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    unlink: vi.fn(actual.unlink),
  };
});
vi.mock('./plugin-output-metadata.mjs', async (load) => {
  const actual = await load();
  return { ...actual, openOutputMetadataCheck: vi.fn(actual.openOutputMetadataCheck) };
});

const inventory = '.graphgoblin-plugin-output.json';
const moveAside = /Choose an unused destination, or inspect this directory and move it aside/;

/** Every entry below `dir` with its bytes, to show a refusal left a tree exactly as it was. */
async function snapshot(dir) {
  const tree = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    tree[relative(dir, path).split(sep).join('/')] = entry.isFile()
      ? await readFile(path, 'utf8')
      : 'folder';
  }
  return tree;
}

async function rewriteMarker(outDir, change) {
  const marker = join(outDir, inventory);
  await writeFile(marker, JSON.stringify(change(JSON.parse(await readFile(marker, 'utf8')))));
}

/** Open the next staged file for real, then fail its write, its completed close, or both. */
async function failStagedFile({ write, close }) {
  const actual = await vi.importActual('node:fs/promises');
  fs.open.mockImplementationOnce(async (path, flags) => {
    const handle = await actual.open(path, flags);
    const { writeFile: writeHandle, close: closeHandle } = handle;
    return Object.assign(handle, {
      writeFile: write ? async () => Promise.reject(write) : writeHandle,
      async close() {
        await closeHandle.call(handle);
        if (close) throw close;
      },
    });
  });
}

describe('generated plugin output', () => {
  let scratch;
  let options;
  let lock;
  let previous;
  let next;

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
    lock = join(packageDir, 'dist', '.marketplace.graphgoblin-build');
    previous = join(lock, 'previous');
    next = join(lock, 'next');
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
    const sentinel = join(outDir, 'foreign.txt');
    await writeFile(sentinel, 'sentinel bytes');
    await expect(writePluginOutput(options)).rejects.toThrow(
      /"foreign.txt" is not owned by this builder\. Choose an unused destination, or inspect/,
    );

    // The same number of names, one exchanged: a marker never makes an unrelated file owned.
    await unlink(join(outDir, '.mcp.json'));
    await rewriteMarker(outDir, (ownership) => {
      delete ownership.files['.mcp.json'];
      ownership.files['foreign.txt'] = createHash('sha256').update('sentinel bytes').digest('hex');
      return ownership;
    });
    await expect(writePluginOutput(options)).rejects.toThrow(
      /listed only by the marker: "foreign.txt"; generated now but not listed: ".mcp.json"\)\. The builder verifies and replaces only its current inventory and never removes entries named only by a marker/,
    );
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel bytes');
  });

  it.each([
    [
      'an earlier inventory with an extra file',
      { 'plugin/manifest.json': 'original', '.mcp.json': 'mcp config', 'plugin/old.json': '' },
      /\(listed only by the marker: "plugin\/old.json"\)/,
    ],
    [
      'an earlier inventory without a current file',
      { 'plugin/manifest.json': 'original' },
      /\(generated now but not listed: ".mcp.json"\)/,
    ],
    [
      'an equal number of different names',
      { 'plugin/manifest.json': 'original', 'config.json': 'mcp config' },
      /\(listed only by the marker: "config.json"; generated now but not listed: ".mcp.json"\)/,
    ],
  ])('names a changed inventory for %s and keeps the output', async (_label, earlier, names) => {
    await writePluginOutput({ ...options, files: earlier });
    const before = await snapshot(options.outDir);
    const refusal = await writePluginOutput(options).catch((error) => error);
    expect(refusal.message).toMatch(
      `Unsafe plugin output destination "${options.outDir}": its ownership marker from this builder lists a different file inventory`,
    );
    expect(refusal.message).toMatch(names);
    expect(refusal.message).toMatch(/Inspect this directory and move it aside/);
    expect(await snapshot(options.outDir)).toEqual(before);
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
  });

  it('only quotes marker names, never reading or removing them, and bounds the list', async () => {
    await writePluginOutput(options);
    const outside = join(options.packageDir, 'dist', 'outside.txt');
    await writeFile(outside, 'unrelated');
    const names = [
      '../outside.txt',
      'line\nbreak',
      ...Array.from({ length: 10 }, (_, i) => `x${i}`),
    ];
    await rewriteMarker(options.outDir, (ownership) => ({
      ...ownership,
      files: Object.fromEntries(names.map((name) => [name, 'digest'])),
    }));
    const before = await snapshot(options.outDir);
    const refusal = await writePluginOutput(options).catch((error) => error);
    expect(refusal.message).toContain(
      'listed only by the marker: "../outside.txt", "line\\nbreak", "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7", and 2 more;',
    );
    expect(await readFile(outside, 'utf8')).toBe('unrelated');
    expect(await snapshot(options.outDir)).toEqual(before);
  });

  const invalidMarker =
    /"\.graphgoblin-plugin-output\.json" is missing or is not a valid ownership marker from this builder, so the other entries are not known to be generated/;
  it.each([
    ['unmarked output', async (outDir) => unlink(join(outDir, inventory)), invalidMarker],
    ['malformed marker', async (outDir) => writeFile(join(outDir, inventory), '{'), invalidMarker],
    ['null marker', async (outDir) => writeFile(join(outDir, inventory), 'null'), invalidMarker],
    [
      'other format',
      async (outDir) => rewriteMarker(outDir, (marker) => ({ ...marker, format: 2 })),
      invalidMarker,
    ],
    [
      'wrong builder',
      async (outDir) => rewriteMarker(outDir, (marker) => ({ ...marker, kind: 'other' })),
      invalidMarker,
    ],
    [
      'marker without an inventory',
      async (outDir) => rewriteMarker(outDir, ({ format, kind }) => ({ format, kind })),
      invalidMarker,
    ],
    [
      'inventory list instead of digests',
      async (outDir) =>
        rewriteMarker(outDir, (marker) => ({ ...marker, files: Object.keys(marker.files) })),
      invalidMarker,
    ],
    [
      'modified content',
      async (outDir) => writeFile(join(outDir, '.mcp.json'), 'important change'),
      /"\.mcp\.json" does not match the content this builder recorded for it/,
    ],
    [
      'unexpected folder',
      async (outDir) => mkdir(join(outDir, 'foreign')),
      /"foreign" is not owned by this builder/,
    ],
    [
      'file in place of a generated folder',
      async (outDir) => {
        await rm(join(outDir, 'plugin'), { recursive: true });
        await writeFile(join(outDir, 'plugin'), 'owner file');
      },
      /"plugin" is not owned by this builder/,
    ],
    [
      'missing content',
      async (outDir) => unlink(join(outDir, '.mcp.json')),
      /expected generated entries are missing: "\.mcp\.json"\./,
    ],
    [
      'missing generated folder',
      async (outDir) => rm(join(outDir, 'plugin'), { recursive: true }),
      /expected generated entries are missing: "plugin"\./,
    ],
  ])(
    'refuses %s with its own diagnostic and preserves the artifact',
    async (_l, damage, reason) => {
      await writePluginOutput(options);
      await damage(options.outDir);
      const before = await snapshot(options.outDir);
      const refusal = await writePluginOutput(options).catch((error) => error);
      expect(refusal.message).toMatch(`Unsafe plugin output destination "${options.outDir}": `);
      expect(refusal.message).toMatch(reason);
      expect(refusal.message).toMatch(moveAside);
      expect(refusal.message).not.toMatch(/ENOENT/);
      expect(await snapshot(options.outDir)).toEqual(before);
      expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
    },
  );

  it('restores the incumbent if publication fails after moving it', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    const failure = new Error('instrumented publish failure');
    fs.rename.mockImplementationOnce(rename);
    fs.rename.mockRejectedValueOnce(failure);
    // With the prior output restored and staging removed, the primary failure is unchanged.
    await expect(writePluginOutput(options)).rejects.toBe(failure);
    expect(await readFile(join(options.outDir, '.mcp.json'), 'utf8')).toBe('mcp config');
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
  });

  it('keeps the primary failure and the prior output when its restore also fails', async () => {
    await writePluginOutput(options);
    const before = await snapshot(options.outDir);
    const { rename } = await vi.importActual('node:fs/promises');
    const publish = new Error('instrumented publish failure');
    const restore = new Error('instrumented restore failure');
    fs.rename
      .mockImplementationOnce(rename)
      .mockRejectedValueOnce(publish)
      .mockRejectedValueOnce(restore);
    const files = { ...options.files, '.mcp.json': 'new config' };
    const error = await writePluginOutput({ ...options, files }).catch((reason) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(publish);
    expect(error.errors).toEqual([publish, restore]);
    expect(error.message).toBe(
      `instrumented publish failure. Cleanup also failed: instrumented restore failure. The previous output was not restored and remains at "${previous}"; inspect it and "${options.outDir}" before moving either by hand. Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
    // The failed restore did not stop the independent removal of the unpublished tree.
    expect(await readdir(lock)).toEqual(['previous']);
    expect(await snapshot(previous)).toEqual(before);
    await expect(readdir(options.outDir)).rejects.toMatchObject({ code: 'ENOENT' });

    // The stated recovery restores the prior output, after which an ordinary rebuild succeeds.
    await rename(previous, options.outDir);
    await rmdir(lock);
    expect(await snapshot(options.outDir)).toEqual(before);
    await writePluginOutput({ ...options, files });
    expect(await readFile(join(options.outDir, '.mcp.json'), 'utf8')).toBe('new config');
  });

  it('reports an unpublished staged tree that it could not remove', async () => {
    await writePluginOutput(options);
    const before = await snapshot(options.outDir);
    const { rename } = await vi.importActual('node:fs/promises');
    const publish = new Error('instrumented publish failure');
    const cleanup = new Error('instrumented cleanup failure');
    fs.rename.mockImplementationOnce(rename).mockRejectedValueOnce(publish);
    fs.unlink.mockRejectedValueOnce(cleanup);
    const error = await writePluginOutput(options).catch((reason) => reason);
    expect(error.cause).toBe(publish);
    expect(error.errors).toEqual([publish, cleanup]);
    expect(error.message).toBe(
      `instrumented publish failure. Cleanup also failed: instrumented cleanup failure. The unpublished new output remains at "${next}". Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
    expect(await snapshot(options.outDir)).toEqual(before);
    expect(await readdir(lock)).toEqual(['next']);
  });

  it.each([
    ['writing', { write: new Error('instrumented write failure') }],
    ['closing', { close: new Error('instrumented close failure') }],
  ])(
    'reports a failure %s a staged file unchanged and keeps the prior output',
    async (_label, failure) => {
      await writePluginOutput(options);
      const before = await snapshot(options.outDir);
      await failStagedFile(failure);
      const files = { ...options.files, '.mcp.json': 'new config' };
      // A close failure after a complete write is never swallowed; either one stays the error.
      await expect(writePluginOutput({ ...options, files })).rejects.toBe(
        failure.write ?? failure.close,
      );
      expect(await snapshot(options.outDir)).toEqual(before);
      expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
    },
  );

  it('keeps a staged write failure primary when closing the file also fails', async () => {
    await writePluginOutput(options);
    const before = await snapshot(options.outDir);
    const write = new Error('instrumented write failure');
    const close = new Error('instrumented close failure');
    await failStagedFile({ write, close });
    const files = { ...options.files, '.mcp.json': 'new config' };
    const error = await writePluginOutput({ ...options, files }).catch((reason) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBe(write);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBe(write);
    expect(error.errors[1]).toBe(close);
    expect(error.message).toBe(
      'instrumented write failure. Cleanup also failed: instrumented close failure.',
    );
    // The failed close did not stop removal of the unpublished staged tree.
    expect(await snapshot(options.outDir)).toEqual(before);
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);

    // When removing the staged tree also fails, every failure and the remaining tree are reported.
    const cleanup = new Error('instrumented cleanup failure');
    await failStagedFile({ write, close });
    fs.unlink.mockRejectedValueOnce(cleanup);
    const retained = await writePluginOutput({ ...options, files }).catch((reason) => reason);
    expect(retained.cause).toBe(write);
    expect(retained.errors).toHaveLength(3);
    expect(retained.errors[0]).toBe(write);
    expect(retained.errors[1]).toBe(close);
    expect(retained.errors[2]).toBe(cleanup);
    expect(retained.message).toBe(
      `instrumented write failure. Cleanup also failed: instrumented close failure; instrumented cleanup failure. The unpublished new output remains at "${next}". Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
    expect(await snapshot(options.outDir)).toEqual(before);
    expect(await readdir(lock)).toEqual(['next']);
  });

  it('continues cleanup when the metadata helper fails to close', async () => {
    await writePluginOutput(options);
    const before = await snapshot(options.outDir);
    const { rename } = await vi.importActual('node:fs/promises');
    const { openOutputMetadataCheck } = await vi.importActual('./plugin-output-metadata.mjs');
    const publish = new Error('instrumented publish failure');
    const close = new Error('instrumented close failure');
    metadata.openOutputMetadataCheck.mockImplementationOnce(async () => {
      const helper = await openOutputMetadataCheck();
      return {
        ...helper,
        async close() {
          await helper.close();
          throw close;
        },
      };
    });
    fs.rename.mockImplementationOnce(rename).mockRejectedValueOnce(publish);
    const error = await writePluginOutput(options).catch((reason) => reason);
    expect(error.errors).toEqual([publish, close]);
    expect(error.message).toBe(
      'instrumented publish failure. Cleanup also failed: instrumented close failure.',
    );
    expect(await snapshot(options.outDir)).toEqual(before);
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
  });

  it('says the new artifact is published when removing the replaced output fails', async () => {
    await writePluginOutput(options);
    const before = await snapshot(options.outDir);
    const cleanup = new Error('instrumented cleanup failure');
    fs.unlink.mockRejectedValueOnce(cleanup);
    const files = { ...options.files, '.mcp.json': 'new config' };
    const error = await writePluginOutput({ ...options, files }).catch((reason) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause).toBeUndefined();
    expect(error.errors).toEqual([cleanup]);
    expect(error.message).toBe(
      `The complete new plugin output was published at "${options.outDir}", but cleanup failed: instrumented cleanup failure. Entries of the replaced output remain in "${previous}". Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
    expect(await readFile(join(options.outDir, '.mcp.json'), 'utf8')).toBe('new config');
    expect(await snapshot(previous)).toEqual(before);
    await expect(writePluginOutput(options)).rejects.toThrow(/another build is using/);
  });

  it('keeps an entry that arrives in staging after publication and reports it', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    fs.rename.mockImplementationOnce(rename).mockImplementationOnce(async (source, target) => {
      await rename(source, target);
      await writeFile(join(lock, 'owner note.txt'), 'keep');
    });
    const files = { ...options.files, '.mcp.json': 'new config' };
    const error = await writePluginOutput({ ...options, files }).catch((reason) => reason);
    expect(error.errors).toHaveLength(1);
    expect(error.message).toMatch(
      `The complete new plugin output was published at "${options.outDir}", but cleanup failed: `,
    );
    expect(error.message).toMatch(`Staging directory "${lock}" remains`);
    expect(error.message).not.toMatch(/replaced output remain/);
    expect(await readFile(join(options.outDir, '.mcp.json'), 'utf8')).toBe('new config');
    expect(await readdir(lock)).toEqual(['owner note.txt']);
  });

  it('restores a moved tree if its post-move ownership check fails', async () => {
    await writePluginOutput(options);
    const { rename } = await vi.importActual('node:fs/promises');
    fs.rename.mockImplementationOnce(async (source, target) => {
      await rename(source, target);
      await writeFile(join(target, 'foreign'), 'arrived during rename');
    });
    await expect(writePluginOutput(options)).rejects.toThrow(/"foreign" is not owned/);
    expect(await readFile(join(options.outDir, 'foreign'), 'utf8')).toBe('arrived during rename');
    expect(await readdir(join(options.packageDir, 'dist'))).toEqual(['marketplace']);
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
    const conflict = new Error('instrumented publish conflict');
    fs.rename.mockImplementationOnce(rename);
    fs.rename.mockImplementationOnce(async (_source, target) => {
      await mkdir(target);
      await writeFile(join(target, 'foreign'), 'new owner contents');
      throw conflict;
    });
    const error = await writePluginOutput(options).catch((reason) => reason);
    expect(error.cause).toBe(conflict);
    expect(error.errors).toEqual([conflict]);
    expect(error.message).toBe(
      `instrumented publish conflict. The previous output was not restored and remains at "${previous}"; inspect it and "${options.outDir}" before moving either by hand. Staging directory "${lock}" remains; once no build is running, keep anything you need from it and move it aside before rebuilding this destination.`,
    );
    expect(await readdir(options.outDir)).toEqual(['foreign']);
    expect(await readFile(join(options.outDir, 'foreign'), 'utf8')).toBe('new owner contents');
    expect(await readFile(join(previous, '.mcp.json'), 'utf8')).toBe('mcp config');
  });

  it('serializes writes and preserves a staging directory from an interrupted build', async () => {
    await mkdir(join(options.packageDir, 'dist'));
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

describe('plugin source inventory', () => {
  let scratch;
  let root;
  const supported = ['manifest.json', 'skills/run-loop/SKILL.md'];

  beforeEach(async () => {
    scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg-source-漢 '));
    root = join(scratch, 'plugin source');
    await mkdir(join(root, 'skills', 'run-loop'), { recursive: true });
    await writeFile(join(root, 'manifest.json'), '{}');
    await writeFile(join(root, 'skills', 'run-loop', 'SKILL.md'), 'skill');
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('accepts exactly the supported files and refuses other entries without following links', async () => {
    await expect(checkSourceInventory(root, supported)).resolves.toBeUndefined();

    await mkdir(join(root, 'skills', 'run-loop', 'scripts'));
    await writeFile(join(root, 'skills', 'run-loop', 'scripts', 'helper.sh'), 'echo');
    await writeFile(join(root, 'skills', 'run-loop', 'reference.md'), 'notes');
    await writeFile(join(root, 'notes.txt'), 'notes');
    const elsewhere = join(scratch, 'elsewhere');
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, 'SKILL.md'), 'not a packaged input');
    await symlink(
      elsewhere,
      join(root, 'skills', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(checkSourceInventory(root, supported)).rejects.toThrow(
      `Unsupported plugin source entries in "${root}": "notes.txt", "skills/linked" (link, not followed), "skills/run-loop/reference.md", "skills/run-loop/scripts/". This builder packages only "manifest.json", "skills/run-loop/SKILL.md" from this folder. Move the unsupported entries out of it, or add explicit builder support for them, then assemble again`,
    );
    expect(await readdir(elsewhere)).toEqual(['SKILL.md']);
  });

  it('refuses invalid supported names and bounds the listed entries', async () => {
    for (const name of ['../outside', '/absolute', 'skills//SKILL.md', 'skills/./SKILL.md']) {
      await expect(checkSourceInventory(root, [name])).rejects.toThrow(
        `Invalid plugin source name "${name}"`,
      );
    }
    for (let index = 10; index < 22; index++) await writeFile(join(root, `extra${index}`), '');
    await expect(checkSourceInventory(root, supported)).rejects.toThrow(
      /: "extra10", "extra11", .*"extra19", and 2 more\. This builder packages only/,
    );
  });
});
