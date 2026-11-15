// Writes final/final.diff, final-diffstat.txt, final-numstat.txt, final/files/<path> copies and
// final/final-manifest.json from the worktree, using read-only git commands. Run from the repo root.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OUT = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-207-selection-doubleclick-implementation';
const git = (...args) =>
  execFileSync('git', ['--no-optional-locks', ...args], { encoding: 'buffer', maxBuffer: 1 << 28 });
const text = (...args) => git(...args).toString('utf8').trim();
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const files = text('diff', '--name-only').split('\n').filter(Boolean).sort();
const untracked = text('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
const staged = text('diff', '--cached', '--name-only').split('\n').filter(Boolean);
if (untracked.length || staged.length) throw new Error('untracked or staged paths present');

fs.mkdirSync(path.join(OUT, 'final', 'files'), { recursive: true });
const diff = git('diff');
fs.writeFileSync(path.join(OUT, 'final', 'final.diff'), diff);
fs.writeFileSync(path.join(OUT, 'final', 'final-diffstat.txt'), git('diff', '--stat'));
const numstat = git('diff', '--numstat');
fs.writeFileSync(path.join(OUT, 'final', 'final-numstat.txt'), numstat);
const counts = Object.fromEntries(
  numstat
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [added, removed, file] = line.split('\t');
      return [file, { added: Number(added), removed: Number(removed) }];
    }),
);

const entries = files.map((file) => {
  const bytes = fs.readFileSync(file);
  const copy = path.join(OUT, 'final', 'files', file);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.writeFileSync(copy, bytes);
  const committed = git('show', `HEAD:${file}`);
  return {
    path: file,
    sha256: sha(bytes),
    bytes: bytes.length,
    committedBlob: text('rev-parse', `HEAD:${file}`),
    committedSha256: sha(committed),
    ...counts[file],
  };
});

const logs = fs
  .readdirSync(path.join(OUT, 'logs'))
  .sort()
  .map((name) => ({ name, sha256: sha(fs.readFileSync(path.join(OUT, 'logs', name))) }));

const gitDir = text('rev-parse', '--absolute-git-dir');
const manifest = {
  head: text('rev-parse', 'HEAD'),
  tree: text('rev-parse', 'HEAD^{tree}'),
  branch: text('branch', '--show-current'),
  rawIndexSha256: sha(fs.readFileSync(path.join(gitDir, 'index'))),
  lsFilesZSha256: sha(git('ls-files', '-s', '-z')),
  lsFilesTextSha256: sha(git('ls-files', '-s')),
  indexEntries: text('ls-files', '-s').split('\n').length,
  status: text('status', '--porcelain=v1', '-uall').split('\n'),
  staged,
  untracked,
  finalDiff: { bytes: diff.length, sha256: sha(diff) },
  candidateBackup: sha(fs.readFileSync(path.join(OUT, 'backup', 'OrthogonalEdge.candidate-final.tsx'))),
  files: entries,
  logs,
};
fs.writeFileSync(path.join(OUT, 'final', 'final-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ files: entries.length, diff: manifest.finalDiff, index: manifest.rawIndexSha256 }, null, 2));
