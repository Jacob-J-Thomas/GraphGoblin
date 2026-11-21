// QA459C freeze-record writer. Not product code.
// node qa459c-freeze.mjs <versionDir> <freezeJson> <label> <statement>
// Reads <versionDir>/MANIFEST.sha256 (written beforehand by the frozen qa459i-manifest.mjs), records
// its sha256, entry count and actual file modification time, plus the actual current clock time at
// which this record is written. No hand-entered timestamps. Never overwrites.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [versionDir, freezePath, label, statement] = process.argv.slice(2);
if (!versionDir || !freezePath || !label || !statement) throw new Error('usage: <versionDir> <freezeJson> <label> <statement>');
if (existsSync(freezePath)) throw new Error('freeze record exists; never overwritten');
const manifestPath = join(versionDir, 'MANIFEST.sha256');
const bytes = readFileSync(manifestPath);
const lines = bytes.toString('utf8').split('\n').filter(Boolean);
const record = {
  schema: 'qa459c-freeze/1',
  label,
  statement,
  manifest: {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    entries: lines.length,
    modifiedUtc: statSync(manifestPath).mtime.toISOString(),
    files: lines.map((line) => {
      const [sha256, size, ...rest] = line.split('  ');
      return { path: rest.join('  '), sha256, bytes: Number(size) };
    }),
  },
  recordWrittenUtc: new Date().toISOString(),
  timeBasis: 'manifest.modifiedUtc is the manifest file mtime; recordWrittenUtc is the writer process clock at write time. Neither is hand-entered.',
};
writeFileSync(freezePath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ label, manifestSha256: record.manifest.sha256, entries: record.manifest.entries, recordWrittenUtc: record.recordWrittenUtc }));
