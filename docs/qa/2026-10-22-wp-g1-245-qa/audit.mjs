import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('./', import.meta.url));
const files = await readdir(out);
const report = await readFile(join(out, 'README.md'), 'utf8');
let jsonCount = 0;
for (const file of files) {
  if (file !== 'README.md') assert.ok(report.includes(`](${file})`), `unlinked artifact: ${file}`);
  if (!/\.(?:log|md|mjs|json)$/.test(file)) continue;
  const bytes = await readFile(join(out, file));
  const value =
    bytes[0] === 255 && bytes[1] === 254
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  assert.ok(!value.includes(basename(homedir())), `local user path in ${file}`);
  assert.ok(!value.includes('\0'), `unexpected binary text in ${file}`);
  if (file.endsWith('.json')) {
    JSON.parse(value);
    jsonCount++;
  }
}
const message = `PASS: ${files.length - 1} artifacts linked; ${jsonCount} JSON files parse; no local user paths or NUL text.\n`;
await writeFile(join(out, 'audit.log'), message);
process.stdout.write(message);
