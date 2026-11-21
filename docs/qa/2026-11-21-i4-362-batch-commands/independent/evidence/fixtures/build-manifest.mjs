// sha256 manifest of every file under the evidence root except provider/ (reserved to the runner)
// and manifest.json itself. Usage: node build-manifest.mjs <evidenceRoot>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (rel === 'provider' || rel.startsWith('provider/') || rel === 'manifest.json') continue;
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(full);
      files.push({ path: rel, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    } else files.push({ path: rel, type: entry.isSymbolicLink() ? 'symlink' : 'other' });
  }
})(root);
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  schema: 'gg-qa-manifest/1',
  issue: 362,
  generatedAt: new Date().toISOString(),
  root: root.replaceAll('\\', '/'),
  excluded: ['provider/ (reserved to runner)', 'manifest.json (self)'],
  source: { head: '02351e2fb932b3be44e7cc3fb3943a61d568226c', tree: 'd289bb12b943557584c5659bc33447d1baebc2f6' },
  fileCount: files.length,
  files,
};
fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`files=${files.length}`);
for (const f of files.filter((x) => !x.path.startsWith('work/'))) console.log(`${f.sha256 ?? f.type}  ${f.path}`);
