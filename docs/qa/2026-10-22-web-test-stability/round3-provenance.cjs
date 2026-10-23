const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const folder = 'docs/qa/2026-10-22-web-test-stability';
const git = (args, input) => cp.execFileSync('git', args, {input, windowsHide: true, maxBuffer: 128 * 1024 * 1024});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => git(['hash-object', '--no-filters', '--stdin'], bytes).toString().trim();
// Byte-wise: preserve binary, UTF-16, invalid UTF-8, BOMs and lone CR bytes.
function normalize(bytes) {
  const result = Buffer.allocUnsafe(bytes.length);
  let written = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    result[written++] = bytes[i];
  }
  return result.subarray(0, written);
}
const summaries = [];
for (const name of ['evidence-provenance.json', 'round2-evidence-provenance.json']) {
  const file = folder + '/' + name;
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  const historical = JSON.parse(git(['show', 'HEAD:' + file]).toString());
  let mismatches = 0;
  let normalizedCount = 0;
  const rows = entries.map((entry, i) => {
    const old = historical[i];
    for (const key of Object.keys(old)) {
      if (JSON.stringify(entry[key]) !== JSON.stringify(old[key])) throw new Error('Capture metadata changed: ' + name + ':' + entry.name + ':' + key);
    }
    const relative = folder + '/' + entry.name;
    const raw = fs.readFileSync(relative);
    const eol = git(['ls-files', '--eol', '--', relative]).toString().trim();
    if (!eol) throw new Error('Expected tracked evidence: ' + relative);
    const indexEol = eol.match(/^i\/(\S+)/)[1];
    // text=auto can identify UTF-16 logs as binary. Respect Git's classification,
    // rather than decoding every .txt file and damaging its original byte stream.
    const useLf = indexEol !== '-text';
    const committed = useLf ? normalize(raw) : raw;
    const committedGitBlob = blob(committed);
    const gitCleanBlob = git(['hash-object', '--path=' + relative, relative]).toString().trim();
    const headBlob = git(['rev-parse', 'HEAD:' + relative]).toString().trim();
    if (committedGitBlob !== gitCleanBlob || committedGitBlob !== headBlob) throw new Error('Manual normalization disagrees with Git: ' + relative);
    const headBytes = git(['cat-file', 'blob', headBlob]);
    if (!committed.equals(headBytes)) throw new Error('Manual bytes disagree with HEAD: ' + relative);
    const committedSha256 = sha256(committed);
    const captureMismatch = entry.retainedSha256 !== committedSha256;
    mismatches += Number(captureMismatch);
    normalizedCount += Number(!raw.equals(committed));
    const fields = {
      captureHashScope: 'originalSha256 hashes source capture bytes before documented redaction (when present); retainedSha256 hashes retained capture bytes after redaction and before Git normalization. Existing hashes and notes are historical capture metadata.',
      committedSha256,
      committedGitBlob,
      gitNormalization: indexEol === '-text' ? 'None: text=auto treats this file as binary; bytes are preserved.' : 'text=auto eol=lf: normalize CRLF pairs to LF; preserve all other bytes.',
    };
    if (process.argv.includes('--write')) Object.assign(entry, fields);
    if (process.argv.includes('--verify')) for (const [key, value] of Object.entries(fields)) {
      if (entry[key] !== value) throw new Error('Committed-byte field mismatch: ' + relative + ':' + key);
    }
    return {name: entry.name, eol, captureMismatch, bytesRemoved: raw.length - committed.length, committedSha256, committedGitBlob, gitCleanMatches: true, headBytesMatch: true};
  });
  if (process.argv.includes('--write')) fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n');
  summaries.push({manifest: name, entries: entries.length, captureVsCommittedMismatches: mismatches, workingTreeFilesNormalized: normalizedCount, historicalMetadataUnchanged: true, rows});
}
const result = {head: git(['rev-parse', 'HEAD']).toString().trim(), mode: process.argv.includes('--write') ? 'write' : process.argv.includes('--verify') ? 'verify' : 'before', summaries};
if (process.env.GG_CHORE_WEB_PROVENANCE_OUTPUT) fs.writeFileSync(process.env.GG_CHORE_WEB_PROVENANCE_OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({head: result.head, mode: result.mode, manifests: summaries.map(({rows, ...summary}) => summary)}));
