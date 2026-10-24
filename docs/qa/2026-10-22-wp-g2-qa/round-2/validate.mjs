import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { format } from 'prettier';
const root = process.cwd();
const base = resolve('docs/qa/2026-10-22-wp-g2-qa');
const dir = join(base, 'round-2');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function clean(text) {
  let result = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  for (const [path, placeholder] of [
    [root, '<worktree>'],
    [process.env.USERPROFILE, '<user>'],
  ]) {
    for (const variant of [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]) {
      result = result.replace(new RegExp(escape(variant), 'gi'), placeholder);
    }
  }
  return result.replace(
    /(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g,
    '<generated-api-key>',
  );
}
let normalized = 0;
for (const file of await readdir(dir)) {
  const path = join(dir, file);
  const buffer = await readFile(path);
  const text =
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.subarray(2).toString('utf16le')
      : buffer.toString('utf8').replace(/^\uFEFF/, '');
  const portable = clean(text);
  if (!buffer.equals(Buffer.from(portable))) {
    await writeFile(path, portable);
    normalized++;
  }
  assert.ok(!/[A-Za-z]:[\\/]+Users[\\/]/i.test(portable), 'Local user path in ' + file);
}
const before = JSON.parse(await readFile(join(dir, 'round-1-before.json'), 'utf8'));
const changed = [];
for (const file of before) {
  if (digest(await readFile(join(base, file.file))) !== file.sha256) changed.push(file.file);
}
assert.deepEqual(changed, ['REPORT.md']);
const report = await readFile(join(base, 'REPORT.md'), 'utf8');
const restored = report.replace(/^D-030 follow-up:.*\r?\n\r?\n/m, '');
const exact = digest(restored) === before.find((r) => r.file === 'REPORT.md').sha256;
assert.ok(exact, 'Round-1 report changed beyond the note');
await writeFile(
  join(dir, 'round-1-preservation.json'),
  await format(
    JSON.stringify(
      {
        originalFiles: before.length,
        unchangedFiles: before.length - 1,
        changedFiles: changed,
        reportWithoutAddedNoteMatchesOriginalSha256: exact,
      },
      null,
      2,
    ),
    { parser: 'json' },
  ),
);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, 'a9df185eecdb192a79b90665ee682ee7916b2ac0');
assert.equal(
  execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim(),
  '',
);
assert.equal(
  execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim(),
  'docs/qa/2026-10-22-wp-g2-qa/REPORT.md',
);
const checks = (await readFile(join(dir, 'checks.log.txt'), 'utf8'))
  .trim()
  .split('\n')
  .map(JSON.parse);
assert.equal(checks.length, 26);
assert.ok(checks.every((r) => r.result === 'PASS'));
const location = JSON.parse(await readFile(join(dir, 'fixture-location.json'), 'utf8'));
assert.match(location.tempLeaf, /^gg-qa-g2-a9df185-[A-Za-z0-9]+$/);
assert.ok(!existsSync(join(tmpdir(), location.tempLeaf)), 'QA temp root remains');
const open = await new Promise((done) => {
  const socket = createConnection({ host: '127.0.0.1', port: location.port });
  socket.on('connect', () => {
    socket.destroy();
    done(true);
  });
  socket.on('error', () => done(false));
  socket.setTimeout(500, () => {
    socket.destroy();
    done(false);
  });
});
assert.equal(open, false);
const readme = await readFile(join(dir, 'README.md'), 'utf8');
const files = [...new Set([...(await readdir(dir)), 'validation.log.txt'])];
let bytes = 0;
for (const file of files) {
  assert.ok(readme.includes('](' + file + ')'), 'Artifact missing from README inventory: ' + file);
  assert.match(file, /\.(md|txt|mjs|json|ps1)$/);
  if (existsSync(join(dir, file))) bytes += (await stat(join(dir, file))).size;
}
const gates = {};
for (const file of [
  'gate-build',
  'typecheck',
  'lint',
  'check-layers',
  'check-deps',
  'check-licenses',
  'check-tokens',
  'check-docs',
  'format-check',
]) {
  const log = await readFile(join(dir, file + '.log.txt'), 'utf8');
  gates[file] = /Exit: (\d+)/.exec(log)?.[1] ?? 'missing';
  if (file === 'format-check') {
    gates['evidence-format'] = [...log.matchAll(/Scoped exit: (\d+)/g)].at(-1)?.[1] ?? 'missing';
  }
}
assert.ok(
  Object.values(gates).every((exit) => exit === '0'),
  'A final gate has not passed',
);
const result = {
  result: 'PASS',
  head,
  behavioralChecks: 26,
  failedBehavioralChecks: 0,
  round1UnchangedFiles: before.length - 1,
  reportOnlyAddedRequestedNote: exact,
  trackedEdits: ['docs/qa/2026-10-22-wp-g2-qa/REPORT.md'],
  stagedEdits: [],
  qaTempRootRemoved: true,
  qaPort5633Closed: true,
  artifactsLinked: files.length,
  evidenceBytesBeforeThisLog: bytes,
  normalizedTextFiles: normalized,
  localUserPaths: 0,
  gates,
  productFilesChanged: 0,
  commitsCreated: 0,
  providerTurns: 0,
};
await writeFile(join(dir, 'validation.log.txt'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
