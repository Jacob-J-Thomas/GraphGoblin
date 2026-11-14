// Read-only replica of the ownership test in tooling/plugin-output.mjs (inspectOutput) for the two plugin outputs.
// An output is "owned" only when its .graphgoblin-plugin-output.json (format 1, matching kind) lists exactly the files
// present, every file hash matches, and every directory is derived from those files. Nothing is written or removed here.
// Usage: node verify-plugin-ownership.mjs <checkout> <result.json>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = await realpath(process.argv[2]);
const outputs = [
  { path: 'apps/plugin-codex/dist/marketplace', kind: 'codex-marketplace' },
  { path: 'apps/plugin-claude/dist/plugin/graphgoblin', kind: 'claude-plugin' },
];
const manifestName = '.graphgoblin-plugin-output.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const { path, kind } of outputs) {
  const base = join(root, path);
  const record = { path, kind, owned: false, problems: [] };
  const metadata = JSON.parse(await readFile(join(base, manifestName), 'utf8'));
  if (metadata.format !== 1) record.problems.push('format is not 1');
  if (metadata.kind !== kind) record.problems.push('kind ' + metadata.kind + ' != ' + kind);
  const listed = Object.keys(metadata.files);
  const directories = new Set();
  for (const file of listed) {
    const parts = file.split('/');
    while (parts.length > 1) { parts.pop(); directories.add(parts.join('/')); }
  }
  const actualFiles = [];
  const actualDirectories = [];
  const walk = async (directory) => {
    for (const entry of await readdir(join(base, directory), { withFileTypes: true })) {
      const name = directory ? directory + '/' + entry.name : entry.name;
      const info = await lstat(join(base, name));
      if (info.isSymbolicLink()) { record.problems.push('link ' + name); continue; }
      if (entry.isDirectory()) { actualDirectories.push(name); await walk(name); }
      else if (entry.isFile()) actualFiles.push(name);
    }
  };
  await walk('');
  const fileSet = new Set([...listed, manifestName]);
  for (const file of actualFiles) if (!fileSet.has(file)) record.problems.push('foreign file ' + file);
  for (const directory of actualDirectories) if (!directories.has(directory)) record.problems.push('foreign directory ' + directory);
  for (const file of listed) {
    let actual;
    try { actual = digest(await readFile(join(base, file))); } catch { record.problems.push('missing ' + file); continue; }
    if (actual !== metadata.files[file]) record.problems.push('hash mismatch ' + file);
  }
  record.listedFiles = listed.length;
  record.actualFilesIncludingManifest = actualFiles.length;
  record.directories = actualDirectories.length;
  record.manifestSha256 = digest(await readFile(join(base, manifestName)));
  record.owned = record.problems.length === 0 && actualFiles.length === listed.length + 1;
  results.push(record);
}
await writeFile(process.argv[3], JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify(results.map((row) => ({ path: row.path, owned: row.owned, listed: row.listedFiles, actual: row.actualFilesIncludingManifest, problems: row.problems })), null, 2));
assert(results.every((row) => row.owned), 'A plugin output is not owned by its builder; do not replace it');
