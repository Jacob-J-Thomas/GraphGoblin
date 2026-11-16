import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const trustedCommon = new URL('../launcher-438-candidate-freeze-preparation/common.mjs', import.meta.url);
assert.equal(createHash('sha256').update(await readFile(trustedCommon)).digest('hex'),
  '54f0a901a702eb78de69a6f0df7f9293e358689cb9a7af1016f906317da03ae4');
const { absolute, batch, currentNode, hash, hashPattern, json, ordinaryFile, readAdmission } =
  await import(trustedCommon.href);

export { batch, currentNode, hash, json };
export const freeze = join(batch, 'launcher-438-candidate-freeze-preparation');
export const suite = join(batch, 'launcher-438-candidate-qa-preparation');
export const launcherSource = 'apps/windows-launcher/Launcher.cs';
export const checkoutPath = 'C:\\Users\\98jak\\.codex\\worktrees\\gg-20261116-bounded-logs\\GraphGoblin';
const gitPath = 'C:\\Program Files\\Git\\bin\\git.exe';
export const psPath = 'C:\\Program Files\\WindowsApps\\OpenAI.CodexPrimaryRuntime.v26-1110-778-0_26.1110.778.0_x64__3k8sg7r9htsxt\\dependencies\\native\\powershell\\pwsh.exe';
const commit = /^[a-f0-9]{40}$/u;
const pinnedHelpers = {
  'common.mjs': '54f0a901a702eb78de69a6f0df7f9293e358689cb9a7af1016f906317da03ae4',
  'artifacts.mjs': '479b4a723e12f7d11da926d99c83ced2ab9e26e5eedffc7dd74000c65a806226',
  'build.mjs': 'ce2a08b71e1f662bd6c4e290845f4d05d935c0dcaec152428bba5c74f09004a6',
  'capture-binding.mjs': 'b518d6e9410c3f00ac817734981b7125a04418ba823331a3d1d4de6cb9a821a7',
};
const moduleURL = (path) => pathToFileURL(path).href;

export function realDigest(value) {
  assert(hashPattern.test(value) && !/^0+$/u.test(value), 'Missing exact SHA-256');
}
export async function checkedRef(path, expected, parent, systemFile = false) {
  absolute(path);
  if (parent) await ordinaryFile(path, parent);
  else assert.equal(await realpath(path), path);
  const stat = await lstat(path);
  assert(stat.isFile() && (systemFile || stat.nlink === 1), 'Expected single-link file: ' + path);
  const sha256 = await hash(path);
  if (expected !== undefined) {
    realDigest(expected);
    assert.equal(sha256, expected, path);
  }
  return { path, sha256 };
}
export function admitRef(ref, parent, systemFile = false) {
  realDigest(ref.sha256);
  return checkedRef(ref.path, ref.sha256, parent, systemFile);
}
export function outputPath(path, pattern) {
  absolute(path);
  assert.equal(dirname(path), batch);
  assert.match(basename(path), pattern);
  return path;
}
function winEnvironment() {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  absolute(systemRoot);
  return { SystemRoot: systemRoot, WINDIR: systemRoot };
}
export function compileEnvironment(compiler, output, node) {
  const env = winEnvironment();
  return {
    ...env,
    PATH: [dirname(node.path), dirname(compiler.path), join(env.SystemRoot, 'System32')].join(delimiter),
    TEMP: output,
    TMP: output,
  };
}

export function git(context, args, encoding = 'utf8') {
  return execFileSync(context.git.path, [
    '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args,
  ], {
    cwd: context.job.checkout, encoding, shell: false, windowsHide: true, timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024, env: { ...winEnvironment(), GIT_OPTIONAL_LOCKS: '0' },
  });
}
export async function identity(context) {
  const { job, plan } = context;
  const read = (...args) => git(context, args).trim();
  const indexPath = absolute(read('rev-parse', '--path-format=absolute', '--git-path', 'index').replaceAll('/', '\\'));
  const identity = {
    head: read('rev-parse', 'HEAD'),
    tree: read('rev-parse', 'HEAD^{tree}'),
    actualMain: read('rev-parse', 'refs/remotes/origin/main'),
    actualMainTree: read('rev-parse', 'refs/remotes/origin/main^{tree}'),
    clean: read('status', '--porcelain=v1', '--untracked-files=all', '--no-ahead-behind') === '',
    indexPath,
    indexSha256: await hash(indexPath),
  };
  assert(identity.clean, 'Expected a clean candidate checkout');
  for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'indexSha256'])
    assert.equal(identity[key], job.input[key], key);
  assert.notEqual(identity.head, identity.actualMain);
  for (const ancestor of [job.input.merged381, plan.merged436])
    git(context, ['merge-base', '--is-ancestor', ancestor, identity.actualMain]);
  git(context, ['merge-base', '--is-ancestor', identity.actualMain, identity.head]);
  return identity;
}

export async function openContext(planPath, planSha) {
  const runtime = await currentNode();
  assert.deepEqual(process.execArgv, []);
  assert(!Object.keys(process.env).some((key) => key.toUpperCase() === 'NODE_OPTIONS'));
  const planRef = await admitRef({ path: planPath, sha256: planSha }, batch);
  const plan = await json(planRef.path);
  assert.equal(plan.schema, 'gg438-candidate-freeze-root/v1');
  assert.equal(plan.state, 'root-admitted-freeze');
  assert.match(plan.merged436, commit);
  assert(!/^0+$/u.test(plan.merged436));
  realDigest(plan.launcherSourceSha256);
  realDigest(plan.v4ManifestSha256);

  for (const [name, sha256] of Object.entries(pinnedHelpers)) await checkedRef(join(freeze, name), sha256, batch);
  await admitRef(plan.buildAdmission, batch);
  const job = await readAdmission(plan.buildAdmission.path, plan.buildAdmission.sha256);
  assert.equal(job.input.phase, 'candidate');
  assert.equal(job.checkout, checkoutPath);
  for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'merged381']) assert(!/^0+$/u.test(job.input[key]));
  const node = await checkedRef(runtime.nodePath, runtime.nodeSha256);
  assert.equal(plan.git.path, gitPath);
  const gitRef = await admitRef(plan.git);
  assert.equal(plan.pwsh.path, psPath);
  assert.equal(plan.pwsh.version, '7.6.9');
  const ps = { ...await admitRef(plan.pwsh, undefined, true), version: plan.pwsh.version };
  const compilerPath = await realpath(join(winEnvironment().SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'));
  assert.equal(plan.compiler.path, compilerPath);
  const compiler = await admitRef(plan.compiler, undefined, true);
  outputPath(plan.compileDirectory, /^launcher-438-candidate-compile-[0-9]{2,}$/u);
  outputPath(plan.bindingOutput, /^launcher-438-candidate-binding-[0-9]{2,}\.json$/u);
  outputPath(plan.qaDraftOutput, /^launcher-438-candidate-native-admission-[0-9]{2,}\.proposal\.json$/u);
  assert.match(plan.attempt, /^candidate-attempt-[1-9][0-9]*$/u);

  assert.equal(plan.buildReceipt.path, join(job.directory, 'build-receipt.json'));
  const buildReceipt = await admitRef(plan.buildReceipt, batch);
  const build = await json(buildReceipt.path);
  assert.equal(build.schema, 'gg410-build-receipt/v1');
  assert.equal(build.phase, 'candidate');
  assert.equal(build.admissionPath, plan.buildAdmission.path);
  assert.equal(build.admissionSha256, plan.buildAdmission.sha256);
  assert.equal(build.checkout, job.checkout);
  assert.equal(build.nodePath, node.path);
  assert.equal(build.nodeSha256, node.sha256);
  assert.equal(build.command, 'pnpm.cmd build --force');
  assert(build.cleanAfter && build.artifacts, 'Build closing readback incomplete');
  const refs = {};
  for (const [key, name] of Object.entries({ launch: 'build-launch.json', exit: 'build-exit.json', log: 'build.log' })) {
    assert.equal(build[key].path, join(job.directory, name));
    refs[key] = await admitRef(build[key], batch);
  }
  const rawExit = await json(refs.exit.path);
  assert.equal(rawExit.schema, 'gg410-build-child-exit/v1');
  assert.equal(rawExit.exitCode, 0);
  assert.equal(rawExit.signal, null);
  assert(!Object.hasOwn(rawExit, 'spawnError'));
  assert.deepEqual(rawExit, build.rawExit);

  const context = { plan, planRef, job, buildReceipt, build, refs, node, git: gitRef, ps, compiler };
  const opening = await identity(context);
  assert.deepEqual(opening, build.before);
  assert.deepEqual(opening, build.after);
  return { ...context, opening };
}

export async function checkSource(context) {
  const source = await checkedRef(join(context.job.checkout, launcherSource), context.plan.launcherSourceSha256, context.job.checkout);
  const committed = git(context, ['cat-file', 'blob', 'HEAD:' + launcherSource], null);
  assert.deepEqual(await readFile(source.path), committed, 'Launcher.cs differs from its raw committed blob');
  return source;
}

export async function verifyManifest(context) {
  assert.equal(await realpath(suite), suite);
  const manifest = await checkedRef(join(suite, 'SHA256SUMS.txt'), context.plan.v4ManifestSha256, batch);
  const rows = new Map();
  for (const line of (await readFile(manifest.path, 'utf8')).trimEnd().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  ([a-z0-9][a-z0-9.-]+)$/iu.exec(line);
    assert(match && !rows.has(match[2]), 'Malformed or duplicate V4 manifest row');
    rows.set(match[2], await checkedRef(join(suite, match[2]), match[1], batch));
  }
  const expected = ['README.md', 'full-report.md', 'admission.example.json', 'binding.mjs', 'controls.mjs',
    'launch.ps1', 'native.mjs', 'run.mjs', 'source-provenance.json', 'syntax-readback.json', 'v3-to-v4.patch'];
  assert.deepEqual([...rows.keys()].sort(), expected.sort());
  return { manifest, rows };
}
export const loadModule = (path) => import(moduleURL(path));

