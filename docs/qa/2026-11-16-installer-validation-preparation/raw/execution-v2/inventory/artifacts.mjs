// Complete current output trees and the reviewed subset of physical runtime dependencies.
import assert from 'node:assert/strict';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, hash, json, slash, within } from './common.mjs';

export const expectedOutputRoots = [
  'apps/api/dist', 'apps/mcp/dist', 'apps/plugin-claude/dist', 'apps/plugin-codex/dist',
  'apps/web/dist', 'apps/web/dist-goblin', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist',
  'packages/api-client/dist', 'packages/contracts/dist', 'packages/domain/dist', 'packages/engine/dist',
  'packages/infrastructure/dist',
];
const apiAndMcpClosure = [
  'apps/api', 'apps/mcp', 'packages/adapter-codex', 'packages/adapter-jev',
  'packages/api-client', 'packages/contracts', 'packages/domain', 'packages/engine', 'packages/infrastructure',
];

async function currentOutputRoots(checkout) {
  const roots = [];
  for (const group of ['apps', 'packages']) {
    for (const packageEntry of await readdir(join(checkout, group), { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) continue;
      const owner = group + '/' + packageEntry.name;
      for (const entry of await readdir(join(checkout, owner), { withFileTypes: true })) {
        if (!/^dist(?:-|$)/u.test(entry.name)) continue;
        assert(entry.isDirectory(), 'Unexpected output symlink or file: ' + owner + '/' + entry.name);
        roots.push(owner + '/' + entry.name);
      }
    }
  }
  roots.sort();
  assert.deepEqual(roots, expectedOutputRoots, 'Named workspace build-output directories changed');
  return roots;
}

async function collectOutput(checkout, current, files) {
  const path = join(checkout, current);
  assert.equal(await realpath(path), path);
  const children = await readdir(path, { withFileTypes: true });
  for (const entry of children.sort((left, right) => left.name.localeCompare(right.name, 'en-US'))) {
    const relativeName = current + '/' + entry.name;
    if (entry.isDirectory()) await collectOutput(checkout, relativeName, files);
    else {
      assert(entry.isFile(), 'Unexpected output symlink: ' + relativeName);
      files[relativeName] = await hash(join(checkout, relativeName));
    }
  }
}

async function checkedWorkspaceExport(checkout, name, key) {
  const owner = join(checkout, 'packages', name);
  const manifest = await json(join(owner, 'package.json'));
  assert.equal(manifest.name, '@graphgoblin/' + name);
  const entry = manifest.exports[key].import;
  assert.match(entry, /^\.\/dist\/(?:[a-z-]+\/)*index\.js$/u, 'Unexpected export shape: ' + name);
  return 'packages/' + name + '/' + entry.slice(2);
}

async function readWorkspaceLinks(checkout) {
  const links = {};
  for (const owner of apiAndMcpClosure) {
    const manifest = await json(join(checkout, owner, 'package.json'));
    for (const name of Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@graphgoblin/')).sort()) {
      const logical = owner + '/node_modules/' + name;
      const directory = 'packages/' + name.slice('@graphgoblin/'.length);
      const physical = await realpath(join(checkout, logical));
      assert.equal(physical, join(checkout, directory), 'Wrong workspace link target: ' + logical);
      assert.equal((await json(join(physical, 'package.json'))).name, name);
      links[logical] = directory;
    }
  }
  assert(Object.keys(links).length > 0);
  return links;
}

async function readThirdPartyEntries(checkout) {
  const files = {};
  async function add(path) {
    const physical = await realpath(path);
    assert(within(checkout, physical) && (await lstat(physical)).isFile(), 'Dependency escapes the checkout: ' + path);
    files[slash(relative(checkout, physical))] = await hash(physical);
    return physical;
  }
  async function installed(owner, name) {
    const manifestFile = await add(join(checkout, owner, 'node_modules', name, 'package.json'));
    const metadata = await json(manifestFile);
    assert.equal(metadata.name, name);
    return { metadata, directory: dirname(manifestFile) };
  }
  async function select(record, entry) {
    assert(typeof entry === 'string' && entry.length > 0, 'Expected an actual installed entry point');
    const target = resolve(record.directory, entry);
    assert(within(record.directory, target));
    return add(target);
  }

  for (const name of ['fastify', 'pino']) {
    const record = await installed('apps/api', name);
    assert.equal(record.metadata.exports, undefined, 'Recheck the runtime export map for ' + name);
    await select(record, record.metadata.main);
  }

  const sdk = await installed('apps/mcp', '@modelcontextprotocol/sdk');
  const sdkImport = sdk.metadata.exports['./*'].import;
  assert.equal(sdkImport, './dist/esm/*');
  for (const path of ['server/mcp.js', 'server/stdio.js', 'shared/stdio.js']) {
    await select(sdk, sdkImport.replace('*', path));
  }

  const client = await installed('packages/infrastructure', '@libsql/client');
  const clientEntry = await select(client, client.metadata.exports['.'].import.node);
  const sqliteClient = await add(join(dirname(clientEntry), 'sqlite3.js'));
  const sqliteResolver = createRequire(pathToFileURL(sqliteClient));
  const libsql = await add(sqliteResolver.resolve('libsql'));
  const libsqlMetadata = await add(join(dirname(libsql), 'package.json'));
  assert.equal((await json(libsqlMetadata)).name, 'libsql');
  const libsqlResolver = createRequire(pathToFileURL(libsql));
  const addon = await add(libsqlResolver.resolve('@libsql/win32-x64-msvc'));
  assert(addon.endsWith('.node'));
  const addonMetadata = await add(join(dirname(addon), 'package.json'));
  assert.equal((await json(addonMetadata)).name, '@libsql/win32-x64-msvc');

  const zod = await installed('packages/contracts', 'zod');
  await select(zod, zod.metadata.exports['.'].import);
  return files;
}

export async function collectArtifacts(checkout) {
  const outputRoots = await currentOutputRoots(checkout);
  const outputFiles = {};
  for (const root of outputRoots) await collectOutput(checkout, root, outputFiles);
  const runtimeEntries = [
    'apps/api/dist/main.js', 'apps/api/dist/index.js', 'apps/api/dist/container.js', 'apps/mcp/dist/main.js',
    await checkedWorkspaceExport(checkout, 'infrastructure', './sqlite'),
    await checkedWorkspaceExport(checkout, 'contracts', '.'),
  ];
  for (const entry of runtimeEntries) assert(Object.hasOwn(outputFiles, entry), 'Missing bound runtime output: ' + entry);
  const artifacts = {
    outputRoots, outputFiles, runtimeEntries,
    dependencyFiles: await readThirdPartyEntries(checkout),
    workspaceLinks: await readWorkspaceLinks(checkout),
  };
  return {
    ...artifacts,
    inventorySha256: digest(JSON.stringify(artifacts)),
    counts: { outputRoots: outputRoots.length, outputFiles: Object.keys(outputFiles).length },
  };
}
