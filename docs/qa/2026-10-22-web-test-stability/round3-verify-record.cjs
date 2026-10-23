const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const folder = 'docs/qa/2026-10-22-web-test-stability';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const result = [];
const binding = JSON.parse(fs.readFileSync(folder + '/round3-source-binding.json', 'utf8'));
for (const row of binding.rows) if (sha(fs.readFileSync(row.file)) !== row.sha256) throw new Error('Tested-source bytes changed: ' + row.file);
for (const manifest of ['evidence-provenance.json', 'round2-evidence-provenance.json', 'round3-evidence-provenance.json']) {
  const entries = JSON.parse(fs.readFileSync(folder + '/' + manifest, 'utf8'));
  for (const entry of entries) {
    const file = folder + '/' + entry.name;
    const bytes = fs.readFileSync(file);
    const expected = cp.execFileSync('git', ['hash-object', '--path=' + file, file], {windowsHide: true, encoding: 'utf8'}).trim();
    const normalized = Buffer.from(bytes.filter((value, index) => value !== 13 || bytes[index + 1] !== 10));
    const committed = blob(normalized) === expected ? normalized : blob(bytes) === expected ? bytes : null;
    if (!committed || entry.committedSha256 !== sha(committed) || entry.committedGitBlob !== expected) throw new Error('Committed-byte mismatch: ' + file);
    if (manifest === 'round3-evidence-provenance.json' && entry.retainedSha256 !== sha(bytes)) throw new Error('New retained capture changed: ' + file);
  }
  result.push({manifest, entries: entries.length, committedByteMismatches: 0});
}
function walk(dir) { return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const files = walk(folder);
for (const file of files) {
  const bytes = fs.readFileSync(file);
  for (const encoding of ['utf8', 'utf16le']) if (bytes.includes(Buffer.from(process.env.USERNAME, encoding))) throw new Error('Local username retained: ' + file);
}
const newFiles = cp.execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', folder], {windowsHide: true, encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const ignored = cp.spawnSync('git', ['check-ignore', '--stdin'], {input: files.join('\n') + '\n', windowsHide: true, encoding: 'utf8'});
if (ignored.status !== 1 || ignored.stdout.trim()) throw new Error('Ignored evidence files: ' + ignored.stdout);
const audit = fs.readFileSync(path.join(process.env.TEMP, 'gg-audit-chore-384-round2-b06832a/run-matrix.cjs'));
for (const phase of ['before', 'after']) if (!fs.readFileSync(folder + '/round3-' + phase + '-run-matrix.cjs').equals(audit)) throw new Error('Matrix driver changed: ' + phase);
const matrix = JSON.parse(fs.readFileSync(folder + '/round3-after-verified-matrix-results.json', 'utf8'));
if (matrix.length !== 3 || matrix.some(row => row.code !== 0)) throw new Error('Loaded matrix did not pass all three executions');
console.log(JSON.stringify({manifests: result, testedSourcesUnchanged: binding.rows.length, localUsernames: 0, ignoredFiles: 0, addableNewFiles: newFiles.length, exactAuditDrivers: 2, loadedExecutionsPassed: matrix.length}));
