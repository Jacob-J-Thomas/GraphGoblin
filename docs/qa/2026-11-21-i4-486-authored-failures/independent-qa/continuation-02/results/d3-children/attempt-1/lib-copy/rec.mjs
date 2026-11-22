// 02-owned recorder/hash helpers. Ancestry: original 01 lib/common.mjs (8ee54407…), rewritten so that
// all output goes to the 02 attempt directory (QA_OUT) and scratch is the 02 attempt work dir (QA_WORK).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECKOUT = 'G:/ggq/gg-i4-486-qa/GraphGoblin';
export const OUT = process.env.QA_OUT;
export const WORK = process.env.QA_WORK;
if (!OUT || !WORK || !WORK.includes('i4-486-independent-02') || !OUT.includes('i4-486-independent-02'))
  throw new Error('QA_OUT/QA_WORK must point into the 02 packet/scratch');
export const imp = (rel) => import(pathToFileURL(join(CHECKOUT, rel)).href);

export function sha256(value) {
  return createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
}

export function containsAny(value, markers) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return markers.filter((m) => text.includes(m));
}

/** Every check is kept, pass or fail, with raw actual data and its evidence class. */
export function recorder(name) {
  mkdirSync(OUT, { recursive: true });
  const rows = [];
  const raw = join(OUT, `${name}.raw.jsonl`);
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
      writeFileSync(join(OUT, `${name}.results.json`), JSON.stringify({ summary, rows }, null, 1));
      process.stdout.write(JSON.stringify(summary, null, 1) + '\n');
      return summary;
    },
  };
}
