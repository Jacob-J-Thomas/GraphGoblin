// Final readback, location redaction and residual inventory. Does not delete anything.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const replacements = [];
for (const [path, label] of [
  [root.replace(/[\\/]$/, ''), '<worktree>'],
  [tmpdir(), '<temp>'],
  [process.env.USERPROFILE, '<user>'],
]) {
  if (!path) continue;
  for (const variant of new Set([path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]))
    replacements.push([variant, label]);
}
replacements.sort((a, b) => b[0].length - a[0].length);
for (const file of await readdir(directory)) {
  if (!/\.(txt|json)$/.test(file)) continue;
  const bytes = await readFile(new URL(file, directory));
  let text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  for (const [path, label] of replacements) text = text.replaceAll(path, label);
  const personalFragment = process.env.USERPROFILE?.split(/[\\/]/).at(-1);
  text = text
    .split(/\r?\n/)
    .map((line) =>
      (personalFragment && line.includes(personalFragment)) || /\\Users\\|\bC:[\\/]/.test(line)
        ? '[local path redacted]'
        : line,
    )
    .join('\n');
  text = text.replace(/\bgg_[A-Za-z0-9_-]+/g, '[redacted-key]');
  await writeFile(new URL(file, directory), text);
}
const items = [];
for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('gg-qa-320-')) continue;
  const path = join(tmpdir(), entry.name),
    metadata = await stat(path);
  const children = await readdir(path, { withFileTypes: true });
  items.push({
    name: entry.name,
    createdAt: metadata.birthtime.toISOString(),
    topLevel: children.map((child) => ({ name: child.name, directory: child.isDirectory() })),
    databasePresent: children.some((child) => /\.db(?:-|$)/.test(child.name)),
  });
}
await writeFile(
  new URL('cleanup-manifest.json', directory),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope: '<TEMP>/gg-qa-320-*',
      status:
        'Incomplete: original fixture cleanup left residuals; explicit manual retry was blocked by policy',
      deletedByThisInventory: false,
      items,
    },
    null,
    2,
  ) + '\n',
);
const git = (...args) =>
  execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8' }).trim();
await writeFile(
  new URL('final-state.txt', directory),
  [
    new Date().toISOString(),
    `Node ${process.version}`,
    `HEAD ${git('rev-parse', 'HEAD')}`,
    `Branch ${git('branch', '--show-current')}`,
    'Tracked diff:',
    git('diff', '--name-only') || '(none)',
    'Status:',
    git('status', '--short'),
  ].join('\n') + '\n',
);
console.log(
  JSON.stringify({
    residualDirectories: items.length,
    stores: items.filter((i) => i.databasePresent).length,
    trackedDiff: git('diff', '--name-only') || '(none)',
  }),
);
