// Scan-1 reviewer: read-only summary of committed corrected native evidence.
// Usage: node inspect-durable.mjs <corrected-attempt-1 dir>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const readback = JSON.parse(readFileSync(path.join(dir, 'post-drain-readback.json'), 'utf8'));
let total = 0;
const ids = new Set();
for (const [target, rows] of Object.entries(readback.rows)) {
  const summary = rows.map((r) => {
    ids.add(r.id);
    const hex = r.sqliteExtractedKeyHex ?? '';
    // CESU-style surrogate encodings in extracted UTF-8 would start with ED A0..BF.
    const cesu = /ED[AB][0-9A-F]/i.test(hex.match(/.{2}/g)?.join('') ?? '') &&
      /(^|(?:..)*?)ED[AB]/i.test(hex) && (hex.match(/.{2}/g) ?? []).some((b, i, a) => b === 'ED' && /^[AB]/i.test(a[i + 1] ?? ''));
    return `${r.caseLabel}:${r.keyTag ?? '-'}:hasKey=${r.hasKey}:wf=${r.keyWellFormed}:cesu=${cesu}:len=${r.key?.length ?? '-'}`;
  });
  total += rows.length;
  console.log(target, rows.length, JSON.stringify(summary));
}
console.log('rows', total, 'distinct ids', ids.size);

const fields = new Map();
const warnings = [];
for (const log of ['initial-gateway.log', 'restart-gateway.log']) {
  for (const line of readFileSync(path.join(dir, log), 'utf8').split(/\r?\n/)) {
    if (!line.includes('MALFORMED_DEDUPE_KEY')) continue;
    const rec = JSON.parse(line);
    const keys = Object.keys(rec).sort().join(',');
    fields.set(keys, (fields.get(keys) ?? 0) + 1);
    warnings.push({ log, loopId: rec.loopId, code: rec.code, itemIndex: rec.itemIndex, msg: rec.msg, bytes: Buffer.byteLength(line) });
  }
}
console.log('warnings', warnings.length);
console.log('field sets', JSON.stringify([...fields]));
const byCode = {};
for (const w of warnings) {
  const k = `${w.log}|${w.loopId}|${w.code}|${w.msg}`;
  (byCode[k] ??= []).push(w.itemIndex ?? null);
}
for (const [k, v] of Object.entries(byCode)) console.log(k, JSON.stringify(v));
console.log('byte range', Math.min(...warnings.map((w) => w.bytes)), Math.max(...warnings.map((w) => w.bytes)));
