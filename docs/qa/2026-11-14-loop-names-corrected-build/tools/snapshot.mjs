// Read-only snapshot of source identity and every build output tree. Usage:
//   node snapshot.mjs <repoRoot> <outDir> <label>
// Writes <outDir>/<label>/identity.json and one sha256sum-style listing per dist tree.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

const [root, outDir, label] = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const out = join(outDir, label);
mkdirSync(out, { recursive: true });

const sourcePaths = [
  'apps/web/src/loops/LoopsPage.tsx',
  'apps/web/src/loops/loop-names.test.tsx',
  'apps/web/src/editor/useAutosave.ts',
  'apps/web/src/editor/EditorPage.tsx',
  'apps/web/src/editor/store.ts',
  'apps/web/src/editor/NameConflictNotice.tsx',
  'apps/web/src/editor/EditorPage.name-conflict.test.tsx',
  'docs/09-frontend-and-pwa.md',
  'docs/guide/02-build-a-loop.md',
];
const sources = {};
for (const p of sourcePaths) {
  sources[p] = { sha256: sha(readFileSync(join(root, p))), gitBlob: git('hash-object', p) };
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (lstatSync(p).isSymbolicLink()) throw new Error('symlink in build tree: ' + p);
    return e.isDirectory() ? walk(p) : [p];
  });

const trees = [];
for (const group of ['apps', 'packages', 'tooling']) {
  const g = join(root, group);
  if (!existsSync(g)) continue;
  for (const pkg of readdirSync(g, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    for (const d of ['dist', 'dist-goblin']) {
      const p = join(g, pkg.name, d);
      if (existsSync(p) && statSync(p).isDirectory()) trees.push(`${group}/${pkg.name}/${d}`);
    }
  }
}
const summary = {};
for (const tree of trees) {
  const dir = join(root, tree);
  const files = walk(dir)
    .map((f) => relative(dir, f).replaceAll('\\', '/'))
    .sort();
  let bytes = 0;
  let newest = 0;
  const lines = files.map((rel) => {
    const buf = readFileSync(join(dir, rel));
    bytes += buf.length;
    newest = Math.max(newest, statSync(join(dir, rel)).mtimeMs);
    return `${sha(buf)} *${rel}`;
  });
  const text = lines.join('\n') + '\n';
  writeFileSync(join(out, 'tree-' + tree.replaceAll('/', '_') + '.sha256'), text);
  summary[tree] = {
    files: files.length,
    bytes,
    listingSha256: sha(text),
    newestMtime: new Date(newest).toISOString(),
  };
}
const id = {
  label,
  observedAt: new Date().toISOString(),
  node: process.version,
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  branch: git('branch', '--show-current'),
  statusPorcelainLines: git('status', '--porcelain=v1').split('\n').filter(Boolean).length,
  sources,
  trees: summary,
};
writeFileSync(join(out, 'identity.json'), JSON.stringify(id, null, 2) + '\n');
console.log(
  JSON.stringify({
    label,
    head: id.head,
    tree: id.tree,
    statusLines: id.statusPorcelainLines,
    trees: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.files])),
  }),
);
