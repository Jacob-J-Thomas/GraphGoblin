// Scan-1 reviewer: read-only inspection of the committed corrected fixture declaration.
// Usage: node inspect-fixtures.mjs <path-to-wire-fixtures.json>
import { readFileSync } from 'node:fs';

const w = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const show = (value) =>
  JSON.stringify(value, (_k, v) => {
    if (typeof v !== 'string') return v;
    const marked = v.replace(/[\uD800-\uDFFF]/g, (c) => `<${c.charCodeAt(0).toString(16)}>`);
    return marked.length > 70 ? `${marked.slice(0, 20)}…${marked.slice(-20)} (${v.length}cu)` : marked;
  });
console.log('targetOrder', show(w.targetOrder));
console.log('phases', Object.keys(w.phases));
for (const [name, phase] of Object.entries(w.phases)) {
  console.log('== phase', name, Object.keys(phase));
  console.log(show(phase).slice(0, 5000));
}
console.log('== derivedSplit', show(w.derivedSplit).slice(0, 1500));
console.log('== sources keys', Object.keys(w.sources));
console.log(show(w.sources).slice(0, 3000));
