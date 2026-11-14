// Summarise perf-keystroke.jsonl: pooled next-paint latency per build and phase, every run kept
// (run 0 is the first probe of each build), plus Event Timing (>= 16 ms entries) per interaction.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
const rows = (await readFile(join(dir, 'perf-keystroke.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return { n: s.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +s.at(-1).toFixed(2), over16_7: s.filter((x) => x > 16.7).length };
};
const interactions = (entries) => {
  const byId = new Map();
  for (const e of entries) byId.set(e.interactionId, Math.max(byId.get(e.interactionId) ?? 0, e.duration));
  return [...byId.values()];
};
const summary = { method: 'keydown timeStamp -> rAF -> setTimeout(0); Event Timing durations are 8 ms granular and only >= 16 ms are reported', groups: {} };
for (const label of ['candidate', 'baseline'])
  for (const phase of ['cold', 'warm'])
    for (const which of ['all runs (0-3)', 'runs 1-3']) {
      const picked = rows.filter((r) => r.label === label && (which === 'all runs (0-3)' || r.run !== '0'));
      summary.groups[`${label} ${phase} ${which}`] = {
        runs: picked.map((r) => r.run),
        nextPaint: stats(picked.flatMap((r) => r[phase].raw)),
        perRunMedian: picked.map((r) => r[phase].median),
        eventTimingInteractionMax: stats(picked.flatMap((r) => interactions(r[phase].eventTiming))),
      };
    }
summary.loadToSavedMs = Object.fromEntries(['candidate', 'baseline'].map((l) => [l, rows.filter((r) => r.label === l).map((r) => r.loadToSavedMs)]));
summary.indicator = Object.fromEntries(['candidate', 'baseline'].map((l) => [l, [...new Set(rows.filter((r) => r.label === l).map((r) => r.indicator))]]));
summary.allTypedSaved = rows.every((r) => r.typedSaved);
const c = summary.groups['candidate cold runs 1-3'].nextPaint, b = summary.groups['baseline cold runs 1-3'].nextPaint;
const cw = summary.groups['candidate warm runs 1-3'].nextPaint, bw = summary.groups['baseline warm runs 1-3'].nextPaint;
summary.ratios = { coldMedian: +(c.median / b.median).toFixed(3), coldP95: +(c.p95 / b.p95).toFixed(3), warmMedian: +(cw.median / bw.median).toFixed(3), warmP95: +(cw.p95 / bw.p95).toFixed(3) };
await writeFile(join(dir, 'perf-keystroke-summary.json'), JSON.stringify(summary, null, 2) + '\n');
for (const [k, v] of Object.entries(summary.groups)) console.log(k.padEnd(34), JSON.stringify(v.nextPaint), 'ET', JSON.stringify(v.eventTimingInteractionMax));
console.log('ratios', JSON.stringify(summary.ratios), 'load', JSON.stringify(summary.loadToSavedMs), 'indicator', JSON.stringify(summary.indicator), 'saved', summary.allTypedSaved);
