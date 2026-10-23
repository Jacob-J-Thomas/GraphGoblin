// Normalize captured Windows text without retaining local account paths.
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const dir = path.join(root, 'docs/qa/2026-10-21-wp-g4-qa');
function text(buffer) {
  if (buffer[0] === 255 && buffer[1] === 254) return buffer.subarray(2).toString('utf16le');
  let s = buffer.toString('utf8');
  if (s.includes('\0')) s = s.replaceAll('\0', '').replaceAll('\ufffd', '');
  return s;
}
function clean(s) {
  return s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replaceAll(root, '<worktree>')
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%')
    .replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%');
}
for (const name of fs.readdirSync(dir)) {
  const p = path.join(dir, name);
  if (fs.statSync(p).isFile()) fs.writeFileSync(p, clean(text(fs.readFileSync(p))), 'utf8');
}
const after = JSON.parse(fs.readFileSync(path.join(dir, 'after-checks.json'), 'utf8'));
const missing = after.find((x) => x.id === 'missing-definition');
const sentence =
  'No value was recorded for this run. The pinned definition is not available, so whether the exit’s Returns is None cannot be shown.';
fs.writeFileSync(
  path.join(dir, 'wording-negative.json'),
  JSON.stringify(
    {
      id: 'unavailable-definition-literal-wording',
      steps:
        'Fresh browser context; block immutable version GET with controlled 404; read exit-returns in inspector and selected exit.evaluated detail.',
      expected: 'The brief says never "Returns is None".',
      actual: sentence,
      semanticResult: missing.verdict,
      literalSubstringPresent: sentence.includes('Returns is None'),
      verdict:
        'FAIL for literal substring constraint; PASS for honest uncertainty and absence of a false None claim',
      severity: 'minor wording mismatch',
      evidence: 'after-checks.json: missing-definition',
    },
    null,
    2,
  ) + '\n',
);
console.log('Normalized text encoding and recorded the literal wording caveat.');
