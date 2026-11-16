// Exact Windows workspace and receipt helpers for the root-owned #410 build and readback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = await realpath(fileURLToPath(new URL('.', import.meta.url)));
export const batch = await realpath(join(root, '..'));
export const profile = await realpath(join(batch, '..', '..'));
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hash = async (path) => digest(await readFile(path));
export const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''));
export const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export const iso = () => new Date().toISOString();
export const hashPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;

export function absolute(path) {
  assert(typeof path === 'string' && isAbsolute(path) && normalize(path) === path, 'Canonical absolute path required');
  return path;
}

export function within(parent, path) {
  const name = relative(parent, path);
  return name !== '' && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name);
}

export function slash(path) {
  return path.replaceAll('\\', '/');
}

export async function ordinaryFile(path, parent) {
  absolute(path);
  assert(within(parent, path) && await realpath(path) === path, 'Unexpected resolved file path: ' + path);
  assert((await lstat(path)).isFile(), 'Expected a regular file: ' + path);
  return path;
}

export async function currentNode() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v22.23.4');
  assert.equal(process.env.NODE_OPTIONS, undefined, 'Run with NODE_OPTIONS absent');
  const expected = join(profile, '.claude', 'codex-runs', 'GraphGoblin', 'runtime', 'node-v22.23.4-win-x64', 'node.exe');
  assert.equal(await realpath(expected), expected);
  assert.equal(await realpath(process.execPath), expected);
  return { nodePath: expected, nodeVersion: process.version, nodeSha256: await hash(expected) };
}

export function buildEnv(node) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['path', 'node_options', 'git_optional_locks'].includes(name.toLowerCase())));
  env.PATH = dirname(node.nodePath) + delimiter + (process.env.PATH ?? '');
  env.GIT_OPTIONAL_LOCKS = '0';
  return env;
}

export function git(job, ...args) {
  return execFileSync('git', args, {
    cwd: job.checkout, env: buildEnv(job.node), windowsHide: true,
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
}

export async function readAdmission(path, sha) {
  assert.match(sha ?? '', hashPattern, 'Exact admission SHA-256 required');
  await ordinaryFile(path, batch);
  assert.equal(await hash(path), sha);
  const input = await json(path);
  assert.equal(input.schema, 'gg410-root-build-admission/v1');
  assert.equal(input.state, 'root-admitted-build');
  assert(['baseline', 'candidate'].includes(input.phase));
  for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'merged381']) assert.match(input[key], commitPattern);
  for (const key of ['indexSha256', 'nodeSha256']) assert.match(input[key], hashPattern);

  const node = await currentNode();
  assert.equal(node.nodeSha256, input.nodeSha256);
  const checkout = await realpath(absolute(input.checkout));
  assert.equal(checkout, input.checkout);
  const worktrees = await realpath(join(profile, '.codex', 'worktrees'));
  assert.match(relative(worktrees, checkout), /^gg-[^\\/]+[\\/]GraphGoblin$/iu);
  assert((await lstat(dirname(checkout))).isDirectory() && (await lstat(checkout)).isDirectory());
  const directory = absolute(input.buildDirectory);
  assert.equal(dirname(directory), batch);
  assert.match(basename(directory), new RegExp('^runtime-410-build-' + input.phase + '-[a-z0-9-]{3,48}$', 'u'));
  return { input, checkout, directory, node, admissionPath: path, admissionSha256: sha };
}

export async function readIdentity(job) {
  const indexPath = normalize(git(job, 'rev-parse', '--path-format=absolute', '--git-path', 'index').trim());
  assert(isAbsolute(indexPath) && (await lstat(indexPath)).isFile());
  const observed = {
    head: git(job, 'rev-parse', 'HEAD').trim(),
    tree: git(job, 'rev-parse', 'HEAD^{tree}').trim(),
    actualMain: git(job, 'rev-parse', 'refs/remotes/origin/main').trim(),
    actualMainTree: git(job, 'rev-parse', 'refs/remotes/origin/main^{tree}').trim(),
    clean: git(job, 'status', '--porcelain=v1', '--untracked-files=all', '--no-ahead-behind').trim() === '',
    indexPath, indexSha256: await hash(indexPath),
  };
  for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'indexSha256']) {
    assert.equal(observed[key], job.input[key], 'Binding changed: ' + key);
  }
  assert.equal(observed.clean, true, 'Expected a clean worktree');
  git(job, 'merge-base', '--is-ancestor', job.input.merged381, observed.actualMain);
  git(job, 'merge-base', '--is-ancestor', observed.actualMain, observed.head);
  if (job.input.phase === 'baseline') {
    assert.equal(observed.head, observed.actualMain);
    assert.equal(observed.tree, observed.actualMainTree);
  } else assert.notEqual(observed.head, observed.actualMain);
  return observed;
}

export function receiptReference(job) {
  return { admissionPath: job.admissionPath, admissionSha256: job.admissionSha256,
    phase: job.input.phase, checkout: job.checkout, buildDirectory: job.directory, ...job.node };
}
