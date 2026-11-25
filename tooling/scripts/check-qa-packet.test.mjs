import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, test } from 'vitest';

const cli = fileURLToPath(new URL('./check-qa-packet.mjs', import.meta.url));
const prettierBin = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
const repositoryPrettierConfig = readFileSync(new URL('../../.prettierrc', import.meta.url));
// The repository's line-ending rule, the first line of its .gitattributes.
const TEXT_RULE = '* text=auto eol=lf';
const repositoryTextRule = readFileSync(new URL('../../.gitattributes', import.meta.url), 'utf8')
  .split('\n')[0]
  .trimEnd();
const scratch = mkdtempSync(join(realpathSync.native(tmpdir()), 'gg-check-qa-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

// Disposable repositories ignore the caller's Git environment and system or user configuration.
const emptyGitConfig = join(scratch, 'empty.gitconfig');
writeFileSync(emptyGitConfig, '');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_CEILING_DIRECTORIES: scratch,
  GIT_AUTHOR_NAME: 'QA fixture',
  GIT_AUTHOR_EMAIL: 'qa-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'QA fixture',
  GIT_COMMITTER_EMAIL: 'qa-fixture@example.invalid',
};

const FORMATTED = '# QA packet\n\nEvidence summary.\n';
const UNFORMATTED = '#  QA packet\n* first finding\n* second finding\n';
const HIDDEN = 'an ignore rule hides it from format:check; checked here';
const NOT_CHECKED_OUT = 'not in this working tree (sparse checkout or skip-worktree); not checked';
const REMOVED =
  'removed from the working tree although its addition is committed or staged; not checked';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });
const check = (cwd, ...args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
const write = (root, path, content) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};
const read = (root, path) => readFileSync(join(root, path));
const sha256 = (content) => `sha256=${createHash('sha256').update(content).digest('hex')}`;
/** The report's per-path lines as [label, path, note], in report order. */
const listed = (stdout) =>
  [...stdout.matchAll(/^ {2}(\S+) +(.+?)(?: {2}\[(.*)\])?$/gm)].map(([, label, path, note]) => [
    label,
    path,
    note ?? '',
  ]);

let repositories = 0;
/**
 * A repository with a spaced path whose `main` holds historical QA evidence, including an
 * unformatted raw original kept by an archive ignore rule, checked out on a `feature` branch.
 */
function repository(files = {}) {
  const root = join(scratch, `qa repository ${++repositories}`);
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  write(root, '.prettierrc', repositoryPrettierConfig);
  write(root, '.prettierignore', 'docs/qa/**/*.json\ndocs/qa/archive-packet/**\n');
  write(root, '.gitignore', '*.log\n');
  write(root, 'README.md', FORMATTED);
  write(root, 'docs/qa/2026-11-01-historical/README.md', FORMATTED);
  write(root, 'docs/qa/archive-packet/author/report-original.md', UNFORMATTED);
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'historical evidence');
  git(root, 'switch', '--quiet', '-c', 'feature');
  return root;
}

test('new formatted prose passes and a raw original stored as .md.txt keeps its exact bytes', () => {
  const root = repository();
  const raw = '#  Raw reviewer report\r\n* kept   exactly \r\n';
  write(root, 'docs/qa/2026-11-24-new/README.md', FORMATTED);
  write(root, 'docs/qa/2026-11-24-new/author/report.md.txt', raw);
  write(root, 'docs/qa/2026-11-24-new/original-final-audit/notes.md', FORMATTED);
  write(root, 'docs/qa/2026-11-24-new/result.json', '{"compact":true}');
  git(root, 'add', 'docs/qa/2026-11-24-new/author/report.md.txt');
  const historical = read(root, 'docs/qa/archive-packet/author/report-original.md');

  const result = check(root, '--base', 'main');

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^check:qa: .*pnpm format:check and CI remain the full gates\.$/m);
  assert.match(
    result.stdout,
    new RegExp(`^Base: main = ${git(root, 'rev-parse', 'main').trim()}$`, 'm'),
  );
  assert.deepEqual(listed(result.stdout), [
    ['formatted', 'docs/qa/2026-11-24-new/README.md', ''],
    ['retained', 'docs/qa/2026-11-24-new/author/report.md.txt', sha256(raw)],
    ['formatted', 'docs/qa/2026-11-24-new/original-final-audit/notes.md', ''],
    ['retained', 'docs/qa/2026-11-24-new/result.json', sha256('{"compact":true}')],
  ]);
  assert.match(
    result.stdout,
    /^Selected docs\/qa paths: 4 = checked with Prettier 2 \(Markdown 2\) \+ refused Markdown originals 0 \+ retained archived originals 2 \+ deleted 0 \+ unavailable 0$/m,
  );
  assert.match(
    result.stdout,
    /^Result: passed \(every selected path was checked, retained or deleted\)\.$/m,
  );
  assert.deepEqual(read(root, 'docs/qa/2026-11-24-new/author/report.md.txt'), Buffer.from(raw));
  assert.deepEqual(read(root, 'docs/qa/archive-packet/author/report-original.md'), historical);
});

test('unformatted new prose fails without writing, from a spaced subdirectory', () => {
  const root = repository();
  const packet = 'docs/qa/2026-11-24 spaced packet';
  write(root, `${packet}/QA notes.md`, UNFORMATTED);
  write(root, `${packet}/capture.html`, '<p>Evidence</p>');
  write(root, `${packet}/raw copy.md.txt`, UNFORMATTED);

  const result = check(join(root, packet), '--base', 'main');

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['UNFORMATTED', `${packet}/QA notes.md`, ''],
    ['UNFORMATTED', `${packet}/capture.html`, ''],
    ['retained', `${packet}/raw copy.md.txt`, sha256(UNFORMATTED)],
  ]);
  assert.match(result.stdout, /^UNFORMATTED: format reader-facing pages .*prettier --write/m);
  assert.match(result.stdout, /Never format an immutable original/);
  assert.match(
    result.stdout,
    /^Result: FAILED \(2 problems; 0 of 3 selected paths not checked\)\.$/m,
  );
  assert.equal(read(root, `${packet}/QA notes.md`).toString(), UNFORMATTED);
  assert.equal(read(root, `${packet}/capture.html`).toString(), '<p>Evidence</p>');
});

test('new Markdown hidden by an archive ignore rule is still checked, unlike prettier --check', () => {
  const root = repository();
  write(root, 'docs/qa/archive-packet/summary.md', UNFORMATTED);
  write(root, 'docs/qa/archive-packet/reading-note.md', FORMATTED);

  // Control: the full formatter skips the malformed page because the archive rule hides it.
  const hosted = spawnSync(
    process.execPath,
    [prettierBin, '--check', 'docs/qa/archive-packet/summary.md'],
    { cwd: root, env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(hosted.status, 0, hosted.stdout + hosted.stderr);
  assert.match(hosted.stdout, /All matched files use Prettier code style/);

  const result = check(root, '--base', 'main');

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['formatted', 'docs/qa/archive-packet/reading-note.md', HIDDEN],
    ['UNFORMATTED', 'docs/qa/archive-packet/summary.md', HIDDEN],
  ]);
  assert.match(result.stdout, /--ignore-path \.gitignore/);
  assert.equal(read(root, 'docs/qa/archive-packet/summary.md').toString(), UNFORMATTED);
});

test('a newly added Markdown original is refused by its name; historical and other uses are not', () => {
  const root = repository({ 'docs/qa/2026-11-01-historical/README-original.md': FORMATTED });
  const extended = `${FORMATTED}\nAppended note.\n`;
  write(root, 'docs/qa/2026-11-01-historical/README-original.md', extended);
  write(root, 'docs/qa/2026-11-24-new/author/report.original.md', FORMATTED);
  write(root, 'docs/qa/2026-11-24-new/QA Original.md', FORMATTED);
  write(root, 'docs/qa/2026-11-24-new/original-hash-verification.md', FORMATTED);
  write(root, 'docs/qa/2026-11-24-new/report.original.md.txt', UNFORMATTED);
  write(root, 'docs/qa/archive-packet/review-original.md', UNFORMATTED);
  git(root, 'add', 'docs/qa/2026-11-24-new/author/report.original.md');

  const result = check(root, '--base', 'main');

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['formatted', 'docs/qa/2026-11-01-historical/README-original.md', ''],
    ['MD-ORIGINAL', 'docs/qa/2026-11-24-new/QA Original.md', sha256(FORMATTED)],
    ['MD-ORIGINAL', 'docs/qa/2026-11-24-new/author/report.original.md', sha256(FORMATTED)],
    ['formatted', 'docs/qa/2026-11-24-new/original-hash-verification.md', ''],
    ['retained', 'docs/qa/2026-11-24-new/report.original.md.txt', sha256(UNFORMATTED)],
    ['MD-ORIGINAL', 'docs/qa/archive-packet/review-original.md', sha256(UNFORMATTED)],
  ]);
  // A raw original is never told to be formatted; it is told to keep its bytes as .md.txt.
  assert.doesNotMatch(result.stdout, /^UNFORMATTED/m);
  assert.match(result.stdout, /^MD-ORIGINAL: store an immutable Markdown original .*\.md\.txt/m);
  assert.match(
    result.stdout,
    /^Result: FAILED \(3 problems; 0 of 6 selected paths not checked\)\.$/m,
  );
  assert.equal(read(root, 'docs/qa/archive-packet/review-original.md').toString(), UNFORMATTED);
});

test('no changed QA path passes and still reports the base', () => {
  const root = repository();
  write(root, 'README.md', UNFORMATTED);
  write(root, 'notes/draft.md', UNFORMATTED);
  git(root, 'commit', '--quiet', '-am', 'change outside docs/qa');

  const result = check(root, '--base=main');

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^Base: main = [0-9a-f]{40}$/m);
  assert.match(result.stdout, /^Selected docs\/qa paths: 0 = /m);
  assert.deepEqual(listed(result.stdout), []);
  assert.match(result.stdout, /^No docs\/qa path changed; nothing to check\.$/m);
  assert.match(result.stdout, /^Result: passed /m);
});

test('a sparse checkout fails on selected paths it lacks while deletions stay deletions', () => {
  const root = repository({
    'docs/qa/hidden/retired.md': FORMATTED,
    'docs/qa/visible/README.md': FORMATTED,
  });
  write(root, 'docs/qa/hidden/new.md', FORMATTED);
  git(root, 'rm', '--quiet', 'docs/qa/hidden/retired.md');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'packet outside the sparse cone');
  git(root, 'sparse-checkout', 'set', '--cone', 'docs/qa/visible');
  assert.throws(() => read(root, 'docs/qa/hidden/new.md'), { code: 'ENOENT' });
  write(root, 'docs/qa/visible/added.md', FORMATTED);

  const result = check(root, '--base', 'main');

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['UNAVAILABLE', 'docs/qa/hidden/new.md', NOT_CHECKED_OUT],
    ['deleted', 'docs/qa/hidden/retired.md', ''],
    ['formatted', 'docs/qa/visible/added.md', ''],
  ]);
  assert.match(result.stdout, /^UNAVAILABLE: .*git sparse-checkout add docs\/qa.*full checkout/m);
  assert.match(
    result.stdout,
    /^Result: FAILED \(1 problems; 1 of 3 selected paths not checked\)\.$/m,
  );
});

test('ordinary deletions pass, but a committed addition missing from the working tree fails', () => {
  const root = repository({
    'docs/qa/p/staged-deletion.md': FORMATTED,
    'docs/qa/p/unstaged-deletion.md': FORMATTED,
  });
  git(root, 'rm', '--quiet', 'docs/qa/p/staged-deletion.md');
  unlinkSync(join(root, 'docs/qa/p/unstaged-deletion.md'));

  let result = check(root, '--base', 'main');

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['deleted', 'docs/qa/p/staged-deletion.md', ''],
    ['deleted', 'docs/qa/p/unstaged-deletion.md', ''],
  ]);

  write(root, 'docs/qa/p/committed.md', FORMATTED);
  git(root, 'add', 'docs/qa/p/committed.md');
  git(root, 'commit', '--quiet', '-m', 'add a page');
  unlinkSync(join(root, 'docs/qa/p/committed.md'));

  result = check(root, '--base', 'main');

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(listed(result.stdout), [
    ['UNAVAILABLE', 'docs/qa/p/committed.md', REMOVED],
    ['deleted', 'docs/qa/p/staged-deletion.md', ''],
    ['deleted', 'docs/qa/p/unstaged-deletion.md', ''],
  ]);
  assert.match(result.stdout, /stage its removal with git rm/);
});

test('committed, staged, unstaged, untracked and renamed changes are selected once; nothing is written', () => {
  const root = repository({
    'docs/qa/p/edited.md': FORMATTED,
    'docs/qa/p/recreated.md': FORMATTED,
    'docs/qa/p/rename-staged-from.md': FORMATTED,
    'docs/qa/p/rename-unstaged-from.md': FORMATTED,
    'docs/qa/p/staged-then-edited.md': FORMATTED,
  });
  const second = `${FORMATTED}\nSecond pass.\n`;
  const third = `${second}\nThird pass.\n`;
  write(root, 'docs/qa/p/committed-then-edited.md', FORMATTED);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'first pass');
  write(root, 'docs/qa/p/committed-then-edited.md', second);
  write(root, 'docs/qa/p/staged-then-edited.md', second);
  git(root, 'add', 'docs/qa/p/staged-then-edited.md');
  write(root, 'docs/qa/p/staged-then-edited.md', third);
  write(root, 'docs/qa/p/edited.md', second);
  write(root, 'docs/qa/p/staged.md', FORMATTED);
  git(root, 'add', 'docs/qa/p/staged.md');
  git(root, 'rm', '--cached', '--quiet', 'docs/qa/p/recreated.md');
  write(root, 'docs/qa/p/untracked.md', FORMATTED);
  write(root, 'docs/qa/p/session.log', 'Git ignores this file.\n');
  // Renames are selected without rename detection: the old path as deleted, the new one as added.
  git(root, 'mv', 'docs/qa/p/rename-staged-from.md', 'docs/qa/p/rename-staged-to.md');
  renameSync(
    join(root, 'docs/qa/p/rename-unstaged-from.md'),
    join(root, 'docs/qa/p/rename-unstaged-to.md'),
  );
  // Same bytes with an older modification time: stale index stat data but no content change, which
  // a plain `git diff` refreshes by rewriting the index. Neither path is selected, so the
  // unformatted historical original under the archive rule is not reported either.
  const touched = [
    'docs/qa/2026-11-01-historical/README.md',
    'docs/qa/archive-packet/author/report-original.md',
  ];
  write(root, touched[0], FORMATTED);
  const past = new Date('2020-01-01T00:00:00Z');
  for (const path of touched) utimesSync(join(root, path), past, past);
  // Control: the plumbing diff-files compares stat data only and writes nothing.
  const stale = git(root, 'diff-files', '--name-only', '-z', '--', 'docs/qa').split('\0');
  assert.deepEqual(
    touched.filter((path) => !stale.includes(path)),
    [],
  );
  const selected = [
    ['formatted', 'docs/qa/p/committed-then-edited.md'],
    ['formatted', 'docs/qa/p/edited.md'],
    ['formatted', 'docs/qa/p/recreated.md'],
    ['deleted', 'docs/qa/p/rename-staged-from.md'],
    ['formatted', 'docs/qa/p/rename-staged-to.md'],
    ['deleted', 'docs/qa/p/rename-unstaged-from.md'],
    ['formatted', 'docs/qa/p/rename-unstaged-to.md'],
    ['formatted', 'docs/qa/p/staged-then-edited.md'],
    ['formatted', 'docs/qa/p/staged.md'],
    ['formatted', 'docs/qa/p/untracked.md'],
  ];
  const present = selected.filter(([kind]) => kind === 'formatted').map(([, path]) => path);
  const snapshot = () => ['.git/index', ...present, ...touched].map((path) => read(root, path));
  const before = snapshot();

  const result = check(root, '--base', 'main');

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    listed(result.stdout),
    selected.map(([kind, path]) => [kind, path, '']),
  );
  assert.match(
    result.stdout,
    /^Selected docs\/qa paths: 10 = checked with Prettier 8 \(Markdown 8\) \+ refused Markdown originals 0 \+ retained archived originals 0 \+ deleted 2 \+ unavailable 0$/m,
  );
  assert.deepEqual(snapshot(), before);
});

test('a line-ending rewrite Git normalizes away is not selected; real content and EOL changes are', () => {
  assert.equal(repositoryTextRule, TEXT_RULE);
  const root = repository({
    '.gitattributes': `${TEXT_RULE}\ndocs/qa/sealed/** -text -whitespace\n`,
    'docs/qa/2026-11-01-historical/evidence.json': '{"compact":true}\n',
    'docs/qa/2026-11-01-historical/notes 2.md': FORMATTED,
    'docs/qa/2026-11-01-historical/notes [v2].md': FORMATTED,
    'docs/qa/2026-11-01-historical/result.json': '{"result":"pass"}\n',
    'docs/qa/sealed/report.md.txt': UNFORMATTED,
  });
  // As on a Windows checkout; the eol=lf attribute keeps the committed LF bytes in the work tree.
  git(root, 'config', 'core.autocrlf', 'true');
  const crlf = (text) => text.replaceAll('\n', '\r\n');
  // Historical files rewritten with CRLF line endings only: Git normalizes them to their LF blobs.
  // The bracketed name is a path, not a pattern that would also match `notes 2.md`.
  const rewritten = [
    'docs/qa/2026-11-01-historical/README.md',
    'docs/qa/2026-11-01-historical/evidence.json',
    'docs/qa/2026-11-01-historical/notes [v2].md',
  ];
  write(root, rewritten[0], crlf(FORMATTED));
  write(root, rewritten[1], crlf('{"compact":true}\n'));
  write(root, rewritten[2], crlf(FORMATTED));
  // Real changes: a same-size edit given an older modification time, new content written with
  // CRLF, and CRLF line endings in a -text original, whose bytes Git stores as they are.
  const notes = FORMATTED.replace('summary', 'Summary');
  const result = crlf('{"result":"fail"}\n');
  const sealed = crlf(UNFORMATTED);
  write(root, 'docs/qa/2026-11-01-historical/notes 2.md', notes);
  const past = new Date('2020-01-01T00:00:00Z');
  utimesSync(join(root, 'docs/qa/2026-11-01-historical/notes 2.md'), past, past);
  write(root, 'docs/qa/2026-11-01-historical/result.json', result);
  write(root, 'docs/qa/sealed/report.md.txt', sealed);
  const changed = [
    'docs/qa/2026-11-01-historical/notes 2.md',
    'docs/qa/2026-11-01-historical/result.json',
    'docs/qa/sealed/report.md.txt',
  ];
  // Control: each rewritten path has stale index stat data and a changed size, yet Git's
  // normalized hash of its work-tree bytes is the blob in the index and at the base.
  const stale = git(root, 'diff-files', '--name-only', '-z', '--', 'docs/qa').split('\0');
  for (const path of rewritten) {
    assert.ok(stale.includes(path), `${path} has stale index stat data`);
    assert.notEqual(read(root, path).length, Number(git(root, 'cat-file', '-s', `main:${path}`)));
    const normalized = git(root, 'hash-object', `--path=${path}`, '--', path).trim();
    assert.deepEqual(git(root, 'rev-parse', `:${path}`, `main:${path}`).trim().split('\n'), [
      normalized,
      normalized,
    ]);
  }
  const snapshot = () => ['.git/index', ...rewritten, ...changed].map((path) => read(root, path));
  const before = snapshot();

  const report = check(root, '--base', 'main');

  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.deepEqual(listed(report.stdout), [
    ['formatted', 'docs/qa/2026-11-01-historical/notes 2.md', ''],
    ['retained', 'docs/qa/2026-11-01-historical/result.json', sha256(result)],
    ['retained', 'docs/qa/sealed/report.md.txt', sha256(sealed)],
  ]);
  assert.deepEqual(snapshot(), before);
  // Control: an ordinary `git diff`, which compares content and may then refresh this disposable
  // index, selects the same paths.
  const ordinary = spawnSync('git', ['diff', '--name-only', '-z', '--', 'docs/qa'], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.deepEqual(ordinary.stdout.split('\0').filter(Boolean), changed);
});

test('an unusable argument, base or repository stops with exit 2 and no partial report', () => {
  const root = repository();
  write(root, 'docs/qa/2026-11-24-new/README.md', FORMATTED);
  const tree = git(root, 'rev-parse', 'HEAD^{tree}').trim();
  const unrelated = git(root, 'commit-tree', tree, '-m', 'unrelated history').trim();
  const outside = join(scratch, 'not a repository');
  mkdirSync(outside);
  for (const [cwd, args, message] of [
    [root, [], /^check:qa: Usage: pnpm check:qa --base <git-ref>/],
    [root, ['--base', ''], /Usage: pnpm check:qa --base/],
    [root, ['--base'], /argument missing[\s\S]*Usage: pnpm check:qa/],
    [root, ['--base', 'main', '--write'], /Unknown option '--write'[\s\S]*Usage:/],
    [root, ['--base', 'main', 'docs/qa'], /Unexpected argument 'docs\/qa'[\s\S]*Usage:/],
    [root, ['--base', 'no-such-ref'], /--base "no-such-ref" does not name a commit/],
    [root, ['--base=--output=report'], /--base "--output=report" does not name a commit/],
    [root, ['--base', unrelated], /share no merge base/],
    [outside, ['--base', 'main'], /must run inside a Git working tree/],
  ]) {
    const result = check(cwd, ...args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, '');
  }
});

test('importing the module runs no check', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(cli).href)});`],
    { cwd: scratch, env, encoding: 'utf8', windowsHide: true },
  );
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
});
