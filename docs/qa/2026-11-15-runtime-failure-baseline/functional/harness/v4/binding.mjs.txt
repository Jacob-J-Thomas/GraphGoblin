// Read-only source/build rebinding plus an explicit external capture mode.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const digest = (data) => createHash('sha256').update(data).digest('hex');
export const abs = (path) => {
  assert(typeof path === 'string' && isAbsolute(path), 'Absolute bound path required');
  return path;
};
export const hash = async (path) => digest(await readFile(path));
export const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''));
export const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function contained(base, path) {
  const tail = relative(base, path);
  return tail !== '' && !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep);
}
export const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
export const batch = await realpath(join(root, '..'));
export const harnessFiles = ['binding.mjs', 'fixtures.mjs', 'gateway.mjs', 'native.mjs', 'run.mjs', 'README.md'];
const sha1 = /^[a-f0-9]{40}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const productionRoots = [
  'apps/api/dist', 'apps/mcp/dist', 'apps/web/dist', 'apps/web/dist-goblin',
  'packages/api-client/dist', 'packages/contracts/dist', 'packages/domain/dist',
  'packages/engine/dist', 'packages/infrastructure/dist', 'packages/adapter-codex/dist',
  'packages/adapter-jev/dist',
];
const modulePaths = {
  playwright: 'apps/web/node_modules/@playwright/test/index.mjs',
  composedLogger: 'apps/api/node_modules/pino/pino.js',
  mcpClient: 'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js',
  mcpStdio: 'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js',
  sqlite: 'packages/infrastructure/dist/sqlite/index.js',
  contracts: 'packages/contracts/dist/index.js',
};
const critical = [
  'apps/api/dist/main.js', 'apps/api/dist/index.js', 'apps/mcp/dist/main.js',
  'apps/web/dist/index.html', 'packages/domain/dist/index.js', modulePaths.sqlite, modulePaths.contracts,
];

async function listTree(checkout, start, output) {
  const list = await readdir(join(checkout, start), { withFileTypes: true });
  for (const entry of list.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = start + '/' + entry.name;
    if (entry.isDirectory()) await listTree(checkout, path, output);
    else {
      assert(entry.isFile(), 'Unexpected output link: ' + path);
      output[path] = await hash(join(checkout, path));
    }
  }
}

async function outputRoots(checkout) {
  const roots = [];
  for (const group of ['apps', 'packages']) {
    for (const project of await readdir(join(checkout, group), { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const prefix = group + '/' + project.name;
      for (const entry of await readdir(join(checkout, prefix), { withFileTypes: true })) {
        if (!/^dist(?:-|$)/u.test(entry.name)) continue;
        assert(entry.isDirectory(), 'Expected an owned output directory: ' + prefix + '/' + entry.name);
        roots.push(prefix + '/' + entry.name);
      }
    }
  }
  return roots.sort();
}

export async function capture(input) {
  assert.equal(input.schema, 'gg381-build-input/v1');
  assert.equal(process.version, 'v22.23.4');
  const checkout = await realpath(abs(input.checkout));
  const approvedWorktreeBase = await realpath(join(batch, '..', '..', '.codex', 'worktrees'));
  assert(contained(approvedWorktreeBase, checkout), 'Use an isolated Codex worktree');
  const nodePath = await realpath(abs(input.nodePath));
  const projectNodePath = await realpath(join(batch, '..', '..', '.claude', 'codex-runs',
    'GraphGoblin', 'runtime', 'node-v22.23.4-win-x64', 'node.exe'));
  assert.equal(nodePath, projectNodePath);
  assert.equal(await realpath(process.execPath), nodePath);
  assert.match(input.head, sha1);
  assert.match(input.tree, sha1);
  assert.match(input.main, sha1);
  const browserPath = await realpath(abs(input.browserPath));
  const browserSha256 = await hash(browserPath);
  assert.equal(browserSha256, input.browserSha256, 'Browser executable receipt');

  const git = (...args) => execFileSync('git', args, {
    cwd: checkout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  }).toString('utf8');
  const identity = () => ({
    head: git('rev-parse', 'HEAD').trim(),
    tree: git('rev-parse', 'HEAD^{tree}').trim(),
    main: git('rev-parse', 'origin/main').trim(),
    status: git('status', '--porcelain=v1', '--untracked-files=all').trim(),
  });
  const observed = identity();
  assert.deepEqual(observed, { head: input.head, tree: input.tree, main: input.main, status: '' });
  git('merge-base', '--is-ancestor', input.main, input.head);
  const index = resolve(checkout, git('rev-parse', '--git-path', 'index').trim());
  const indexSha256 = await hash(index);

  const receiptPath = await realpath(abs(input.buildReceipt));
  assert(contained(batch, receiptPath), 'Build receipt must be in the external batch');
  const receipt = await json(receiptPath);
  for (const field of ['head', 'tree']) assert.equal(receipt[field], input[field]);
  assert.equal(receipt.node, process.version);
  assert.equal(await realpath(abs(receipt.nodePath)), nodePath);
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.cleanAfter, true);
  const logPath = await realpath(abs(receipt.logPath));
  assert(contained(batch, logPath), 'Build log must be in the external batch');
  assert.match(receipt.logSha256, sha256);
  assert.equal(await hash(logPath), receipt.logSha256);

  const source = {};
  for (const line of git('ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean)) {
    const item = /^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/u.exec(line);
    assert(item, 'Unexpected source entry: ' + line);
    const [, mode, blob, path] = item;
    assert(['100644', '100755'].includes(mode), 'Unexpected source link: ' + path);
    assert((await lstat(join(checkout, path))).isFile(), 'Unbound source path: ' + path);
    const bytes = await readFile(join(checkout, path));
    const actualBlob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(actualBlob, blob, 'Checked-out bytes differ from Git object: ' + path);
    source[path] = digest(bytes);
  }

  const roots = await outputRoots(checkout);
  for (const path of productionRoots) assert(roots.includes(path), 'Missing output tree: ' + path);
  const output = {};
  for (const path of roots) await listTree(checkout, path, output);
  for (const path of critical) assert.match(output[path] ?? '', sha256, 'Missing runtime artifact: ' + path);

  const dependencies = {};
  for (const [key, value] of Object.entries(modulePaths)) {
    const path = await realpath(join(checkout, value));
    assert(contained(checkout, path), 'Dependency resolves outside bound checkout: ' + path);
    dependencies[key] = { path, sha256: await hash(path) };
  }
  for (const owner of productionRoots.map((path) => path.split('/').slice(0, 2).join('/')).filter(
    (owner, index, all) => index === all.indexOf(owner),
  )) {
    const { dependencies: declarations } = await json(join(checkout, owner, 'package.json'));
    for (const name of Object.keys(declarations ?? {}).filter((name) => name.startsWith('@graphgoblin/'))) {
      const link = owner + '/node_modules/' + name;
      const resolved = await realpath(join(checkout, link));
      const expected = await realpath(join(checkout, 'packages', name.split('/')[1]));
      assert.equal(resolved, expected, 'Workspace dependency: ' + link);
      dependencies[link] = relative(checkout, resolved);
    }
  }

  assert.deepEqual(identity(), observed, 'Git changed during binding');
  assert.equal(await hash(index), indexSha256, 'Index changed during binding');
  return {
    schema: 'gg381-build-binding/v1', input, checkout, ...observed, indexSha256,
    nodePath, node: process.version, nodeSha256: await hash(nodePath), browserPath, browserSha256,
    receiptSha256: await hash(receiptPath), receipt, source, roots, output, dependencies,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [inputPath, outputPath] = process.argv.slice(2);
  const path = abs(outputPath);
  assert(contained(batch, path), 'Binding output must stay in the external batch');
  const bound = await capture(await json(abs(inputPath)));
  await save(path, bound);
  process.stdout.write(JSON.stringify({
    head: bound.head, tree: bound.tree, main: bound.main, sourceFiles: Object.keys(bound.source).length,
    outputFiles: Object.keys(bound.output).length, outputRoots: bound.roots, bindingSha256: await hash(path),
  }) + '\n');
}
