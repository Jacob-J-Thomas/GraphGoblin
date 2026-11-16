// Read-only: list rows that differ between root continuation 'before' and 'attested-retained' inventories.
import { readFileSync } from 'node:fs';
const receipt = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher-438-profile-cleanup-preparation/continuation-receipt.jsonl';
const lines = readFileSync(receipt, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const st = (s) => lines.find((l) => l.stage === s).data;
const before = st('before').inventory;
const after = st('attested-retained').inventory;
const rel = (p) => { const i = p.toLowerCase().indexOf('\\disposable'); return i < 0 ? p : p.slice(i + 1); };
const byPath = new Map(after.map((r) => [r.path.toLowerCase(), r]));
const changes = [];
for (const r of before) {
  const x = byPath.get(r.path.toLowerCase());
  if (!x) { changes.push({ kind: 'removed', path: rel(r.path), id: r.id, attributes: r.attributes, reparse: r.reparse }); continue; }
  const fields = Object.keys(r).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(x[k]));
  if (fields.length) changes.push({ kind: 'changed', path: rel(r.path), fields: Object.fromEntries(fields.map((k) => [k, [r[k], x[k]]])) });
}
const target = after.filter((r) => /\\INetCache\\IE(\\|$)/i.test(r.path)).map((r) => ({ path: rel(r.path), directory: r.directory, bytes: r.bytes, sha256: r.sha256 }));
const paths = after.map((r) => ({ path: rel(r.path) + (r.directory ? '\\' : ''), bytes: r.directory ? null : r.bytes, links: r.links }));
console.log(JSON.stringify({ changes, target, afterPaths: paths }, null, 1));
