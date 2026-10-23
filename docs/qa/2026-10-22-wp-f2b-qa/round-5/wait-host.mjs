import { cpus } from 'node:os';
import { writeFile } from 'node:fs/promises';
const started = Date.now(),
  samples = [],
  windows = [];
const total = () =>
  cpus()
    .map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }))
    .reduce((a, b) => ({ idle: a.idle + b.idle, total: a.total + b.total }), { idle: 0, total: 0 });
let before = total(),
  quiet = false;
while (Date.now() - started < 900000 && !quiet) {
  await new Promise((r) => setTimeout(r, 5000));
  const now = total(),
    pct = 100 * (1 - (now.idle - before.idle) / (now.total - before.total));
  samples.push({ utc: new Date().toISOString(), cpuPercent: Number(pct.toFixed(2)) });
  before = now;
  const recent = samples.slice(-12),
    mean = recent.reduce((a, b) => a + b.cpuPercent, 0) / recent.length,
    max = Math.max(...recent.map((s) => s.cpuPercent));
  quiet = recent.length === 12 && mean < 50 && max < 80;
  if (samples.length % 12 === 0 || quiet)
    windows.push({
      utc: new Date().toISOString(),
      samples: recent.length,
      meanPercent: Number(mean.toFixed(2)),
      maxPercent: max,
      quiet,
    });
  await writeFile(
    new URL('./host-wait.json', import.meta.url),
    JSON.stringify(
      {
        startedUtc: new Date(started).toISOString(),
        samplerPid: process.pid,
        maxWaitSeconds: 900,
        elapsedSeconds: (Date.now() - started) / 1000,
        quietCriterion:
          '12 consecutive 5-second samples: mean below 50 percent and maximum below 80 percent; a recording criterion, not a product parameter',
        quiet,
        finished: quiet || Date.now() - started >= 900000,
        samples,
        windows,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log('Host wait ended: ' + (quiet ? 'quiet window' : '15 minute limit'));
