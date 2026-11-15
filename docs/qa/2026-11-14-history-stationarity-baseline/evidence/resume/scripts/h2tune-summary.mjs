// Summarises the H2 boundary-tuning runs (h2tune = first run with one fixture failure; h2tune2 = corrected). Read-only.
//   node h2tune-summary.mjs <resume-dir>  -> analysis/h2tune-summary.md
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2];
const md = ['| run | cfg | candidate name length | h1 width px | initial group row | row flips in add/undo/redo sequence | header heights | Undo y values | Undo x values | history effects (add,undo,redo) |', '|---|---|---|---|---|---|---|---|---|---|'];
const notes = [];
for (const label of ['h2tune-d1', 'h2tune2-d1', 'h2tune2-d2']) {
  const a = JSON.parse(await readFile(join(root, 'runs', label, 'raw', label + '.actions.json'), 'utf8'));
  const cal = a.phases.find((p) => p.name === 'calibrate');
  notes.push(`- \`${label}\`: calibration boundary (first wrapped length) = ${cal.result.boundary}, last unwrapped = ${cal.result.lastUnwrapped}; probes ${cal.result.probes.map((q) => q.k + (q.wrapped ? ' wrapped' : ' fits')).join(', ')}.`);
  for (const p of a.phases.filter((x) => /^candidate/.test(x.name))) {
    if (!p.ok) { md.push(`| \`${label}\` | ${a.config} | ${p.name.replace('candidate-k', '')} | - | - | FIXTURE FAILURE: ${String(p.error).split('\n')[0].slice(0, 90)} | - | - | - | - |`); continue; }
    const r = p.result, t = r.transitions;
    md.push(`| \`${label}\` | ${a.config} | ${r.k} | ${r.rest.h1[2].toFixed(1)} | ${r.rest.group[1] >= r.rest.h1[1] + r.rest.h1[3] - 1 ? 'row 2 (wrapped)' : 'row 1'} | ${r.rowFlips} | ${[...new Set(t.map((x) => x.hdrH))].join('/')} | ${[...new Set(t.map((x) => x.undoY))].join('/')} | ${[...new Set(t.map((x) => x.undoX.toFixed(1)))].join('/')} | ${r.actionsOk.join(',')} |`);
  }
}
await writeFile(join(root, 'analysis', 'h2tune-summary.md'), notes.join('\n') + '\n\n' + md.join('\n') + '\n');
console.log(notes.join('\n') + '\n' + md.join('\n'));
