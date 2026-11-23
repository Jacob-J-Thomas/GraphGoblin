// D167 independent QA (QA167I) setup verification. Not product code. Read-only against the checkout.
// node setup-verify.mjs <checkout> <record.json>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [checkout, recordPath] = process.argv.slice(2);
if (existsSync(recordPath)) throw new Error('record exists; never overwritten');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).replace(/\n$/, '');
const gitBytes = (...args) => execFileSync('git', ['-C', checkout, ...args], { maxBuffer: 64 * 1024 * 1024 });
const EXPECT = {
  head: '184c95ac2d08590e258c084723eb9ab379f0bbe5',
  tree: '404700711621832629aef6d505b69076972474da',
  parent: 'c6f08d4a62c1488690096f69f577a68c6d382cbc',
  target: '47ca4640793a81efa5bec661dba25627de314774',
};
const record = { schema: 'qa167i-setup/1', utc: new Date().toISOString(), expected: EXPECT, checks: [] };
const check = (name, pass, detail) => record.checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });

record.git = {
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  parents: git('log', '-1', '--format=%P').split(' ').filter(Boolean),
  mergeBaseWithTarget: git('merge-base', 'HEAD', EXPECT.target),
  targetIsAncestor: spawnSync('git', ['-C', checkout, 'merge-base', '--is-ancestor', EXPECT.target, 'HEAD']).status === 0,
  statusAllUntracked: git('status', '--porcelain=v1', '--untracked-files=all'),
  statusTracked: git('status', '--porcelain=v1', '--untracked-files=no'),
  changedFromParent: git('diff', '--name-only', EXPECT.parent, 'HEAD').split('\n').filter(Boolean),
};
check('head', record.git.head === EXPECT.head, record.git.head);
check('tree', record.git.tree === EXPECT.tree, record.git.tree);
check('sole parent', record.git.parents.length === 1 && record.git.parents[0] === EXPECT.parent, record.git.parents);
check('target is ancestor', record.git.targetIsAncestor && record.git.mergeBaseWithTarget === EXPECT.target);
check('clean tracked state', record.git.statusTracked === '');
check('no untracked non-ignored files', record.git.statusAllUntracked === '');

// Exact source bytes: worktree versus committed blob, for every path the candidate changed plus
// the launcher sources and acceptance tooling this QA compiles or runs.
const paths = [...new Set([
  ...record.git.changedFromParent,
  'apps/windows-launcher/Launcher.cs',
  'apps/windows-launcher/NativeChecks.cs',
  'tooling/scripts/windows-launcher.acceptance.mjs',
  'tooling/scripts/windows-launcher-evidence.mjs',
  'scripts/install-windows-launcher.ps1',
  'apps/api/src/instance-identity.ts',
  'apps/api/src/data-dir-lock.ts',
])].sort();
record.sources = {};
for (const path of paths) {
  const work = readFileSync(join(checkout, path));
  const blob = gitBytes('cat-file', 'blob', `HEAD:${path}`);
  record.sources[path] = { worktreeSha256: sha256(work), committedSha256: sha256(blob), gitObject: git('rev-parse', `HEAD:${path}`), bytes: work.length };
  check(`worktree bytes equal committed: ${path}`, sha256(work) === sha256(blob));
}
const admission = JSON.parse(readFileSync(join(process.argv[1], '..', '..', 'admission.json'), 'utf8'));
for (const [path, item] of Object.entries(admission.files))
  check(`admission-recorded hash: ${path}`, record.sources[path]?.worktreeSha256 === item.worktreeSha256);

// Built inputs used at runtime by the launcher and maintained native group.
record.built = {};
for (const path of [
  'apps/api/dist/main.js',
  'apps/api/dist/instance-identity.js',
  'apps/api/dist/data-dir-lock.js',
  'apps/api/dist/windows-log/guard.js',
  'apps/web/dist/index.html',
]) {
  const full = join(checkout, path);
  record.built[path] = existsSync(full) ? { sha256: sha256(readFileSync(full)), bytes: readFileSync(full).length } : null;
  check(`built file present: ${path}`, record.built[path] !== null);
}

// Runtime and compiler.
record.runtime = { node: process.version, execPath: process.execPath, platform: process.platform, arch: process.arch };
check('node 22.23.4', process.version === 'v22.23.4');
const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const csc = spawnSync(compiler, ['/help'], { encoding: 'utf8', windowsHide: true });
record.compiler = { path: compiler, sha256: sha256(readFileSync(compiler)), bytes: readFileSync(compiler).length, banner: (csc.stdout || '').split('\n').slice(0, 2).map((line) => line.trim()) };
const pnpm = spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd --version'], { encoding: 'utf8', windowsHide: true, cwd: checkout });
record.pnpm = { version: (pnpm.stdout || '').trim(), exit: pnpm.status };
check('pnpm.cmd 12.8.1', record.pnpm.version === '12.8.1');
record.pass = record.checks.every((item) => item.pass);
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ pass: record.pass, checks: record.checks.length, failed: record.checks.filter((item) => !item.pass).map((item) => item.name) }));
