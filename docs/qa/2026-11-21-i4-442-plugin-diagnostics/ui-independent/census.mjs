// Read-only SHA-256 census of a directory tree (or of the repo's built outputs).
// Usage:
//   node census.mjs tree <root> <out.json>
//   node census.mjs built <repo> <out.json>   (every workspace package's dist/** and dist-goblin/**)
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const [mode, root, out] = process.argv.slice(2);
if (!mode || !root || !out) throw new Error('usage: census.mjs tree|built <root> <out.json>');

async function walk(dir, base, rows) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return rows;
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, rows);
    else if (entry.isFile()) {
      const bytes = await readFile(full);
      rows.push({
        path: relative(base, full).split('\\').join('/'),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      });
    }
  }
  return rows;
}

const rows = [];
if (mode === 'tree') await walk(root, root, rows);
else if (mode === 'built') {
  for (const group of ['apps', 'packages']) {
    for (const pkg of await readdir(join(root, group), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const outDir of ['dist', 'dist-goblin']) {
        const dir = join(root, group, pkg.name, outDir);
        if ((await stat(dir).catch(() => undefined))?.isDirectory()) await walk(dir, root, rows);
      }
    }
  }
} else throw new Error('unknown mode ' + mode);
rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
await writeFile(
  out,
  JSON.stringify({ mode, root, generated: new Date().toISOString(), count: rows.length, files: rows }, null, 2) + '\n',
);
console.log(JSON.stringify({ mode, root, count: rows.length }));
