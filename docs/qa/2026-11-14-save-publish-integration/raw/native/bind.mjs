// Binding for the dirty #237 + #209 integration candidate (uncommitted merge in progress).
// Usage: node bind.mjs <worktree> <source-paths.json> <out.json>
// Records HEAD, MERGE_HEAD, HEAD tree, porcelain status and a digest of `git ls-files -s` (the
// index, which still holds the unresolved useAutosave stages), the working-file sha256 of every
// bound source, and the sha256 of every file in the built trees. Read-only toward the worktree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const worktree = await realpath(process.argv[2]);
const sourcePaths = JSON.parse(await readFile(process.argv[3], 'utf8'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
  execFileSync('git', args, { cwd: worktree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
export const identity = () => ({
  head: git('rev-parse', 'HEAD'),
  mergeHead: git('rev-parse', 'MERGE_HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  status: git('status', '--porcelain=v1'),
  index: digest(git('ls-files', '-s')),
});
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}
const trees = [
  'apps/web/dist', 'apps/web/dist-goblin', 'apps/api/dist', 'apps/mcp/dist',
  'apps/plugin-codex/dist', 'apps/plugin-claude/dist',
  ...(await readdir(join(worktree, 'packages'))).map((p) => 'packages/' + p + '/dist'),
];
const built = {};
for (const tree of trees) {
  let list;
  try { list = await files(join(worktree, tree)); } catch { continue; }
  for (const file of list.sort())
    built[relative(worktree, file).split('\\').join('/')] = digest(await readFile(file));
}
const sourceHashes = Object.fromEntries(await Promise.all(
  sourcePaths.map(async (f) => [f, digest(await readFile(join(worktree, f)))])));
const record = {
  observedAt: new Date().toISOString(),
  ...identity(),
  sourceHashes,
  builtFileCount: Object.keys(built).length,
  builtManifestSha256: digest(Object.entries(built).map(([f, h]) => h + '  ' + f).join('\n')),
  built,
};
await writeFile(process.argv[4], JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ head: record.head, mergeHead: record.mergeHead, index: record.index,
  sources: sourcePaths.length, builtFileCount: record.builtFileCount,
  builtManifestSha256: record.builtManifestSha256 }));
