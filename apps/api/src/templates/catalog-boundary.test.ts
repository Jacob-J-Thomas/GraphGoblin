import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { installedFile, TemplateCatalog } from './catalog.js';

const sourceRoot = fileURLToPath(new URL('../../templates', import.meta.url));
const sourcePackage = fileURLToPath(new URL('../..', import.meta.url));
const dirs: string[] = [];
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const source = await new TemplateCatalog(sourceRoot, sourcePackage).get('starter');
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'gg-catalog-boundary-')));
  dirs.push(dir);
  const root = join(dir, 'catalog');
  const packageRoot = join(dir, 'package');
  await mkdir(join(root, 'recipe'), { recursive: true });
  await mkdir(packageRoot);
  const manifest = { ...structuredClone(source.bundle.manifest), id: 'recipe' };
  const exported = {
    format: 'graphgoblin-loop',
    formatVersion: 3,
    exportedAt: FIXTURE_TS,
    loop: structuredClone(source.bundle.loops['parent']!),
  };
  await writeFile(join(root, 'catalog.json'), JSON.stringify(['recipe/manifest.json']));
  await writeFile(join(root, 'recipe', 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'recipe', 'loop.json'), JSON.stringify(exported));
  return {
    dir,
    root,
    packageRoot,
    manifest,
    exported,
    catalog: new TemplateCatalog(root, packageRoot),
  };
}

describe('installed template catalog boundaries', () => {
  it('loads the actual source-only starter with current graph format and no repository support', async () => {
    const catalog = new TemplateCatalog(sourceRoot, sourcePackage);
    const entries = await catalog.list();
    expect(entries.map((entry) => entry.bundle.manifest.id)).toEqual(['starter', 'implementation']);
    const starter = await catalog.get('starter');
    expect(starter.bundle.manifest.kind).toBe('starter');
    expect(starter.bundle.manifest.requiredSecrets).toEqual([]);
    expect(starter.support).toBeUndefined();
    expect(starter.bundle.loops['parent']?.schemaVersion).toBe(3);
    expect(starter.bundle.loops['parent']?.nodes.some((node) => node.kind === 'inference')).toBe(
      true,
    );
    await expect(catalog.get('absent-template')).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it.each([
    ['invalid JSON', '{"private-file-content'],
    ['non-array', '{"entries":["recipe/manifest.json"]}'],
    ['non-string entry', '[42]'],
    ['too many entries', JSON.stringify(Array.from({ length: 101 }, () => 'recipe/manifest.json'))],
    ['parent traversal', '["../outside.json"]'],
    ['absolute path', '["/outside.json"]'],
    ['backslash path', JSON.stringify(['recipe\\manifest.json'])],
  ])('refuses an index with %s without exposing its raw contents', async (_label, content) => {
    const f = await fixture();
    await writeFile(join(f.root, 'catalog.json'), content);
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
      message: 'The installed template catalog is invalid; reinstall the package.',
    });
  });

  it.each(['catalog.json', 'recipe/manifest.json', 'recipe/loop.json'])(
    'refuses the oversized regular asset %s before parsing it',
    async (asset) => {
      const f = await fixture();
      await writeFile(join(f.root, asset), Buffer.alloc(1_048_577, 32));
      await expect(f.catalog.list()).rejects.toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        message: 'Template assets must be bounded regular files.',
      });
    },
  );

  it.each(['catalog.json', 'recipe/manifest.json', 'recipe/loop.json'])(
    'refuses a missing declared asset %s as a safe package failure',
    async (asset) => {
      const f = await fixture();
      await unlink(join(f.root, asset));
      await expect(f.catalog.list()).rejects.toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        statusCode: 503,
      });
    },
  );

  it('refuses malformed JSON and unknown manifest fields', async () => {
    const f = await fixture();
    const path = join(f.root, 'recipe', 'manifest.json');
    await writeFile(path, '{"private-manifest-content');
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
    await writeFile(
      path,
      JSON.stringify({ ...f.manifest, executableSettings: 'must not become code' }),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });

  it('refuses manifest traversal and dependencies absent from the bundle', async () => {
    const f = await fixture();
    const path = join(f.root, 'recipe', 'manifest.json');
    await writeFile(
      path,
      JSON.stringify({
        ...f.manifest,
        loops: [{ ...f.manifest.loops[0], file: '../outside.json' }],
      }),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
    await writeFile(
      path,
      JSON.stringify({
        ...f.manifest,
        loops: [{ ...f.manifest.loops[0], dependsOn: ['missing-child'] }],
      }),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
  });

  it('refuses malformed exports, old format and dangling graph targets', async () => {
    const f = await fixture();
    const path = join(f.root, 'recipe', 'loop.json');
    await writeFile(path, '{"private-export-content');
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
    await writeFile(path, JSON.stringify({ ...f.exported, formatVersion: 2 }));
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
    const broken = structuredClone(f.exported);
    broken.loop.edges[0]!.to.node = 'missing-node';
    await writeFile(path, JSON.stringify(broken));
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });

  it('refuses duplicate template identities instead of returning a partial catalog', async () => {
    const f = await fixture();
    await mkdir(join(f.root, 'second'));
    await writeFile(join(f.root, 'second', 'manifest.json'), JSON.stringify(f.manifest));
    await writeFile(join(f.root, 'second', 'loop.json'), JSON.stringify(f.exported));
    await writeFile(
      join(f.root, 'catalog.json'),
      JSON.stringify(['recipe/manifest.json', 'second/manifest.json']),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });

  it('rejects the root itself, lexical escapes and directory assets', async () => {
    const f = await fixture();
    for (const path of ['', '../outside.json', join(f.dir, 'outside.json')])
      await expect(installedFile(f.root, path)).rejects.toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        message: 'The template package path is outside its installed root.',
      });
    await expect(installedFile(f.root, 'recipe')).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'Template assets must be bounded regular files.',
    });
  });

  it('rejects a linked catalog root using a host-native directory link or junction', async () => {
    const f = await fixture();
    const alias = join(f.dir, 'catalog-alias');
    await symlink(f.root, alias, directoryLink);
    await expect(new TemplateCatalog(alias, f.packageRoot).list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'The installed template root must be a canonical directory.',
    });
  });

  it('rejects an ancestor alias even when the final root directory is not itself a link', async () => {
    const f = await fixture();
    const alias = join(f.dir, 'ancestor-alias');
    await symlink(f.root, alias, directoryLink);
    await expect(installedFile(join(alias, 'recipe'), 'manifest.json')).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'The installed template root must be a canonical directory.',
    });
  });

  it('rejects a linked interior component before reading its valid manifest', async () => {
    const f = await fixture();
    const target = join(f.dir, 'linked-assets');
    await rename(join(f.root, 'recipe'), target);
    await symlink(target, join(f.root, 'recipe'), directoryLink);
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'Template package links are not permitted.',
    });
  });

  it.each(['dist', 'templates'])(
    'accepts and hashes a bounded shipped %s support entry without executing it',
    async (prefix) => {
      const f = await fixture();
      const supportEntry = prefix + '/support/entry.mjs';
      const path = join(f.packageRoot, prefix, 'support', 'entry.mjs');
      await mkdir(join(f.packageRoot, prefix, 'support'), { recursive: true });
      await writeFile(path, '/* synthetic support bytes; never executed */');
      await writeFile(
        join(f.root, 'recipe', 'manifest.json'),
        JSON.stringify({ ...f.manifest, supportEntry }),
      );
      const loaded = await f.catalog.get('recipe');
      expect(loaded.support).toEqual({
        path,
        hash: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      });
    },
  );

  it('refuses an existing support file outside shipped dist/templates paths', async () => {
    const f = await fixture();
    await mkdir(join(f.packageRoot, 'src'));
    await writeFile(join(f.packageRoot, 'src', 'entry.mjs'), '/* unshipped; never executed */');
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({ ...f.manifest, supportEntry: 'src/entry.mjs' }),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'Support entries must belong to the shipped dist/ or templates/ package files.',
    });
  });

  it('refuses a missing declared support entry rather than silently omitting support', async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({ ...f.manifest, supportEntry: 'dist/missing.mjs' }),
    );
    await mkdir(join(f.packageRoot, 'dist'));
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });
});
