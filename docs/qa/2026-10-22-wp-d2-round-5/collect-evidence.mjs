// Preserve readable gate evidence without machine-specific home/worktree paths.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
const root = process.cwd();
const evidence = join(root, 'docs/qa/2026-10-22-wp-d2-round-5');
const logs = join(evidence, 'logs');
await mkdir(logs, { recursive: true });
function sanitize(text) {
  for (const [path, token] of [
    [root, '%WORKTREE%'],
    [process.env.TEMP, '%TEMP%'],
    [homedir(), '%USERPROFILE%'],
  ]) {
    // Pnpm can wrap the drive onto the preceding line in diagnostics.
    const forms = [path, path.replace(/^[A-Za-z]:/, '')];
    for (const form of forms.flatMap((value) => [
      value,
      value.replaceAll('\\', '/'),
      value.replaceAll('\\', '\\\\'),
    ]))
      text = text.replaceAll(form, token);
  }
  return text
    .replaceAll('\u001b', '[ESC]')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+$/gm, '');
}
for (const name of await readdir(root)) {
  if (!/^round5-.*\.(log|txt)$/.test(name)) continue;
  const bytes = await readFile(join(root, name));
  const text =
    bytes[0] === 255 && bytes[1] === 254
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  await writeFile(
    join(logs, name.replace(/\.log$/, '.txt')),
    sanitize(text.replace(/^\uFEFF/, '')),
  );
}
if (process.argv.includes('--snapshots')) {
  const walk = (value) =>
    typeof value === 'string'
      ? sanitize(value)
      : Array.isArray(value)
        ? value.map(walk)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).map(([key, item]) => [sanitize(key), walk(item)]),
            )
          : value;
  for (const folder of ['before', 'after'])
    for (const name of await readdir(join(evidence, folder))) {
      if (!name.endsWith('.json')) continue;
      const file = join(evidence, folder, name);
      await writeFile(
        file,
        JSON.stringify(walk(JSON.parse(await readFile(file, 'utf8'))), null, 2) + '\n',
      );
    }
  const stores = (await readdir(process.env.TEMP))
    .filter((name) => name.startsWith('gg-wp-d2-round5-'))
    .map((name) => '%TEMP%/' + name);
  await writeFile(join(evidence, 'retained-stores.json'), JSON.stringify(stores, null, 2) + '\n');
}
if (process.argv.includes('--coverage')) {
  const coverage = {};
  for (const pkg of [
    'packages/contracts',
    'packages/engine',
    'packages/infrastructure',
    'apps/api',
    'apps/web',
    'packages/api-client',
  ]) {
    const summary = JSON.parse(
      await readFile(join(root, pkg, 'coverage/coverage-summary.json'), 'utf8'),
    );
    coverage[pkg] = Object.fromEntries(
      Object.entries(summary)
        .filter(
          ([key]) =>
            key === 'total' || /[\\/](webhook-returns|delivery|DeliveryPanel)\.(ts|tsx)$/.test(key),
        )
        .map(([key, value]) => [
          key === 'total' ? key : relative(root, key).replaceAll('\\', '/'),
          value,
        ]),
    );
  }
  await writeFile(join(evidence, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
}
await writeFile(
  join(logs, 'head.txt'),
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }),
);
