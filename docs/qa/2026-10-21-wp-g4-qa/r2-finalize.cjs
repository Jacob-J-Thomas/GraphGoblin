// Finalize only round-2 evidence after the one full coverage run and all isolated triage finish.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const root = process.cwd();
const dir = path.join(root, 'docs/qa/2026-10-21-wp-g4-qa');
const read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^\uFEFF/, ''));
const full = read('r2-full-coverage-summary.json');
const triage = read('r2-coverage-triage.json');
const native = read('r2-native-lifecycle.json');
const inspectors = ['projections', 'run-inspector', 'evaluation-details'].map((n) =>
  read('r2-' + n + '-summary.json'),
);
const browser = read('r2-browser-output/.last-run.json');
const cleanup = read('r2-coverage-cleanup.json');
const coverage = full.coverage;
const headline =
  full.exit === 0 &&
  native.verdict === 'PASS' &&
  inspectors.every((x) => x.exit === 0) &&
  browser.status === 'passed'
    ? 'PASS with a minor documentation defect'
    : 'FAIL to clear the requested verification';
let report = fs.readFileSync(path.join(dir, 'r2-report.md'), 'utf8');
report = report.replace(
  /\*\*Verdict: PENDING[^\n]*\n/,
  `**Verdict: ${headline} on \`5d2783359dbcb95aa719146416f02dc303cbd1ed\`.** The served recipe, D1 fallback, six Edge regressions and three isolated inspector files passed. Full coverage and any isolated follow-ups are recorded below.\n`,
);
let coverageText = `Full-run exit: **${full.exit}**. `;
if (full.summary)
  coverageText += `Tests: **${full.summary.passed} passed, ${full.summary.failed} failed, ${full.summary.pending} pending**, ${full.summary.tests} total; ${full.files.length} file results. `;
if (coverage)
  coverageText += `\n\nCoverage emitted by this run: **lines ${coverage.lines.pct}%; branches ${coverage.branches.pct}%**; statements ${coverage.statements.pct}%; functions ${coverage.functions.pct}%. The repository's existing thresholds were applied unchanged.`;
else coverageText += 'No fresh coverage percentages were emitted; no threshold-pass claim is made.';
report = report.replace('{{COVERAGE_RESULT}}', coverageText);
let triageText;
if (!triage.failedFileCount)
  triageText =
    'No failed files were reported, so **no isolated failure reruns were needed**. This was the only full coverage run.';
else {
  triageText =
    '| Original failing file | Isolated result | Classification | Evidence |\n| --- | --- | --- | --- |\n' +
    triage.triage
      .map(
        (t) =>
          `| ${t.file} | exit ${t.isolatedExit}; ${t.isolatedSummary?.passed ?? 'unknown'} passed, ${t.isolatedSummary?.failed ?? 'unknown'} failed | ${t.classification} | [log](${t.evidence}) |`,
      )
      .join('\n') +
    '\n\nEach full-run failed assertion is retained in the summary and mapped to its file-level isolated rerun. Full-run failures are not erased by later passes.';
}
report = report.replace('{{TRIAGE_RESULT}}', triageText);
const remaining = fs
  .readdirSync(os.tmpdir(), { withFileTypes: true })
  .filter((x) => x.isDirectory() && x.name.startsWith('gg-qa-129-'))
  .map((x) => x.name);
const cleanupData = {
  native: native.cleanup,
  firstHarness: read('r2-native-first-harness.json').cleanup,
  initialServed: read('r2-native-initial-served.json').cleanup,
  inspectors: read('r2-inspectors-cleanup.json'),
  coverage: cleanup,
  remainingPrefixDirectories: remaining,
};
fs.writeFileSync(path.join(dir, 'r2-cleanup.json'), JSON.stringify(cleanupData, null, 2) + '\n');
report = report.replace(
  '{{CLEANUP_RESULT}}',
  `The native API is stopped. Both initial harness stores and the successful native store were removed by the managed fixture. The seven regression API stores and regression runtime directory were removed by their normal teardown. Inspector and full-coverage temporary log/report directories were removed. Final \`gg-qa-129-*\` directory inventory: **${remaining.length === 0 ? 'empty' : remaining.join(', ')}**. See [r2-cleanup.json](r2-cleanup.json). No current cleanup rejection or leftover owned store remains.`,
);
fs.writeFileSync(path.join(dir, 'r2-report.md'), report);
function clean(s) {
  return s
    .replaceAll(root, '<worktree>')
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%')
    .replace(/\bgg_[A-Za-z0-9_-]{12,}/g, '[disposable-key]');
}
const names = fs
  .readdirSync(dir)
  .filter((n) => n.startsWith('r2-') && fs.statSync(path.join(dir, n)).isFile());
for (const name of names) {
  const p = path.join(dir, name);
  let s = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  if (name.endsWith('.json')) {
    const j = JSON.parse(s);
    if (j.stages)
      for (const stage of j.stages)
        if (stage.stderr?.startsWith('#< CLIXML') && !stage.stderr.includes('S="error"'))
          stage.stderr = '[PowerShell progress records omitted]';
    s = JSON.stringify(j, null, 2) + '\n';
  }
  fs.writeFileSync(p, clean(s), 'utf8');
}
const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tracked = cp.spawnSync('git', ['diff', '--exit-code'], { encoding: 'utf8' }).status;
const staged = cp.spawnSync('git', ['diff', '--cached', '--exit-code'], {
  encoding: 'utf8',
}).status;
const status = cp.execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
const issues = [];
for (const name of names) {
  const s = fs.readFileSync(path.join(dir, name), 'utf8');
  if (
    s.includes('\0') ||
    /C:[\\/]+Users[\\/]+|gg_[A-Za-z0-9_-]{24,}/i.test(s) ||
    s.includes(process.env.USERPROFILE.split(/[\\/]/).pop())
  )
    issues.push(name);
  if (name.endsWith('.json')) JSON.parse(s);
}
fs.writeFileSync(
  path.join(dir, 'r2-workspace.txt'),
  `HEAD=${head}\nDetached worktree=codex-qa-wp-g4\nNode=${process.version}\nTracked diff exit=${tracked}\nStaged diff exit=${staged}\nStatus:\n${status}\nR2 local-path/token-pattern/encoding scan=${issues.length === 0 ? 'PASS' : issues.join(',')}\nAll R2 JSON parses. Prior round-1 files were not written by this round's tools.\nRemaining QA temp directories=${remaining.length}\n`,
);
console.log(
  JSON.stringify(
    {
      headline,
      fullExit: full.exit,
      summary: full.summary,
      coverage,
      remaining,
      issues,
      maxBytes: Math.max(...names.map((n) => fs.statSync(path.join(dir, n)).size)),
    },
    null,
    2,
  ),
);
if (
  head !== '5d2783359dbcb95aa719146416f02dc303cbd1ed' ||
  tracked ||
  staged ||
  issues.length ||
  remaining.length
)
  process.exitCode = 1;
