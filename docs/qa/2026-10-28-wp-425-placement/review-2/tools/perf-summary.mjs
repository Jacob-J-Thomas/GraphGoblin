// Reviewer summary (WP-425 scan 2): read routing.spec.ts performance reports from
// %TEMP%\gg-rev425b-reports\<run>\ and print per-drag and median numbers per build.
//   node perf-summary.mjs <reports dir> <run...>
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...runs] = process.argv.slice(2);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const out = { perRun: [], perBuild: {} };
for (const run of runs) {
  for (const count of [100, 300]) {
    const file = path.join(dir, run, `performance-review-${count}-repeat-1.json`);
    if (!fs.existsSync(file)) continue;
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const build = run.replace(/-\d+$/, '');
    for (const r of report.repetitions) {
      const row = {
        run,
        build,
        nodes: count,
        drag: r.repetition,
        movesObserved: r.pointerMovesObserved,
        movesSent: r.pointerMovesSent,
        ackP95Ms: r.acknowledgementP95Ms,
        routingSamples: r.routingSamples,
        routingP95Ms: +r.routingP95Ms.toFixed(2),
        frameSamples: r.frameSamples,
        frameP95Ms: +r.frameP95Ms.toFixed(1),
      };
      out.perRun.push(row);
      const key = `${build} ${count}`;
      (out.perBuild[key] ??= []).push(row);
    }
  }
}
const summary = {};
for (const [key, rows] of Object.entries(out.perBuild))
  summary[key] = {
    drags: rows.length,
    medianMovesObserved: median(rows.map((r) => r.movesObserved)),
    medianAckP95Ms: median(rows.map((r) => r.ackP95Ms)),
    medianRoutingSamples: median(rows.map((r) => r.routingSamples)),
    medianRoutingP95Ms: +median(rows.map((r) => r.routingP95Ms)).toFixed(2),
    medianFrameSamples: median(rows.map((r) => r.frameSamples)),
    movesObserved: rows.map((r) => r.movesObserved).join('/'),
    ackP95Ms: rows.map((r) => r.ackP95Ms).join('/'),
    routingSamples: rows.map((r) => r.routingSamples).join('/'),
  };
console.log(JSON.stringify({ summary, perRun: out.perRun }, null, 2));
