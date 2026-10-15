import { mkdir, mkdtemp, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_DEFINITION_FORMAT, LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { installedFile, TemplateCatalog } from './catalog.js';

const sourceRoot = fileURLToPath(new URL('../../templates', import.meta.url));
const dirs: string[] = [];
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const source = await new TemplateCatalog(sourceRoot).get('starter');
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'gg-catalog-boundary-')));
  dirs.push(dir);
  const root = join(dir, 'catalog');
  const packageRoot = join(dir, 'package');
  await mkdir(join(root, 'recipe'), { recursive: true });
  await mkdir(packageRoot);
  const manifest = { ...structuredClone(source.manifest), id: 'recipe' };
  manifest.draftFile = 'draft.json';
  const exported = {
    format: 'graphgoblin-loop',
    formatVersion: CURRENT_DEFINITION_FORMAT,
    exportedAt: FIXTURE_TS,
    loop: structuredClone(source.draft),
  };
  await writeFile(join(root, 'catalog.json'), JSON.stringify(['recipe/manifest.json']));
  await writeFile(join(root, 'recipe', 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'recipe', 'draft.json'), JSON.stringify(exported));
  return {
    dir,
    root,
    packageRoot,
    manifest,
    exported,
    catalog: new TemplateCatalog(root),
  };
}

describe('installed template catalog boundaries', () => {
  it('requires a draft asset and never falls back to a configured graph', async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({ ...f.manifest, draftFile: undefined }),
    );
    await expect(f.catalog.draft('recipe')).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });

  it('clones every creation even when get returns a shared loaded entry', async () => {
    const f = await fixture();
    const entry = await f.catalog.get('recipe');
    f.catalog.get = () => Promise.resolve(entry);
    const first = await f.catalog.draft('recipe');
    const second = await f.catalog.draft('recipe');
    first.nodes[0]!.label = 'Changed copy';
    expect(second).toEqual(entry.draft);
    expect(first).not.toEqual(second);
    expect(Object.keys(entry)).toEqual(['manifest', 'draft']);
  });

  it('applies package bounds, format and graph validation to declared draft files', async () => {
    const f = await fixture();
    const path = join(f.root, 'recipe', 'draft.json');
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({ ...f.manifest, draftFile: 'draft.json' }),
    );
    await unlink(path);
    await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
    for (const content of [
      Buffer.alloc(1_048_577),
      '{private-draft-content',
      JSON.stringify({ ...f.exported, formatVersion: 2 }),
    ]) {
      await writeFile(path, content);
      await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
    }
    const invalid = structuredClone(f.exported);
    invalid.loop.edges[0]!.to.node = 'missing-target';
    await writeFile(path, JSON.stringify(invalid));
    await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({ ...f.manifest, draftFile: '../outside.json' }),
    );
    await expect(f.catalog.list()).rejects.toMatchObject({ code: 'TEMPLATE_PACKAGE_INVALID' });
  });

  it('loads the actual source-only starter with current graph format and no repository support', async () => {
    const catalog = new TemplateCatalog(sourceRoot);
    const entries = await catalog.list();
    expect(entries.map((entry) => entry.manifest.id)).toEqual([
      'starter',
      'implementation',
      'review',
      'qa',
    ]);
    const starter = await catalog.get('starter');
    expect(starter.manifest.kind).toBe('starter');
    expect(starter.manifest.requiredSecrets).toEqual([]);
    expect('support' in starter).toBe(false);
    expect(starter.draft.schemaVersion).toBe(CURRENT_DEFINITION_FORMAT);
    expect(starter.draft?.nodes.some((node) => node.kind === 'inference')).toBe(true);
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

  it.each(['catalog.json', 'recipe/manifest.json', 'recipe/draft.json'])(
    'refuses the oversized regular asset %s before parsing it',
    async (asset) => {
      const f = await fixture();
      await writeFile(join(f.root, asset), Buffer.alloc(1_048_577, 32));
      await expect(f.catalog.list()).rejects.toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        message: 'The installed template catalog is invalid; reinstall the package.',
      });
    },
  );

  it.each(['catalog.json', 'recipe/manifest.json', 'recipe/draft.json'])(
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

  it('does not open configured graphs or private support entries', async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, 'recipe', 'manifest.json'),
      JSON.stringify({
        ...f.manifest,
        loops: [{ ...f.manifest.loops[0], file: 'missing.json', dependsOn: ['missing-child'] }],
        supportEntry: 'dist/missing.mjs',
      }),
    );
    expect((await f.catalog.get('recipe')).draft).toEqual(f.exported.loop);
  });

  it.each([
    ['script', { command: 'unavailable-private-support' }],
    ['subloop', { loopRef: { loopId: fakeUlid('child'), version: 1 } }],
    ['heartbeat', { intervalSeconds: 1, maxBeats: 1 }],
  ])('refuses a schema-valid %s node in a shipped draft', async (kind, config) => {
    const f = await fixture();
    const loop = LoopDefinitionSchema.parse({
      ...f.exported.loop,
      nodes: f.exported.loop.nodes.map((node) =>
        node.kind === 'inference' ? { id: node.id, label: node.label, kind, config } : node,
      ),
    });
    await writeFile(join(f.root, 'recipe', 'draft.json'), JSON.stringify({ ...f.exported, loop }));
    await expect(f.catalog.list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      statusCode: 503,
    });
  });

  it('refuses nonmanual triggers and noncaller return channels', async () => {
    const f = await fixture();
    for (const nodes of [
      f.exported.loop.nodes.map((node) =>
        node.kind === 'trigger'
          ? { ...node, config: { subtype: 'cron', expression: '* * * * *', timezone: 'UTC' } }
          : node,
      ),
      f.exported.loop.nodes.map((node) =>
        node.kind === 'exit'
          ? {
              ...node,
              config: {
                ...node.config,
                return: { ...node.config.return, channels: [{ kind: 'log' }] },
              },
            }
          : node,
      ),
    ]) {
      const loop = LoopDefinitionSchema.parse({ ...f.exported.loop, nodes });
      await writeFile(
        join(f.root, 'recipe', 'draft.json'),
        JSON.stringify({ ...f.exported, loop }),
      );
      await expect(f.catalog.list()).rejects.toMatchObject({
        code: 'TEMPLATE_PACKAGE_INVALID',
        statusCode: 503,
      });
    }
  });

  it('refuses malformed exports, old format and dangling graph targets', async () => {
    const f = await fixture();
    const path = join(f.root, 'recipe', 'draft.json');
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
    await writeFile(join(f.root, 'second', 'draft.json'), JSON.stringify(f.exported));
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
    await expect(new TemplateCatalog(alias).list()).rejects.toMatchObject({
      code: 'TEMPLATE_PACKAGE_INVALID',
      message: 'The installed template catalog is invalid; reinstall the package.',
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
      message: 'The installed template catalog is invalid; reinstall the package.',
    });
  });
});
