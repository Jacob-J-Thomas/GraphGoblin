const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const folder = 'docs/qa/2026-10-22-web-test-stability';
const snapshot = path.join(process.env.TEMP, 'gg-chore-web-round3-raw-before.json');
function walk(dir) { return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const rows = walk(folder).filter(file => /\.(json|ya?ml|[cm]?[jt]s)$/.test(file)).map(file => ({file: file.replaceAll('\\', '/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
if (process.argv.includes('--check')) {
  const before = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
  const current = new Map(rows.map(row => [row.file, row.sha256]));
  const changed = before.filter(row => current.get(row.file) !== row.sha256);
  console.log(JSON.stringify({snapshottedFiles: before.length, changed, addedFiles: rows.length - before.length}));
  if (changed.length) process.exitCode = 1;
} else {
  fs.writeFileSync(snapshot, JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify({snapshottedFiles: rows.length}));
}
