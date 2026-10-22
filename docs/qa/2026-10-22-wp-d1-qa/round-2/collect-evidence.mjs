// Read back only this QA round. Never edit round-1 files or delete arbitrary temporary data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = new URL('.', import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const replacements = [];
for (const [path, label] of [
  [root.replace(/[\\/]$/, ''), '<worktree>'],
  [tmpdir(), '<TEMP>'],
  [process.env.USERPROFILE, '<user>'],
]) {
  if (!path) continue;
  for (const variant of new Set([path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]))
    replacements.push([variant, label]);
}
replacements.sort((a, b) => b[0].length - a[0].length);
for (const name of await readdir(here)) {
  if (!/\.(txt|json)$/.test(name)) continue;
  const bytes = await readFile(new URL(name, here));
  let text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  text = text.replace(/^\uFEFF/, '');
  if (name.endsWith('.txt') && /^START /m.test(text) && !/^END /m.test(text)) continue;
  for (const [path, label] of replacements) text = text.replaceAll(path, label);
  const personal = process.env.USERPROFILE?.split(/[\\/]/).at(-1);
  text = text
    .split(/\r?\n/)
    .map((line) =>
      (personal && line.includes(personal)) || /\\Users\\|\bC:[\\/]/.test(line)
        ? '[local path redacted]'
        : line,
    )
    .join('\n');
  text = text.replace(/\bgg_[A-Za-z0-9_-]+/g, '[redacted-key]');
  await writeFile(new URL(name, here), text);
}
const json = async (name) =>
  JSON.parse((await readFile(new URL(name, here), 'utf8')).replace(/^\uFEFF/, ''));
const before = await json('round-1-before.json');
const changedRound1 = [];
for (const record of before) {
  const bytes = await readFile(new URL('../' + record.name, here));
  if (createHash('sha256').update(bytes).digest('hex').toUpperCase() !== record.sha256)
    changedRound1.push(record.name);
}
const cases = [],
  independentStores = [];
for (const name of await readdir(here)) {
  if (!/^(sweep-|nested-|random-child-).*\.json$/.test(name)) continue;
  const result = await json(name);
  const previous = result.atKill.runs.filter((r) => r.parent_run_id).map((r) => r.id);
  for (const id of previous) assert.ok(result.done.runs.some((r) => r.id === id));
  cases.push({
    name,
    pass: true,
    previouslyAdmittedChildren: previous.length,
    observations: result.observations,
    gaps: result.atKill.gaps.length + result.done.gaps.length,
  });
}
for (const name of [
  'admitted-before-park',
  'finished-before-node',
  'failure-before-parent',
  'mapping-retry',
]) {
  try {
    const result = await json(name + '.json'),
      done = result.after.done ?? result.after;
    for (const r of result.before.runs.filter((r) => r.parent_run_id))
      assert.ok(done.runs.some((x) => x.id === r.id));
    cases.push({ name, pass: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (const name of ['process-summary.json', 'process-summary-random.json']) {
  try {
    independentStores.push(...(await json(name)).results.filter((r) => r.cleanup));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const residuals = [];
for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('gg-qa-320-')) continue;
  const children = await readdir(join(tmpdir(), entry.name), { withFileTypes: true });
  residuals.push({
    name: entry.name,
    entries: children.map((c) => ({ name: c.name, directory: c.isDirectory() })),
  });
}
const listening = await Promise.all(
  Array.from(
    { length: 10 },
    (_, i) =>
      new Promise((resolvePort) => {
        const port = 5920 + i,
          socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.destroy();
          resolvePort(port);
        });
        socket.once('error', () => {
          socket.destroy();
          resolvePort(null);
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          resolvePort(null);
        });
      }),
  ),
);
const git = (...args) =>
  execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD'),
  diff = git('diff', '--name-only');
const record = {
  timestamp: new Date().toISOString(),
  head,
  node: process.version,
  round1FilesVerified: before.length,
  changedRound1,
  trackedDiff: diff ? diff.split('\n') : [],
  cases,
  independentStores,
  residuals,
  listeningApiPorts: listening.filter(Boolean),
};
await writeFile(new URL('final-readback.json', here), JSON.stringify(record, null, 2) + '\n');
await writeFile(
  new URL('final-state.txt', here),
  `HEAD ${head}\nNode ${process.version}\nTracked diff: ${diff || '(none)'}\nStatus:\n${git('status', '--short')}\n`,
);
assert.equal(head, '58c2cd81870b9e97d885fd31cabc6ed80ce4474a');
assert.equal(changedRound1.length, 0);
assert.equal(diff, '');
console.log(
  JSON.stringify({
    round1FilesVerified: before.length,
    changedRound1,
    independentCases: cases.length,
    residualRoots: residuals.length,
    listeningApiPorts: record.listeningApiPorts,
  }),
);
