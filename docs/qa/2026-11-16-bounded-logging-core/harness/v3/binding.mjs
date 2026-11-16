import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const suite = await realpath(fileURLToPath(new URL('.', import.meta.url)));
export const batch = await realpath(join(suite, '..'));
const profile = await realpath(join(batch, '..', '..'));
const node = await realpath(join(profile, '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe'));
const shaPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const describe = (error) => ({ name: error.name, message: error.message, stack: error.stack,
  code: error.code, actual: error.actual, expected: error.expected });
export function within(root, child) {
  const tail = relative(root, child);
  return tail !== '' && tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
}
export function under(root, suffix) {
  assert.match(suffix, /^(?:[a-zA-Z0-9_.][a-zA-Z0-9 ._-]*\/)*[a-zA-Z0-9_.][a-zA-Z0-9 ._-]*$/u);
  assert(suffix.split('/').every((piece) => !/[. ]$/u.test(piece) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/iu.test(piece)));
  const path = resolve(root, suffix);
  assert(within(root, path), suffix);
  return path;
}
export async function readBound(ref, root) {
  assert(shaPattern.test(ref.sha256));
  assert(isAbsolute(ref.path));
  if (root) assert(within(root, ref.path));
  assert.equal(await realpath(ref.path), resolve(ref.path));
  const stat = await lstat(ref.path);
  assert(stat.isFile() && stat.nlink === 1);
  const bytes = await readFile(ref.path);
  assert.equal(sha(bytes), ref.sha256, ref.path);
  return bytes;
}
async function boundModule(rel, digest) {
  const path = under(batch, rel);
  await readBound({ path, sha256: digest }, batch);
  return import(pathToFileURL(path).href);
}

export async function admit(path, digest) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.version, 'v22.23.4');
  assert.equal(await realpath(process.execPath), node);
  assert.deepEqual(process.execArgv, []);
  assert(!Object.keys(process.env).some((key) => key.toUpperCase() === 'NODE_OPTIONS'));
  const raw = await readBound({ path, sha256: digest }, batch);
  const cfg = JSON.parse(raw.toString('utf8'));
  assert.equal(cfg.schema, 'gg438-native-admission/v1');
  assert(['baseline', 'candidate'].includes(cfg.mode));
  assert.match(cfg.attempt, /^(?:baseline|candidate)-attempt-[1-9][0-9]*$/u);
  assert(cfg.attempt.startsWith(cfg.mode + '-'));
  const binding = JSON.parse((await readBound(cfg.binding, batch)).toString('utf8'));
  assert.equal(binding.schema, 'gg438-native-source-build/v1');
  assert.equal(binding.node.path, node);
  assert.equal(binding.mode, cfg.mode);
  assert(commitPattern.test(binding.merged436));
  assert(commitPattern.test(binding.head) && commitPattern.test(binding.tree));
  assert(commitPattern.test(binding.actualMain) && commitPattern.test(binding.actualMainTree));
  assert(shaPattern.test(binding.indexSha256));
  const worktreeRoot = await realpath(join(profile, '.codex', 'worktrees'));
  assert(isAbsolute(binding.checkout) && within(worktreeRoot, binding.checkout));
  assert.equal(await realpath(binding.checkout), binding.checkout);
  assert(isAbsolute(binding.git.path));
  await readBound(binding.git);
  const common = { path: under(batch, 'runtime-410-build-preparation/common.mjs'),
    sha256: cfg.artifactCommonSha256 };
  await readBound(common, batch);
  const { collectArtifacts } = await boundModule('runtime-410-build-preparation/artifacts.mjs',
    cfg.artifactModuleSha256);
  const nativeLib = await boundModule('launcher-438-native-preparation-v3/native.mjs',
    cfg.nativeModuleSha256);
  return { cfg, binding, node, nativeLib, raw, path, digest, collectArtifacts, common };
}

export async function verify(job) {
  const { cfg, binding, collectArtifacts } = job;
  const git = (...args) => execFileSync(binding.git.path,
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
    encoding: 'utf8', cwd: binding.checkout, windowsHide: true, shell: false, timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
  });
  async function identity() {
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all').trim(), '');
    for (const [field, ref] of Object.entries({
      head: 'HEAD', tree: 'HEAD^{tree}', actualMain: 'refs/remotes/origin/main',
      actualMainTree: 'refs/remotes/origin/main^{tree}',
    })) assert.equal(git('rev-parse', ref).trim(), binding[field], field);
    const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index').trim();
    assert.equal(sha(await readFile(index)), binding.indexSha256);
    git('merge-base', '--is-ancestor', binding.merged436, binding.actualMain);
    git('merge-base', '--is-ancestor', binding.actualMain, binding.head);
    assert.equal(binding.head === binding.actualMain, cfg.mode === 'baseline');
  }
  await identity();
  const src = git('ls-files', '-z').split('\0').filter(Boolean);
  assert.equal(src.length, Object.keys(binding.sourceFiles).length);
  for (const file of src) {
    assert(shaPattern.test(binding.sourceFiles[file]));
    // Git supplies the names here, including tracked Unicode evidence paths.
    const full = resolve(binding.checkout, file);
    assert(within(binding.checkout, full));
    assert.equal(sha(await readFile(full)), binding.sourceFiles[file], file);
  }
  const artifacts = await collectArtifacts(binding.checkout);
  assert.deepEqual(artifacts, binding.artifacts);
  const checkoutProductEntry = resolve(binding.checkout, cfg.gatewayEntry);
  assert(within(binding.checkout, checkoutProductEntry));
  assert(Object.hasOwn(artifacts.outputFiles, cfg.gatewayEntry));
  await identity();
  for (const ref of [binding.node, binding.git, binding.launcher, binding.buildReceipt,
    binding.buildLog, binding.launcherBuildReceipt, cfg.binding, job.common,
    { path: under(batch, 'runtime-410-build-preparation/artifacts.mjs'), sha256: cfg.artifactModuleSha256 },
    { path: under(batch, 'launcher-438-native-preparation-v3/native.mjs'), sha256: cfg.nativeModuleSha256 },
    { path: job.path, sha256: job.digest }]) {
    await readBound(ref, [binding.git, binding.node].includes(ref) ? undefined : batch);
  }
  for (const ref of [binding.buildExit, binding.launcherBuildExit]) {
    const raw = await readBound(ref, batch);
    assert.equal(JSON.parse(raw.toString('utf8')).exitCode, 0, ref.path);
  }
  return { head: binding.head, tree: binding.tree, actualMain: binding.actualMain,
    indexSha256: binding.indexSha256, sourceFiles: src.length, ...artifacts.counts,
    artifactInventorySha256: artifacts.inventorySha256, launcherSha256: binding.launcher.sha256 };
}
