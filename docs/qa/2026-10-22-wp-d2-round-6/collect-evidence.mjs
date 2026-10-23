import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = fileURLToPath(new URL('.', import.meta.url));
const replacements = [
  [root, '%WORKTREE%'],
  [tmpdir(), '%TEMP%'],
  [homedir(), '%USERPROFILE%'],
  [homedir().slice(2), '%USERPROFILE%'],
];
function sanitize(value) {
  let text = stripVTControlCharacters(value);
  for (const [path, placeholder] of replacements) {
    for (const initial of [path, path.replaceAll('\\', '/')]) {
      let variant = initial;
      // A log can itself be JSON inside a JSON evidence file. Redact every escaping depth.
      while (variant.length <= text.length) {
        text = text.split(variant).join(placeholder);
        const escaped = variant.replaceAll('\\', '\\\\');
        if (escaped === variant) break;
        variant = escaped;
      }
    }
  }
  return (
    text
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd() + '\n'
  );
}
await mkdir(join(output, 'logs'), { recursive: true });
for (const name of await readdir(root)) {
  if (!/^round6-.*\.(log|json)$/.test(name)) continue;
  const buffer = await readFile(join(root, name));
  const text = buffer
    .toString(buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8')
    .replace(/^\uFEFF/, '');
  await writeFile(join(output, 'logs', name.replace(/\.log$/, '.txt')), sanitize(text));
}
const retained = [];
for (const phase of ['before', 'after', 'final']) {
  const folder = join(tmpdir(), 'gg-wp-d2-round6-' + phase);
  for (const name of ['migration-boundaries.json', 'migration-boundaries-check.json']) {
    const raw = await readFile(join(folder, name), 'utf8');
    await writeFile(join(output, `${phase}-${name}`), sanitize(raw));
    if (name === 'migration-boundaries.json') {
      const evidence = JSON.parse(raw);
      retained.push({ phase, store: evidence.store });
      if (phase === 'final') {
        const converted = evidence.cases.filter(
          (entry) => entry.after.type === 'delivery.finished',
        );
        assert.equal(converted.length, 11);
        for (const entry of converted) {
          assert.equal(entry.oldValid, true, entry.name);
          assert.equal(entry.newValid, true, entry.name);
          assert.equal(entry.httpStatus, 200, entry.name);
        }
        await writeFile(
          join(output, 'final-rest-check.json'),
          JSON.stringify(
            {
              converted: converted.length,
              currentContractValid: converted.length,
              eventsHttp200: converted.length,
            },
            null,
            2,
          ) + '\n',
        );
      }
    }
  }
}
await writeFile(join(output, 'retained-stores.json'), sanitize(JSON.stringify(retained, null, 2)));
for (const name of ['migration-boundaries.mjs', 'migration-boundaries-check.mjs'])
  await copyFile(join(tmpdir(), 'gg-audit-d2-round2-20261022', name), join(output, name));
const coverage = {};
for (const [name, folder] of Object.entries({
  infrastructure: 'packages/infrastructure',
  engine: 'packages/engine',
  api: 'apps/api',
  web: 'apps/web',
})) {
  const data = JSON.parse(
    await readFile(resolve(folder, 'coverage/coverage-summary.json'), 'utf8'),
  );
  coverage[name] = Object.fromEntries(
    Object.entries(data).filter(
      ([file]) => file === 'total' || /[\\/](db|upgrade|webhook-receipt-upgrade)\.ts$/.test(file),
    ),
  );
}
await writeFile(join(output, 'coverage.json'), sanitize(JSON.stringify(coverage, null, 2)));
