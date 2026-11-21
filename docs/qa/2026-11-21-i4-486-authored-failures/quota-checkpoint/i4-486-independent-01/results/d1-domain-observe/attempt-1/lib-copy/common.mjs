// Shared QA helpers. No product code is modified; built packages are imported by file URL.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECKOUT = 'G:/ggq/gg-i4-486-qa/GraphGoblin';
export const SCRATCH = 'G:/ggq/qa-scratch/i4-486-independent-01';
export const imp = (rel) => import(pathToFileURL(join(CHECKOUT, rel)).href);

export function sha256(value) {
  return createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
}

/** A result recorder: every check is kept, pass or fail, with raw actual data. */
export function recorder(outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  const raw = join(outDir, `${name}.raw.jsonl`);
  writeFileSync(raw, '');
  return {
    rows,
    raw(kind, data) {
      appendFileSync(raw, JSON.stringify({ t: new Date().toISOString(), kind, data }) + '\n');
    },
    check(id, description, pass, actual, cls) {
      const row = { id, description, pass: !!pass, class: cls, actual };
      rows.push(row);
      appendFileSync(raw, JSON.stringify({ t: new Date().toISOString(), kind: 'check', row }) + '\n');
      process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${id} ${description}\n`);
      return !!pass;
    },
    finish(extra = {}) {
      const summary = {
        name,
        total: rows.length,
        passed: rows.filter((r) => r.pass).length,
        failed: rows.filter((r) => !r.pass).map((r) => r.id + ' ' + r.description),
        ...extra,
      };
      writeFileSync(join(outDir, `${name}.results.json`), JSON.stringify({ summary, rows }, null, 1));
      process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
      return summary;
    },
  };
}

export function containsAny(value, markers) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return markers.filter((m) => text.includes(m));
}
