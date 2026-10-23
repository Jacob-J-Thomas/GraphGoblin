const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const destination = path.join(process.cwd(), 'docs/qa/2026-10-22-web-test-stability');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const items = [];
function add(source, name) { if (fs.existsSync(source)) items.push({source, name}); }
for (const phase of ['before', 'after']) {
  const folder = path.join(process.env.TEMP, 'gg-chore-web-round3-' + phase);
  if (!fs.existsSync(folder)) continue;
  for (const file of fs.readdirSync(folder)) {
    if (file === 'active-matrix-pid.txt' || !/\.(log\.txt|json|[cm]?[jt]s)$/.test(file)) continue;
    add(path.join(folder, file), 'round3-' + phase + '-' + file);
  }
}
for (const file of ['provenance.cjs', 'provenance-write.json', 'provenance-verify.json', 'run.cjs', 'probes.cjs', 'probes.config.mjs', 'retain.cjs', 'assertions.cjs', 'assertions.json', 'gate-tasks.json', 'gate2-tasks.json', 'post-tasks.json', 'probe-tasks.json', 'source-binding.json', 'sources.cjs', 'browser.cjs', 'ports.json', 'ports-before.json', 'ports.cjs', 'raw-bytes.cjs', 'raw-before.json', 'summary.cjs', 'summary.json', 'verify-record.cjs', 'report.cjs']) {
  add(path.join(process.env.TEMP, 'gg-chore-web-round3-' + file), 'round3-' + file);
}
const audit = path.join(process.env.TEMP, 'gg-audit-chore-384-round2-b06832a');
for (const file of ['verified-parallel-1.log.txt', 'verified-parallel-2.log.txt', 'verified-serial.log.txt', 'verified-matrix-results.json', 'hash-cause.json']) add(path.join(audit, file), 'round3-audit-' + file);
function redact(bytes) {
  for (const prefix of [process.env.USERPROFILE, process.env.USERPROFILE.replaceAll('\\', '/'), process.env.USERPROFILE.replaceAll('\\', '\\\\'), process.env.USERNAME]) {
    for (const encoding of ['utf8', 'utf16le']) {
      const needle = Buffer.from(prefix, encoding);
      const replacement = Buffer.from('<USERPROFILE>', encoding);
      let at;
      while ((at = bytes.indexOf(needle)) !== -1) bytes = Buffer.concat([bytes.subarray(0, at), replacement, bytes.subarray(at + needle.length)]);
    }
  }
  return bytes;
}
const entries = items.map(({source, name}) => {
  const original = fs.readFileSync(source);
  const retained = redact(original);
  const target = path.join(destination, name);
  fs.writeFileSync(target, retained);
  const relative = path.relative(process.cwd(), target).replaceAll('\\', '/');
  const expected = cp.execFileSync('git', ['hash-object', '--path=' + relative, relative], {windowsHide: true, encoding: 'utf8'}).trim();
  const normalized = Buffer.from(retained.filter((value, index) => value !== 13 || retained[index + 1] !== 10));
  const committed = blob(normalized) === expected ? normalized : blob(retained) === expected ? retained : null;
  if (!committed) throw new Error('Manual normalization disagrees with Git: ' + name);
  return {name, source: path.basename(source), originalSha256: sha(original), retainedSha256: sha(retained), captureHashScope: 'Source and retained capture bytes, before Git normalization.', note: 'Local user-directory prefixes and username redacted in UTF-8 and UTF-16LE; all other capture bytes preserved.', committedSha256: sha(committed), committedGitBlob: expected, gitNormalization: retained.equals(committed) ? 'Git clean output equals retained capture bytes.' : 'text=auto eol=lf: CRLF pairs normalized to LF; other bytes preserved.'};
});
fs.writeFileSync(path.join(destination, 'round3-evidence-provenance.json'), JSON.stringify(entries, null, 2) + '\n');
console.log(JSON.stringify({retainedFiles: entries.length, prefix: 'round3-', localPathsRedacted: true, manualCleanConversionsVerified: entries.length}));
