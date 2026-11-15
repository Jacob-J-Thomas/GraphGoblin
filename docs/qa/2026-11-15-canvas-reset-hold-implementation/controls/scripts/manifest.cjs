const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const [, , wt, out, idx] = process.argv;
const run = (args, opts = {}) => cp.execFileSync('git', ['--no-optional-locks', '-C', wt, ...args], { encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 1 << 28 });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const files = run(['diff', '--name-only', '-z']).split('\0').filter(Boolean);
const numstat = Object.fromEntries(run(['diff', '--numstat']).trim().split('\n').map((l) => { const [a, d, p] = l.split('\t'); return [p, { added: +a, deleted: +d }]; }));
const entries = files.map((p) => {
  const final = fs.readFileSync(path.join(wt, p));
  const committed = run(['show', `HEAD:${p}`], { buffer: true });
  const dest = path.join(out, 'final', 'files', p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, final);
  return { path: p, committedBlob: run(['rev-parse', `HEAD:${p}`]).trim(), committedSha256: sha(committed), finalSha256: sha(final), finalBytes: final.length, ...numstat[p] };
});
const lsFiles = cp.execFileSync('git', ['--no-optional-locks', '-C', wt, 'ls-files', '-s', '-z'], { maxBuffer: 1 << 28 });
const diff = fs.readFileSync(path.join(out, 'final', 'final.diff'));
const manifest = {
  head: run(['rev-parse', 'HEAD']).trim(),
  tree: run(['rev-parse', 'HEAD^{tree}']).trim(),
  branch: run(['branch', '--show-current']).trim(),
  rawIndexPath: idx,
  rawIndexSha256: sha(fs.readFileSync(idx)),
  indexEntriesSha256: sha(lsFiles),
  indexEntryCount: lsFiles.toString('utf8').split('\0').filter(Boolean).length,
  statusPorcelain: run(['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean),
  stagedFiles: run(['diff', '--cached', '--name-only']).split('\n').filter(Boolean),
  untracked: run(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean),
  diffSha256: sha(diff),
  diffBytes: diff.length,
  files: entries,
};
fs.writeFileSync(path.join(out, 'final', 'final-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
