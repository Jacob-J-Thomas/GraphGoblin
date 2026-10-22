// The user explicitly requires removal of QA-created stores, including retained suite fixtures.
import assert from 'node:assert/strict';
import { lstat, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = await realpath(process.cwd());
const parent = resolve(root, '.tmp');
const results = [];
const allowed = new Set([
  'controlled-gh.cjs',
  'fake-gh.mjs',
  'gg.db',
  'gg.db-shm',
  'gg.db-wal',
  'pages.json',
]);
for (const entry of await readdir(parent, { withFileTypes: true })) {
  if (!/^github-recipe-[0-9a-f-]{36}$/.test(entry.name)) continue;
  const path = join(parent, entry.name);
  assert.equal(dirname(path), parent);
  assert.equal(await realpath(path), path);
  const stat = await lstat(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.ok(stat.birthtimeMs >= Date.parse('2026-10-22T00:49:00Z'));
  const files = await readdir(path, { withFileTypes: true });
  assert.ok(files.some((file) => file.name === 'gg.db'));
  assert.ok(files.every((file) => file.isFile() && allowed.has(file.name)));
  const record = {
    path: '%WORKTREE%/.tmp/' + entry.name,
    files: files.map((file) => file.name),
    removed: false,
  };
  results.push(record);
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    record.removed = true;
  } catch (error) {
    record.error = error.code;
    process.exitCode = 1;
  }
}
const temp = (await readdir(tmpdir())).filter((name) => name.startsWith('gg-qa-246-'));
await writeFile(
  join(root, 'docs/qa/2026-10-21-wp-d2-qa/suite-store-cleanup.json'),
  JSON.stringify({ results, remainingOwnTempEntries: temp, sourceArchiveRetained: true }, null, 2) +
    '\n',
);
console.log(
  JSON.stringify({
    stores: results.length,
    removed: results.filter((record) => record.removed).length,
    temp,
  }),
);
